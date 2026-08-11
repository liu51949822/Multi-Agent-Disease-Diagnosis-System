import { describe, it, expect, vi, afterEach } from 'vitest';
import { sharedModel } from '../agents/BaseAgent';
import { CareAgent } from '../agents/CareAgent';

afterEach(() => vi.restoreAllMocks());

describe('CareAgent', () => {
  it('正常情况：返回术后护理建议', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({
        recoveryTimeline: '术后1-3天肿胀，1周拆线',
        careTips: ['保持伤口清洁'],
        warningSigns: ['异常出血', '发热'],
        followUp: '遵医嘱复诊',
      }),
    } as any);

    const agent = new CareAgent();
    const result = await agent.execute({ userMessage: '做完双眼皮怎么护理', errors: [] });

    expect(result.careResults?.careTips?.length).toBeGreaterThan(0);
    expect(result.careResults?.warningSigns).toContain('异常出血');
    expect(result.errors).toHaveLength(0);
  });

  it('降级场景：LLM 失败时返回兜底护理建议', async () => {
    vi.spyOn(sharedModel, 'invoke').mockRejectedValueOnce(new Error('LLM 失败'));

    const agent = new CareAgent();
    const result = await agent.execute({ userMessage: '术后注意什么', errors: [] });

    expect(result.careResults?.careTips?.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(1);
  });
});
