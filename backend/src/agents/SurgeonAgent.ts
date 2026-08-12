import { BaseAgent } from './BaseAgent';
import { AgentState, SurgeonResult } from './types';
import { searchPlasticGuides, PlasticChunk } from '../retrieval/vectorStore';
import { getRecoveryInfo } from '../tools/surgeryTools';

export class SurgeonAgent extends BaseAgent {
  constructor() {
    super('Surgeon', '整形手术项目咨询');
  }

  async execute(state: AgentState): Promise<Partial<AgentState>> {
    this.log('开始整形项目查询...');
    const query = this.buildQuery(state);

    try {
      const chunks = await searchPlasticGuides(query, 4);
      const result = await this.recommend(chunks);
      this.log(`查询完成，推荐 ${result.procedures.length} 个整形项目`);
      return { surgeonResults: result, errors: [] };
    } catch (error) {
      this.logError('整形项目查询失败', error);
      return {
        surgeonResults: {
          procedures: [],
          warnings: ['整形项目查询失败，请咨询专业整形医生'],
        },
        errors: [String(error)],
      };
    }
  }

  private buildQuery(state: AgentState): string {
    let q = state.userMessage;
    const ar = state.aestheticResults;
    if (ar?.concerns?.length) q += ' ' + ar.concerns.join(' ');
    if (ar?.suggestions?.length) q += ' ' + ar.suggestions.join(' ');
    return q;
  }

  private async recommend(chunks: PlasticChunk[]): Promise<SurgeonResult> {
    const hasData = chunks.length > 0;
    const material = hasData
      ? chunks.map((c, i) => `【资料${i + 1}】项目:${c.procedureName} | 小节:${c.section}\n${c.content}`).join('\n\n')
      : '（未检索到相关整形资料）';

    const rule = hasData
      ? '严格要求：只能基于上述真实资料推荐，资料里没有的项目/效果/风险绝对不要编造；资料不足时明说"建议咨询专业医生"。'
      : '未检索到整形资料库内容，请基于通用整形美容知识谨慎推荐，并在 warnings 中说明"未检索到资料库，以下为通用建议"。';

    const prompt = `你是专业整形外科顾问。以下是从整形资料库检索到的资料：

${material}

${rule}
请返回以下 JSON，不要添加其他内容：
{
  "procedures": [
    { "name": "手术/项目名", "type": "手术类/注射类/激光类", "description": "简介",
      "indication": "适用人群/适应症", "recoveryTime": "恢复期", "risks": ["风险1"], "suitable": true/false }
  ],
  "warnings": ["警告1", "建议术前咨询专业医生"]
}`;

    const raw = await this.invokeJSON<SurgeonResult>(prompt);

    const sources = hasData ? chunks.map((c) => `${c.source}:${c.procedureName}-${c.section}`) : [];
    const warnings = raw.warnings ?? [];
    if (!hasData && !warnings.some((w) => w.includes('未检索到资料库'))) {
      warnings.push('未检索到资料库，以下为通用建议，请以医生意见为准');
    }
    // 真实工具：为每个 LLM 推荐的项目补充标准恢复期数据
    const enriched = (raw.procedures ?? []).map((p) => {
      const rec = getRecoveryInfo(p.name);
      if (rec) {
        // 工具提供的标准恢复期数据覆盖 LLM 输出，确保数值准确
        p.recoveryTime = rec.timeline;
        if (!p.risks?.length) p.risks = [];
        p.risks.push(...rec.restrictions.map((r) => `[恢复期限制] ${r}`));
      }
      return p;
    });

    return { procedures: enriched, warnings, sources };
  }
}
