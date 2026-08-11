import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';

afterEach(() => { vi.restoreAllMocks(); delete process.env.DATABASE_URL; });
beforeEach(() => { process.env.DATABASE_URL = 'postgres://test'; });

describe('searchPlasticGuides', () => {
  it('把向量库返回的 Document 映射为 PlasticChunk', async () => {
    const fakeStore = {
      similaritySearch: vi.fn().mockResolvedValueOnce([
        {
          pageContent: '重睑术恢复期1-3个月',
          metadata: { procedureName: '重睑术', section: '恢复期', source: '整形资料库' },
        },
      ]),
    };
    // 在底层拦截 PGVectorStore 的初始化，避免真实连库
    vi.spyOn(PGVectorStore, 'initialize').mockResolvedValue(fakeStore as any);

    const { searchPlasticGuides } = await import('../retrieval/vectorStore');
    const chunks = await searchPlasticGuides('双眼皮恢复', 4);

    expect(fakeStore.similaritySearch).toHaveBeenCalledWith('双眼皮恢复', 4);
    expect(chunks[0]).toEqual({
      content: '重睑术恢复期1-3个月',
      procedureName: '重睑术',
      section: '恢复期',
      source: '整形资料库',
    });
  });

  it('DATABASE_URL 未配置时抛错', async () => {
    delete process.env.DATABASE_URL;
    const { searchPlasticGuides } = await import('../retrieval/vectorStore');
    await expect(searchPlasticGuides('双眼皮')).rejects.toThrow('DATABASE_URL');
  });
});
