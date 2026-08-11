import { describe, it, expect, vi, afterEach } from 'vitest';
import { sharedModel } from '../agents/BaseAgent';
import { RiskAssessorAgent } from '../agents/RiskAssessorAgent';

afterEach(() => vi.restoreAllMocks());

describe('RiskAssessorAgent', () => {
  it('正常情况：返回风险评估结果', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({
        riskLevel: 'medium',
        riskFactors: ['高血压史'],
        contraindications: ['妊娠期'],
        recommendations: ['建议术前体检'],
      }),
    } as any);

    const agent = new RiskAssessorAgent();
    const result = await agent.execute({ userMessage: '我有高血压能做手术吗', errors: [] });

    expect(result.riskResults?.riskLevel).toBe('medium');
    expect(result.riskResults?.riskFactors).toContain('高血压史');
    expect(result.errors).toHaveLength(0);
  });

  it('降级场景：LLM 失败时返回兜底评估', async () => {
    vi.spyOn(sharedModel, 'invoke').mockRejectedValueOnce(new Error('LLM 失败'));

    const agent = new RiskAssessorAgent();
    const result = await agent.execute({ userMessage: '手术风险大吗', errors: [] });

    expect(result.riskResults?.riskLevel).toBe('medium');
    expect(result.errors).toHaveLength(1);
  });
});
