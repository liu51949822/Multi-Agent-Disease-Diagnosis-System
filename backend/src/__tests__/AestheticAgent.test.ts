import { describe, it, expect, vi, afterEach } from 'vitest';
import { sharedModel } from '../agents/BaseAgent';
import { AestheticAgent } from '../agents/AestheticAgent';

afterEach(() => vi.restoreAllMocks());

describe('AestheticAgent', () => {
  it('有照片：走图文视觉分析，返回 analyzed=true', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({
        analyzed: true,
        photoObservations: ['上睑皮肤轻微松弛'],
        facialAnalysis: '整体轮廓协调',
        concerns: ['眼皮略显单薄'],
        suggestions: ['可考虑重睑术，仅供参考'],
        confidence: 75,
      }),
    } as any);

    const agent = new AestheticAgent();
    const result = await agent.execute({
      userMessage: '看看我的眼睛',
      image: 'data:image/jpeg;base64,AAAA',
      errors: [],
    });

    expect(sharedModel.invoke).toHaveBeenCalledTimes(1);
    expect(result.aestheticResults?.analyzed).toBe(true);
    expect(result.aestheticResults?.photoObservations?.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it('无照片：走纯文字分析，analyzed=false', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({
        analyzed: false,
        photoObservations: [],
        facialAnalysis: '基于描述的分析',
        concerns: ['面部轮廓不流畅'],
        suggestions: ['可考虑注射类改善，仅供参考'],
        confidence: 50,
      }),
    } as any);

    const agent = new AestheticAgent();
    const result = await agent.execute({ userMessage: '我觉得脸型不好看', errors: [] });

    expect(result.aestheticResults?.analyzed).toBe(false);
    expect(result.aestheticResults?.suggestions?.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it('降级场景：LLM 失败时返回兜底美学结果', async () => {
    vi.spyOn(sharedModel, 'invoke').mockRejectedValueOnce(new Error('LLM 失败'));

    const agent = new AestheticAgent();
    const result = await agent.execute({ userMessage: '看看我', image: 'data:image/jpeg;base64,AAAA', errors: [] });

    expect(result.aestheticResults?.analyzed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
