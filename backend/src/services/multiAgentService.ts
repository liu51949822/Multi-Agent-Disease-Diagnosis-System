import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
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
  // ---- 记忆三件套字段（可选，默认 undefined，既有测试不受影响） ----
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
  const plan = state.coordinatorDecision?.plan ?? ['advisor'];
  return nextInPlan(plan, 'aesthetic');
}

function routeAfterSurgeon(state: GraphStateType): string {
  const plan = state.coordinatorDecision?.plan ?? ['advisor'];
  return nextInPlan(plan, 'surgeon');
}

function routeAfterRisk(state: GraphStateType): string {
  const plan = state.coordinatorDecision?.plan ?? ['advisor'];
  return nextInPlan(plan, 'risk');
}

function buildGraph() {
  const coordinator = new CoordinatorAgent();
  const aesthetic = new AestheticAgent();
  const surgeon = new SurgeonAgent();
  const risk = new RiskAssessorAgent();
  const care = new CareAgent();
  const advisor = new AdvisorAgent();

  return new StateGraph(GraphState)
    .addNode('coordinator', (s) => coordinator.execute(s as AgentState))
    .addNode('aesthetic', (s) => aesthetic.execute(s as AgentState))
    .addNode('surgeon', (s) => surgeon.execute(s as AgentState))
    .addNode('risk', (s) => risk.execute(s as AgentState))
    .addNode('care', (s) => care.execute(s as AgentState))
    .addNode('advisor', (s) => advisor.execute(s as AgentState))
    .addEdge(START, 'coordinator')
    .addConditionalEdges('coordinator', routeAfterCoordinator)
    .addConditionalEdges('aesthetic', routeAfterAesthetic)
    .addConditionalEdges('surgeon', routeAfterSurgeon)
    .addConditionalEdges('risk', routeAfterRisk)
    .addEdge('care', 'advisor')
    .addEdge('advisor', END)
    .compile();
}

const compiledGraph = buildGraph();
logger.info('多智能体图初始化完成');

const AGENT_LABELS: Record<string, string> = {
  coordinator: '任务协调',
  aesthetic: '美学分析',
  surgeon: '手术咨询',
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

  const initialState: Partial<GraphStateType> = {
    userMessage,
    image,
    sessionId: options.sessionId,
    userId: options.userId,
    summary: memoryContext?.summary,
    recentHistory: memoryContext?.recent,
    userProfile: memoryContext?.profileText || undefined,
    relevantHistory: memoryContext?.relevantHistoryText || undefined,
    errors: [],
  };

  try {
    const stream = compiledGraph.streamEvents(initialState, { version: 'v2' });

    const emittedStart = new Set<string>();
    const emittedEnd = new Set<string>();

    for await (const event of stream) {
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

        if (node === 'advisor' && output.advisorResults) {
          onEvent({ type: 'final_result', data: output.advisorResults });
          // 请求后：异步更新长期档案 + 向量记忆（失败静默降级，不阻塞）
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
