import { BaseAgent } from './BaseAgent';
import { AgentState, RiskAssessmentResult } from './types';

export class RiskAssessorAgent extends BaseAgent {
  constructor() {
    super('RiskAssessor', '术前风险评估');
  }

  async execute(state: AgentState): Promise<Partial<AgentState>> {
    this.log('开始术前风险评估...');

    try {
      const result = await this.assess(state);
      this.log(`风险评估完成 - 风险等级: ${result.riskLevel}`);
      return { riskResults: result, errors: [] };
    } catch (error) {
      this.logError('风险评估失败', error);
      return {
        riskResults: {
          riskLevel: 'medium',
          riskFactors: [],
          contraindications: [],
          recommendations: ['建议咨询专业整形医生进行术前评估'],
        },
        errors: [String(error)],
      };
    }
  }

  private async assess(state: AgentState): Promise<RiskAssessmentResult> {
    const context = this.buildContext(state);

    const prompt = `你是整形外科术前风险评估专家。请基于以下信息评估用户的术前风险。

${context}

请一次性返回以下 JSON，不要添加其他内容：
{
  "riskLevel": "low|medium|high",
  "riskFactors": ["风险因素1"],
  "contraindications": ["禁忌情况1（如特定病史/用药/妊娠等）"],
  "recommendations": ["建议1"]
}

风险等级判断标准：
- high：有严重基础疾病、凝血障碍、正在服用抗凝药、妊娠期、严重过敏史等
- medium：有慢性病史（如高血压/糖尿病控制不佳）、吸烟史、既往手术并发症史
- low：身体健康，无上述风险因素

要求：本系统为演示用途，不做医疗诊断，风险因素仅供参考，务必建议用户进行正式术前体检与面诊。`;

    return await this.invokeJSON<RiskAssessmentResult>(prompt);
  }

  private buildContext(state: AgentState): string {
    let ctx = `用户问题: ${state.userMessage}\n`;

    if (state.aestheticResults) {
      ctx += `\n【美学分析】\n${state.aestheticResults.facialAnalysis}\n`;
      if (state.aestheticResults.concerns?.length) {
        ctx += `关注点: ${state.aestheticResults.concerns.join('、')}\n`;
      }
    }

    if (state.surgeonResults) {
      ctx += `\n【拟咨询项目】\n`;
      state.surgeonResults.procedures.forEach((p, i) => {
        ctx += `${i + 1}. ${p.name} - ${p.description}\n`;
      });
    }

    return ctx;
  }
}
