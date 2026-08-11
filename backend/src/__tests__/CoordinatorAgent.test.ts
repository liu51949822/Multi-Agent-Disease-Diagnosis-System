import { describe, it, expect, vi, afterEach } from 'vitest';
import { sharedModel } from '../agents/BaseAgent';
import { CoordinatorAgent } from '../agents/CoordinatorAgent';

afterEach(() => vi.restoreAllMocks());

describe('CoordinatorAgent', () => {
  it('正常情况：生成包含 advisor 的执行计划', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({
        needsAesthetic: true,
        needsSurgeon: true,
        needsRisk: false,
        needsCare: false,
        complexity: 'medium',
        reasoning: '用户描述了美学诉求',
      }),
    } as any);

    const agent = new CoordinatorAgent();
    const result = await agent.execute({ userMessage: '我想改善眼睛', errors: [] });

    expect(result.coordinatorDecision?.plan).toContain('advisor');
    expect(result.coordinatorDecision?.plan).toContain('surgeon');
    expect(result.errors).toHaveLength(0);
  });

  it('降级场景：LLM 失败时只走 advisor', async () => {
    vi.spyOn(sharedModel, 'invoke').mockRejectedValueOnce(new Error('API 超时'));

    const agent = new CoordinatorAgent();
    const result = await agent.execute({ userMessage: '我想整容', errors: [] });

    expect(result.coordinatorDecision?.plan).toEqual(['advisor']);
    expect(result.errors).toHaveLength(1);
  });

  it('有照片时 aesthetic 排在计划前面', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({
        needsAesthetic: true,
        needsSurgeon: true,
        needsRisk: true,
        needsCare: false,
        complexity: 'complex',
        reasoning: '用户上传了照片并要求整体评估',
      }),
    } as any);

    const agent = new CoordinatorAgent();
    const result = await agent.execute({
      userMessage: '看看我的脸适合做什么',
      image: 'data:image/jpeg;base64,AAAA',
      errors: [],
    });

    const plan = result.coordinatorDecision?.plan ?? [];
    expect(plan.indexOf('aesthetic')).toBeLessThan(plan.indexOf('surgeon'));
    expect(plan[plan.length - 1]).toBe('advisor');
  });

  it('无照片但需美学分析时，仍保留 aesthetic（文字版降级路径）', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({
        needsAesthetic: true,
        needsSurgeon: false,
        needsRisk: false,
        needsCare: false,
        complexity: 'simple',
        reasoning: '用户描述了自己对面部的不满',
      }),
    } as any);

    const agent = new CoordinatorAgent();
    const result = await agent.execute({ userMessage: '我觉得自己脸太大了', errors: [] });

    expect(result.coordinatorDecision?.plan).toContain('aesthetic');
    expect(result.coordinatorDecision?.plan[result.coordinatorDecision!.plan.length - 1]).toBe('advisor');
  });
});
