import { StateGraph, Annotation, END, START, MemorySaver, Command, interrupt, Send } from '@langchain/langgraph';
import type { AgentState, SseEvent } from '../agents/types';
import { CoordinatorAgent } from '../agents/CoordinatorAgent';
import { AestheticAgent } from '../agents/AestheticAgent';
import { SurgeonAgent } from '../agents/SurgeonAgent';
import { RiskAssessorAgent } from '../agents/RiskAssessorAgent';
import { CareAgent } from '../agents/CareAgent';
import { AdvisorAgent } from '../agents/AdvisorAgent';
import { buildMemoryContext, updateMemory } from '../memory/index';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const GraphState = Annotation.Root({
  userMessage: Annotation<string>({ default: () => '', reducer: (_, b) => b }),
  image: Annotation<string | undefined>({ default: () => undefined, reducer: (_, b) => b }),
  // ---- 记忆三件套字段（可选） ----
  sessionId: Annotation<string | undefined>({ default: () => undefined, reducer: (_, b) => b }),
  userId: Annotation<string | undefined>({ default: () => undefined, reducer: (_, b) => b }),
  summary: Annotation<string | undefined>({ default: () => undefined, reducer: (_, b) => b }),
  recentHistory: Annotation<AgentState['recentHistory']>({
    default: () => undefined,
    reducer: (_, b) => b,
  }),
  userProfile: Annotation<string | undefined>({ default: () => undefined, reducer: (_, b) => b }),
  relevantHistory: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_, b) => b,
  }),
  // ---- HITL 审批状态 ----
  hitlApproved: Annotation<boolean>({ default: () => false, reducer: (_, b) => b }),
  hitlFeedback: Annotation<string | undefined>({ default: () => undefined, reducer: (_, b) => b }),
  coordinatorDecision: Annotation<AgentState['coordinatorDecision']>({
    default: () => undefined,
    reducer: (_, b) => b,
  }),
  aestheticResults: Annotation<AgentState['aestheticResults']>({
    default: () => undefined,
    reducer: (_, b) => b,
  }),
  surgeonResults: Annotation<AgentState['surgeonResults']>({
    default: () => undefined,
    reducer: (_, b) => b,
  }),
  riskResults: Annotation<AgentState['riskResults']>({
    default: () => undefined,
    reducer: (_, b) => b,
  }),
  careResults: Annotation<AgentState['careResults']>({
    default: () => undefined,
    reducer: (_, b) => b,
  }),
  advisorResults: Annotation<AgentState['advisorResults']>({
    default: () => undefined,
    reducer: (_, b) => b,
  }),
  errors: Annotation<string[]>({
    default: () => [],
    reducer: (a, b) => [...a, ...b],
  }),
});

type GraphStateType = typeof GraphState.State;

// 从 plan 中取 current 节点之后的第一个未执行节点；无则回 advisor
function nextInPlan(plan: string[], current: string): string {
  const idx = plan.indexOf(current);
  for (let i = idx + 1; i < plan.length; i++) {
    const node = plan[i];
    if (node !== 'advisor') return node;
  }
  return 'advisor';
}

function routeAfterCoordinator(state: GraphStateType): string {
  const plan = state.coordinatorDecision?.plan ?? ['advisor'];
  return nextInPlan(plan, 'coordinator');
}

function routeAfterAesthetic(state: GraphStateType): string {
  // Fan-out 模式：aesthetic/surgeon 并行，完成后统一进 risk/care/advisor
  return routeAfterFanout(state);
}

function routeAfterSurgeon(state: GraphStateType): string {
  // 先走 HITL 门禁（有手术建议时）
  if (state.surgeonResults?.procedures?.length) return 'hitl_gate';
  return routeAfterFanout(state);
}

function routeAfterFanout(state: GraphStateType): string {
  const plan = state.coordinatorDecision?.plan ?? ['advisor'];
  if (plan.includes('risk')) return 'risk';
  if (plan.includes('care')) return 'care';
  return 'advisor';
}

function routeAfterHitl(state: GraphStateType): string {
  const plan = state.coordinatorDecision?.plan ?? ['advisor'];
  if (state.hitlApproved) return nextInPlan(plan, 'risk') === 'risk' ? 'risk' : 'care';
  // 未审批：跳过后续步骤，直达 advisor
  return 'advisor';
}

function routeAfterRisk(state: GraphStateType): string {
  const plan = state.coordinatorDecision?.plan ?? ['advisor'];
  return nextInPlan(plan, 'risk');
}

/** HITL 审批节点：展示手术建议并等待用户确认/拒绝。resume 后会从头重跑，但 interrupt() 直接返回 resume 值跳过等待。 */
async function hitlGateNode(s: GraphStateType): Promise<Partial<AgentState>> {
  const procs = s.surgeonResults?.procedures ?? [];
  const risk = s.riskResults;

  // 如果已审批过（resume 后重入），直接透传
  if (s.hitlApproved) {
    logger.info('HITL：用户已审批，继续执行');
    return {};
  }

  const payload = {
    procedures: procs.map((p) => ({ name: p.name, risks: p.risks, suitable: p.suitable })),
    warnings: s.surgeonResults?.warnings ?? [],
    riskLevel: risk?.riskLevel ?? 'medium',
    question: `以上 ${procs.length} 个整形手术项目建议是否继续？`,
  };

  // interrupt() 抛 GraphInterrupt，checkpointer 保存当前状态
  // resume 时 Command({resume}) 的值成为这里 interrupt() 的返回值
  const decision = await interrupt(payload);
  logger.info({ decision }, 'HITL 审批结果');

  return {
    hitlApproved: !!decision,
    hitlFeedback: typeof decision === 'string' ? decision : undefined,
  };
}

function buildGraph() {
  const coordinator = new CoordinatorAgent();
  const aesthetic = new AestheticAgent();
  const surgeon = new SurgeonAgent();
  const risk = new RiskAssessorAgent();
  const care = new CareAgent();
  const advisor = new AdvisorAgent();

  // Fan-out 节点：coordinator 分析 → 并行 Send aesthetic + surgeon
  const coordinatorFanoutNode = async (s: GraphStateType) => {
    const result = await coordinator.execute(s as AgentState);
    const plan = result.coordinatorDecision?.plan ?? ['advisor'];
    const sends: Send[] = [];

    // 并行 fan-out：aesthetic 和 surgeon 可同时执行（无依赖）
    if (plan.includes('aesthetic')) {
      sends.push(new Send('aesthetic', { ...result }));
    }
    if (plan.includes('surgeon')) {
      sends.push(new Send('surgeon', { ...result }));
    }

    // needsRisk/needsCare 依赖 aesthetic/surgeon 的结果，不在此 fan-out
    // 如果没有可并行的节点 → 直接推进到下一阶段
    if (sends.length === 0) {
      return result;
    }
    return sends;
  };

  return new StateGraph(GraphState)
    .addNode('coordinator', (s) => coordinator.execute(s as AgentState))
    .addNode('coordinatorFanout', coordinatorFanoutNode)
    .addNode('aesthetic', (s) => aesthetic.execute(s as AgentState))
    .addNode('surgeon', (s) => surgeon.execute(s as AgentState))
    .addNode('hitl_gate', hitlGateNode)
    .addNode('risk', (s) => risk.execute(s as AgentState))
    .addNode('care', (s) => care.execute(s as AgentState))
    .addNode('advisor', (s) => advisor.execute(s as AgentState))
    .addEdge(START, 'coordinator')
    .addEdge('coordinator', 'coordinatorFanout')
    .addConditionalEdges('aesthetic', routeAfterAesthetic)
    .addConditionalEdges('surgeon', routeAfterSurgeon)
    .addConditionalEdges('hitl_gate', routeAfterHitl)
    .addConditionalEdges('risk', routeAfterRisk)
    .addEdge('care', 'advisor')
    .addEdge('advisor', END)
    .compile({ checkpointer: new MemorySaver() });
}

const compiledGraph = buildGraph();
logger.info('多智能体图初始化完成（v3 流式 + MemorySaver + HITL）');

const AGENT_LABELS: Record<string, string> = {
  coordinator: '任务协调',
  aesthetic: '美学分析',
  surgeon: '手术咨询',
  hitl_gate: '人工审批',
  risk: '术前评估',
  care: '术后护理',
  advisor: '综合建议',
};

function summarize(nodeName: string, output: Partial<AgentState>): string {
  switch (nodeName) {
    case 'coordinator': {
      const plan = output.coordinatorDecision?.plan ?? [];
      return `执行计划: ${plan.join(' → ')}`;
    }
    case 'aesthetic': {
      const analyzed = output.aestheticResults?.analyzed ? '（照片分析）' : '（文字分析）';
      return `美学分析完成${analyzed}`;
    }
    case 'surgeon': {
      const n = output.surgeonResults?.procedures?.length ?? 0;
      return `推荐 ${n} 个整形项目`;
    }
    case 'hitl_gate':
      return output.hitlApproved ? '用户已确认手术建议' : '等待用户审批';
    case 'risk': {
      const level = output.riskResults?.riskLevel ?? 'medium';
      return `风险评估完成，风险等级: ${level}`;
    }
    case 'care':
      return '术后护理建议已生成';
    case 'advisor':
      return '综合建议已生成';
    default:
      return '处理完成';
  }
}

export interface StreamOptions {
  sessionId?: string;
  userId?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  resume?: unknown; // HITL resume value (用户确认/拒绝)
  threadId?: string; // 恢复时重用 thread_id（checkpointer 用）
}

export async function executeWithStream(
  userMessage: string,
  image: string | undefined,
  onEvent: (event: SseEvent) => void,
  options: StreamOptions = {},
): Promise<void> {
  // 请求前：组装记忆三件套上下文（任一层失败静默降级）
  let memoryContext: Awaited<ReturnType<typeof buildMemoryContext>> | undefined;
  try {
    memoryContext = await buildMemoryContext({
      sessionId: options.sessionId,
      userId: options.userId,
      history: options.history,
      userMessage,
    });
  } catch (err) {
    logger.error({ error: err }, 'build memory context failed, continue without memory');
  }

  const initialState = {
    userMessage,
    image,
    sessionId: options.sessionId,
    userId: options.userId,
    summary: memoryContext?.summary,
    recentHistory: memoryContext?.recent,
    userProfile: memoryContext?.profileText || undefined,
    relevantHistory: memoryContext?.relevantHistoryText || undefined,
    hitlApproved: false,
    errors: [] as string[],
  };

  // config 形式：v3 streamEvents 用 `configurable.thread_id`，
  // graph.invoke/stream 用 `configurable` 直接展开
  const config = options.threadId
    ? { configurable: { thread_id: options.threadId } }
    : { configurable: { thread_id: `${Date.now()}-${process.pid}` } };

  try {
    let input: typeof initialState | Command =
      options.resume !== undefined
        ? new Command({ resume: options.resume })
        : initialState;

    const stream = compiledGraph.streamEvents(input as any, {
      ...config,
      version: 'v3',
    });

    const emittedStart = new Set<string>();
    const emittedEnd = new Set<string>();
    // 缓存 surgeon 输出，供 hitl_gate 事件拿到手术建议列表
    let pendingProcedures: { name: string; risks: string[] }[] = [];

    for await (const event of stream as any) {
      const node = event.metadata?.langgraph_node as string | undefined;
      if (!node || !AGENT_LABELS[node]) continue;

      if (event.event === 'on_chain_start' && event.name === node && !emittedStart.has(node)) {
        emittedStart.add(node);
        onEvent({ type: 'agent_start', agent: node });
        logger.info({ node }, 'agent_start');
      }

      if (event.event === 'on_chain_end' && event.name === node && !emittedEnd.has(node)) {
        emittedEnd.add(node);
        const output = (event.data?.output ?? {}) as Partial<AgentState>;
        const summary = summarize(node, output);
        onEvent({ type: 'agent_complete', agent: node, summary });
        logger.info({ node, summary }, 'agent_complete');

        // 缓存 surgeon 手术建议
        if (node === 'surgeon') {
          pendingProcedures = output.surgeonResults?.procedures?.map((p: any) => ({ name: p.name, risks: p.risks })) ?? [];
        }

        if (node === 'advisor' && output.advisorResults) {
          onEvent({ type: 'final_result', data: output.advisorResults });
          try {
            await updateMemory({
              sessionId: options.sessionId,
              userId: options.userId,
              userMessage,
              assistantReply: output.advisorResults.summary,
            });
          } catch (err) {
            logger.error({ error: err }, 'update memory failed');
          }
        }

        // HITL：通知前端需要用户审批
        if (node === 'hitl_gate' && !(output as any).hitlApproved) {
          onEvent({
            type: 'hitl_required',
            procedures: pendingProcedures,
            question: '以上手术项目建议是否继续？',
            threadId: (config as any).configurable.thread_id,
          } as any);
        }
      }
    }

    onEvent({ type: 'done' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, '多智能体执行失败');
    onEvent({ type: 'error', message });
    onEvent({ type: 'done' });
  }
}
