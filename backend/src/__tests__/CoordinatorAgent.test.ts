import { describe, it, expect, vi, afterEach } from 'vitest';
import { sharedModel } from '../agents/BaseAgent';
import { CoordinatorAgent } from '../agents/CoordinatorAgent';

afterEach(() => vi.restoreAllMocks());

const mockStructured = (data: unknown) => {
  vi.spyOn(sharedModel, 'withStructuredOutput' as any).mockReturnValue({
    invoke: vi.fn().mockResolvedValue(data),
  } as any);
};

const mockStructuredReject = (err: Error) => {
  vi.spyOn(sharedModel, 'withStructuredOutput' as any).mockReturnValue({
    invoke: vi.fn().mockRejectedValue(err),
  } as any);
};

describe('CoordinatorAgent', () => {
  it('正常情况：zod 结构化输出 + 生成包含 advisor 的执行计划', async () => {
    mockStructured({
      needsAesthetic: true,
      needsSurgeon: true,
      needsRisk: false,
      needsCare: false,
      complexity: 'medium',
      reasoning: '用户描述了美学诉求',
    });

    const agent = new CoordinatorAgent();
    const result = await agent.execute({ userMessage: '我想改善眼睛', errors: [] });

    expect(result.coordinatorDecision?.plan).toContain('advisor');
    expect(result.coordinatorDecision?.plan).toContain('surgeon');
    expect(result.errors).toHaveLength(0);
  });

  it('降级场景：LLM 失败时只走 advisor（zod 自纠正全部失败→兜底失败）', async () => {
    mockStructuredReject(new Error('API 超时'));
    // 兜底路径 invokeJSONFallback 也会调 sharedModel.invoke → 也 reject
    vi.spyOn(sharedModel, 'invoke').mockRejectedValueOnce(new Error('兜底也失败'));

    const agent = new CoordinatorAgent();
    const result = await agent.execute({ userMessage: '我想整容', errors: [] });

    expect(result.coordinatorDecision?.plan).toEqual(['advisor']);
    expect(result.errors).toHaveLength(1);
  });

  it('有照片时 aesthetic 排在计划前面', async () => {
    mockStructured({
      needsAesthetic: true,
      needsSurgeon: true,
      needsRisk: true,
      needsCare: false,
      complexity: 'complex',
      reasoning: '用户上传了照片并要求整体评估',
    });

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
    mockStructured({
      needsAesthetic: true,
      needsSurgeon: false,
      needsRisk: false,
      needsCare: false,
      complexity: 'simple',
      reasoning: '用户描述了自己对面部的不满',
    });

    const agent = new CoordinatorAgent();
    const result = await agent.execute({ userMessage: '我觉得自己脸太大了', errors: [] });

    expect(result.coordinatorDecision?.plan).toContain('aesthetic');
    expect(result.coordinatorDecision!.plan[result.coordinatorDecision!.plan.length - 1]).toBe('advisor');
  });
});
