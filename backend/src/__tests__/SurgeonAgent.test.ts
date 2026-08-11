import { describe, it, expect, vi, afterEach } from 'vitest';
import { sharedModel } from '../agents/BaseAgent';
import { SurgeonAgent } from '../agents/SurgeonAgent';
import * as vectorStore from '../retrieval/vectorStore';

afterEach(() => vi.restoreAllMocks());

describe('SurgeonAgent', () => {
  it('正常情况：有 RAG 资料时推荐整形项目并附出处', async () => {
    const chunks = [
      { content: '重睑术恢复期1-3个月', procedureName: '重睑术', section: '恢复期', source: '整形资料库' },
    ];
    vi.spyOn(vectorStore, 'searchPlasticGuides').mockResolvedValueOnce(chunks as any);
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({
        procedures: [
          {
            name: '重睑术', type: '手术类', description: '形成双眼皮',
            indication: '单眼皮人群', recoveryTime: '1-3个月', risks: ['肿胀'], suitable: true,
          },
        ],
        warnings: ['建议术前咨询专业医生'],
      }),
    } as any);

    const agent = new SurgeonAgent();
    const result = await agent.execute({ userMessage: '我想做双眼皮', errors: [] });

    expect(vectorStore.searchPlasticGuides).toHaveBeenCalled();
    expect(result.surgeonResults?.procedures?.length).toBe(1);
    expect(result.surgeonResults?.sources?.[0]).toContain('整形资料库');
    expect(result.errors).toHaveLength(0);
  });

  it('RAG 失败时降级：返回空 procedures 并提示', async () => {
    vi.spyOn(vectorStore, 'searchPlasticGuides').mockRejectedValueOnce(new Error('DATABASE_URL 未配置'));

    const agent = new SurgeonAgent();
    const result = await agent.execute({ userMessage: '我想隆鼻', errors: [] });

    expect(result.surgeonResults?.procedures).toEqual([]);
    expect(result.surgeonResults?.warnings?.[0]).toContain('整形项目查询失败');
    expect(result.errors).toHaveLength(1);
  });
});
