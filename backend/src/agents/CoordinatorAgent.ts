import { BaseAgent } from './BaseAgent';
import { AgentState, CoordinatorAnalysis } from './types';

export class CoordinatorAgent extends BaseAgent {
  constructor() {
    super('Coordinator', '问题分析和任务协调');
  }

  async execute(state: AgentState): Promise<Partial<AgentState>> {
    this.log('开始分析用户问题...');

    try {
      const analysis = await this.analyzeQuestion(state.userMessage);
      const plan = this.buildPlan(analysis);

      this.log(`分析完成 - 复杂度: ${analysis.complexity}`);
      this.log(`执行计划: ${plan.join(' → ')}`);

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

  private async analyzeQuestion(message: string): Promise<CoordinatorAnalysis> {
    const prompt = `你是一个整形美容咨询系统的协调器。请分析以下用户问题，判断需要调用哪些专业模块。

用户问题: ${message}

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

    return await this.invokeJSON<CoordinatorAnalysis>(prompt);
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
}
