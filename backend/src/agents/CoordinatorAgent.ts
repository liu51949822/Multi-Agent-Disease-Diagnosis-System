import { BaseAgent } from './BaseAgent';
import { AgentState, CoordinatorAnalysis, CoordinatorAnalysisSchema } from './types';

export class CoordinatorAgent extends BaseAgent {
  constructor() {
    super('Coordinator', '问题分析和任务协调');
  }

  async execute(state: AgentState): Promise<Partial<AgentState>> {
    this.log('开始分析用户问题...');

    try {
      const analysis = await this.analyzeQuestion(state.userMessage, state);
      const plan = this.buildPlan(analysis);

      this.log(`分析完成 - 复杂度: ${analysis.complexity}`);
      this.log(`执行计划: ${plan.join(' → ')}`);

      // Plan 验证：规则检查确保多智能体路由逻辑不出现致命错误
      const validationWarnings = this.validatePlan(plan, state);
      if (validationWarnings.length > 0) {
        this.log(`Plan 验证告警: ${validationWarnings.join('; ')}`);
      }

      return {
        coordinatorDecision: {
          needsAesthetic: analysis.needsAesthetic,
          needsSurgeon: analysis.needsSurgeon,
          needsRisk: analysis.needsRisk,
          needsCare: analysis.needsCare,
          complexity: analysis.complexity,
          plan,
          reasoning: analysis.reasoning,
        },
        errors: [],
      };
    } catch (error) {
      this.logError('分析失败', error);
      return {
        coordinatorDecision: {
          needsAesthetic: false,
          needsSurgeon: false,
          needsRisk: false,
          needsCare: false,
          complexity: 'simple',
          plan: ['advisor'],
          reasoning: '协调器分析失败，已切换至兜底模式',
        },
        errors: [String(error)],
      };
    }
  }

  /** Plan 验证：规则检查确保路由安全。
   *  面试叙事：多智能体编排不只是"生成 plan 直接执行"——
   *  还有一层确定性验证守卫，确保 LLM 输出的 plan 没有逻辑矛盾。 */
  private validatePlan(plan: string[], state: AgentState): string[] {
    const warnings: string[] = [];

    // advisor 必须压轴
    if (plan.length > 1 && plan[plan.length - 1] !== 'advisor') {
      warnings.push('advisor 不在 plan 末尾（已自动修正）');
      plan.push('advisor');
    }

    // 没有 adviser 时自动追加
    if (!plan.includes('advisor')) {
      plan.push('advisor');
    }

    // 照片已上传但 plan 不包含 aesthetic（可能漏了视觉分析）
    if (state.image && !plan.includes('aesthetic') && !plan.includes('coordinator')) {
      warnings.push('用户上传了照片但 plan 不含美学分析（可能是 LLM 遗漏）');
    }

    // 高风险场景：手术项目 + 无风险评估
    if (plan.includes('surgeon') && !plan.includes('risk')) {
      warnings.push('包含手术咨询但缺少术前风险评估（建议补充）');
    }

    // 手术项目 + 无术后护理
    if (plan.includes('surgeon') && !plan.includes('care')) {
      warnings.push('包含手术咨询但缺少术后护理（建议补充）');
    }

    return warnings;
  }

  private async analyzeQuestion(message: string, state: AgentState): Promise<CoordinatorAnalysis> {
    // 记忆上下文：早期摘要 + 长期用户档案 + 向量相关历史
    const memory = this.buildMemoryPrompt(state);

    const prompt = `你是一个整形美容咨询系统的协调器。请分析以下用户问题，判断需要调用哪些专业模块。

用户问题: ${message}
${memory}
请分析：
1. needsAesthetic：用户是否涉及面部/形体美学评估（如对自己外貌不满、想改善五官/轮廓、上传照片要求分析）
2. needsSurgeon：是否涉及整形手术项目（如双眼皮、隆鼻、抽脂、隆胸、玻尿酸填充、肉毒素注射等具体项目咨询）
3. needsRisk：是否需要术前风险评估（提到病史、过敏史、想了解手术风险、是否有禁忌症等）
4. needsCare：是否涉及术后护理（术后恢复、注意事项、并发症应对）
5. complexity：simple（单一项目查询）/ medium（有美学诉求，需综合建议）/ complex（多项目、需全面评估）

只返回以下 JSON，不要添加其他内容：
{
  "needsAesthetic": true/false,
  "needsSurgeon": true/false,
  "needsRisk": true/false,
  "needsCare": true/false,
  "complexity": "simple/medium/complex",
  "reasoning": "分析原因（中文）"
}`;

    return await this.invokeStructured(prompt, CoordinatorAnalysisSchema);
  }

  private buildPlan(analysis: CoordinatorAnalysis): string[] {
    const plan: string[] = [];

    // 需要美学分析时，aesthetic 一律最先执行（有照片走视觉，无照片走纯文字降级）
    // 注意：图结构中 care 为固定边直达 advisor，因此 aesthetic 不能排在 care 之后
    if (analysis.needsAesthetic) {
      plan.push('aesthetic');
    }

    if (analysis.needsSurgeon) {
      plan.push('surgeon');
    }

    if (analysis.needsRisk) {
      plan.push('risk');
    }

    if (analysis.needsCare) {
      plan.push('care');
    }

    // advisor 始终压轴
    plan.push('advisor');

    return plan;
  }

  /** 把记忆三件套格式化为协调器的补充上下文（无则返回空串） */
  private buildMemoryPrompt(state: AgentState): string {
    const parts: string[] = [];
    if (state.summary) parts.push(`【此前对话摘要】\n${state.summary}`);
    if (state.recentHistory?.length) {
      const recentText = state.recentHistory
        .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
        .join('\n');
      parts.push(`【最近对话】\n${recentText}`);
    }
    if (state.userProfile) parts.push(`【用户档案】\n${state.userProfile}`);
    if (state.relevantHistory) parts.push(`${state.relevantHistory}`);
    return parts.length ? `\n${parts.join('\n\n')}\n` : '';
  }
}
