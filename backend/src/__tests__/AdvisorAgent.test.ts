import { describe, it, expect, vi, afterEach } from 'vitest';
import { sharedModel } from '../agents/BaseAgent';
import { AdvisorAgent } from '../agents/AdvisorAgent';

afterEach(() => vi.restoreAllMocks());

const makeAdvisorPayload = (overrides = {}) => ({
  summary: '您咨询了双眼皮手术相关情况',
  aestheticAnalysis: '上睑略显单薄',
  recommendedProcedures: [
    { name: '重睑术', reason: '改善上睑形态', expectedOutcome: '眼睛更有神', precautions: ['选择正规机构'] },
  ],
  riskAssessment: '风险等级中等',
  carePlan: '术后1周拆线，保持伤口清洁',
  precautions: ['术前体检', '选择正规机构'],
  references: [],
  urgency: '建议面诊咨询',
  disclaimer: '以上仅供参考，请咨询专业整形医生',
  ...overrides,
});

describe('AdvisorAgent', () => {
  it('正常情况：单次 LLM 调用，返回完整建议', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify(makeAdvisorPayload()),
    } as any);
    // mock selfReview 返回高分跳过重生成
    vi.spyOn(AdvisorAgent.prototype as any, 'selfReview').mockResolvedValue({ score: 85, feedback: '' });

    const agent = new AdvisorAgent();
    const result = await agent.execute({ userMessage: '我想做双眼皮', errors: [] });

    expect(sharedModel.invoke).toHaveBeenCalledTimes(1);
    expect(result.advisorResults?.summary).toBeTruthy();
    expect(result.advisorResults?.disclaimer).toBeTruthy();
    expect(result.errors).toHaveLength(0);
  });

  it('降级场景：LLM 失败时返回兜底建议，errors 长度为 1', async () => {
    vi.spyOn(sharedModel, 'invoke').mockRejectedValueOnce(new Error('LLM 失败'));

    const agent = new AdvisorAgent();
    const result = await agent.execute({ userMessage: '我想隆鼻', errors: [] });

    expect(result.advisorResults?.disclaimer).toBeTruthy();
    expect(result.errors).toHaveLength(1);
  });

  it('汇总已有美学/手术/风险/护理信息时不额外调用 LLM', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify(makeAdvisorPayload()),
    } as any);
    vi.spyOn(AdvisorAgent.prototype as any, 'selfReview').mockResolvedValue({ score: 90, feedback: '' });

    const agent = new AdvisorAgent();
    await agent.execute({
      userMessage: '综合咨询',
      errors: [],
      aestheticResults: {
        analyzed: true,
        photoObservations: ['上睑松弛'],
        facialAnalysis: '整体协调',
        concerns: ['眼皮下垂'],
        suggestions: ['可考虑重睑术'],
        confidence: 70,
      },
      surgeonResults: {
        procedures: [
          { name: '重睑术', type: '手术类', description: 'x', indication: 'y', recoveryTime: '1-3月', risks: ['肿胀'], suitable: true },
        ],
        warnings: [],
      },
      riskResults: { riskLevel: 'low', riskFactors: [], contraindications: [], recommendations: [] },
      careResults: { recoveryTimeline: '1周', careTips: ['清洁'], warningSigns: [], followUp: '复诊' },
    });

    expect(sharedModel.invoke).toHaveBeenCalledTimes(1);
  });
});
