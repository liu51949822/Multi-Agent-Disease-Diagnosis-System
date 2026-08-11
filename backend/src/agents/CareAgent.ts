import { BaseAgent } from './BaseAgent';
import { AgentState, CareResult } from './types';

export class CareAgent extends BaseAgent {
  constructor() {
    super('Care', '术后护理与恢复指导');
  }

  async execute(state: AgentState): Promise<Partial<AgentState>> {
    this.log('开始术后护理建议生成...');

    try {
      const result = await this.generateCare(state);
      this.log('术后护理建议生成完成');
      return { careResults: result, errors: [] };
    } catch (error) {
      this.logError('术后护理建议生成失败', error);
      return {
        careResults: {
          recoveryTimeline: '术后恢复期因手术项目而异，请遵医嘱',
          careTips: ['保持伤口清洁干燥', '按时复诊'],
          warningSigns: ['异常出血', '剧烈疼痛', '发热'],
          followUp: '建议遵医嘱定期复诊',
        },
        errors: [String(error)],
      };
    }
  }

  private async generateCare(state: AgentState): Promise<CareResult> {
    const context = this.buildContext(state);

    const prompt = `你是整形术后护理专家。请基于以下信息，为患者生成术后护理与恢复建议。

${context}

请一次性返回以下 JSON，不要添加其他内容：
{
  "recoveryTimeline": "分阶段恢复时间线（如 术后1-3天/1周/1个月 各阶段恢复预期）",
  "careTips": ["护理建议1", "护理建议2"],
  "warningSigns": ["需立即就医的警示信号1", "警示信号2"],
  "followUp": "复诊与随访建议"
}

要求：
- 护理建议要具体、可操作
- 警示信号必须明确（异常出血、感染征兆、剧烈疼痛等）
- 强调"最终护理方案以主治医生医嘱为准"
- 本系统为演示用途，不构成医疗建议`;

    return await this.invokeJSON<CareResult>(prompt);
  }

  private buildContext(state: AgentState): string {
    let ctx = `用户问题: ${state.userMessage}\n`;

    if (state.aestheticResults) {
      ctx += `\n【美学分析】\n${state.aestheticResults.facialAnalysis}\n`;
    }

    if (state.surgeonResults) {
      ctx += `\n【拟咨询项目】\n`;
      state.surgeonResults.procedures.forEach((p, i) => {
        ctx += `${i + 1}. ${p.name} - 适应症:${p.indication} | 恢复期:${p.recoveryTime}\n`;
        if (p.risks?.length) ctx += `   风险: ${p.risks.join('; ')}\n`;
      });
    }

    if (state.riskResults) {
      ctx += `\n【风险评估】\n风险等级: ${state.riskResults.riskLevel}\n`;
      if (state.riskResults.riskFactors?.length) {
        ctx += `风险因素: ${state.riskResults.riskFactors.join('、')}\n`;
      }
    }

    return ctx;
  }
}
