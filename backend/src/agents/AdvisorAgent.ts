import { BaseAgent } from './BaseAgent';
import { AgentState, AdvisorResult } from './types';

export class AdvisorAgent extends BaseAgent {
  constructor() {
    super('Advisor', '综合建议生成');
  }

  async execute(state: AgentState): Promise<Partial<AgentState>> {
    this.log('开始生成最终建议...');

    try {
      const result = await this.generateAdvice(state);
      this.log('最终建议生成完成');
      return { advisorResults: result, errors: [] };
    } catch (error) {
      this.logError('建议生成失败', error);
      return {
        advisorResults: {
          summary: '抱歉，无法生成完整建议，请咨询专业整形医生',
          recommendedProcedures: [],
          precautions: ['建议咨询专业整形医生'],
          references: [],
          urgency: '建议面诊咨询',
          disclaimer: '以上内容仅供参考，不构成医疗建议。请咨询专业整形医生获取准确评估和方案。',
        },
        errors: [String(error)],
      };
    }
  }

  // Advisor prompt 上下文长度上限。超出时优先裁剪低优先级摘要,
  // 保留美学分析/项目推荐/风险/护理等核心信息,避免静默丢弃关键内容。
  // 注意:投影绝不含照片 base64,防止 token 浪费与隐私外泄。
  private static readonly MAX_CONTEXT_LEN = 4000;

  // 记忆块与核心结果分离:超长时优先裁剪低优先级的记忆块,
  // 而不是整体硬截断(否则会从末尾切掉最该保留的本轮分析结果)。
  private buildContext(state: AgentState): string {
    // ---- 低优先级:记忆上下文(可裁剪) ----
    const memoryParts: string[] = [];
    if (state.summary) memoryParts.push(`【此前对话摘要】\n${state.summary}`);
    if (state.recentHistory?.length) {
      memoryParts.push(
        `【最近对话】\n${state.recentHistory
          .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
          .join('\n')}`,
      );
    }
    if (state.userProfile) memoryParts.push(`【用户档案】\n${state.userProfile}`);
    if (state.relevantHistory) memoryParts.push(`${state.relevantHistory}`);

    // ---- 高优先级:本轮核心结果(必留) ----
    let core = `用户问题: ${state.userMessage}\n`;

    if (state.coordinatorDecision) {
      core += `\n问题复杂度: ${state.coordinatorDecision.complexity}`;
      core += `\n分析: ${state.coordinatorDecision.reasoning}`;
    }

    if (state.aestheticResults) {
      const ar = state.aestheticResults;
      core += `\n\n【美学分析】`;
      core += `\n${ar.facialAnalysis}`;
      if (ar.analyzed && ar.photoObservations?.length) {
        core += `\n照片观察: ${ar.photoObservations.join('; ')}`;
      }
      if (ar.concerns?.length) core += `\n关注点: ${ar.concerns.join('、')}`;
      if (ar.suggestions?.length) core += `\n改善方向: ${ar.suggestions.join('、')}`;
    }

    if (state.surgeonResults) {
      const sr = state.surgeonResults;
      core += `\n\n【整形项目推荐】`;
      sr.procedures.forEach((p, i) => {
        core += `\n${i + 1}. ${p.name} — ${p.indication} — 恢复期:${p.recoveryTime}`;
      });
      if (sr.warnings?.length) core += `\n警告: ${sr.warnings.join('; ')}`;
    }

    if (state.riskResults) {
      const rr = state.riskResults;
      core += `\n\n【术前风险评估】`;
      core += `\n风险等级: ${rr.riskLevel}`;
      if (rr.riskFactors?.length) core += `\n风险因素: ${rr.riskFactors.join('、')}`;
      if (rr.recommendations?.length) core += `\n建议: ${rr.recommendations.join('; ')}`;
    }

    if (state.careResults) {
      const cr = state.careResults;
      core += `\n\n【术后护理】`;
      core += `\n恢复时间线: ${cr.recoveryTimeline}`;
      if (cr.careTips?.length) core += `\n护理要点: ${cr.careTips.join('; ')}`;
    }

    // ---- 组装 + 长度守卫 ----
    // 先塞核心结果,再用记忆块填充剩余预算;记忆块超出部分按优先级裁剪,
    // 核心结果(美学/项目/风险/护理)绝不被截断。
    let memoryText = memoryParts.join('\n\n');
    const budget = AdvisorAgent.MAX_CONTEXT_LEN - core.length;
    if (memoryText.length > budget) {
      if (budget > 200) {
        memoryText = memoryText.slice(0, budget) + '\n[部分历史信息因长度限制省略]';
      } else {
        memoryText = ''; // 预算几乎耗尽:丢弃记忆块,保住核心结果
      }
      this.log('⚠️ Advisor 记忆块超预算,已裁剪(核心结果保留)');
    }
    return memoryText ? `${core}\n\n${memoryText}` : core;
  }

  private async generateAdvice(state: AgentState): Promise<AdvisorResult> {
    const context = this.buildContext(state);
    // 常态化记录上下文长度,便于按真实数据校准 MAX_CONTEXT_LEN 阈值
    this.log(`Advisor 上下文长度: ${context.length}/${AdvisorAgent.MAX_CONTEXT_LEN} 字符`);

    const prompt = `你是专业整形美容顾问。请基于以下所有信息，生成一份全面、专业的整形咨询建议。

${context}

请返回以下 JSON，不要添加其他内容：
{
  "summary": "对用户情况的简要概括（50-100字）",
  "aestheticAnalysis": "美学分析结论（若有美学分析信息则填写，否则省略此字段）",
  "recommendedProcedures": [
    {
      "name": "手术/项目名称",
      "reason": "推荐理由",
      "expectedOutcome": "预期效果（注明为参考，实际以医生面诊为准）",
      "precautions": ["注意事项1", "注意事项2"]
    }
  ],
  "riskAssessment": "术前风险评估概述（若有风险评估信息则填写，否则省略此字段）",
  "carePlan": "术后护理建议概述（若有护理信息则填写，否则省略此字段）",
  "precautions": ["总体注意事项1", "总体注意事项2"],
  "references": ["如有资料出处则列出，否则空数组"],
  "urgency": "建议（一句话，如建议面诊/建议先就医）",
  "disclaimer": "以上内容仅供参考，不构成医疗建议。请咨询专业整形医生获取准确评估和方案。"
}

要求：语言专业准确，突出重要警告，强调手术需正规医疗机构面诊，综合所有可用信息。`;

    return await this.invokeJSON<AdvisorResult>(prompt);
  }
}
