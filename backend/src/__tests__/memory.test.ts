import { describe, it, expect, vi, afterEach } from 'vitest';
import { sharedModel } from '../agents/BaseAgent';
import {
  getShortTermContext,
  _clearSessionStoreForTest,
} from '../memory/shortTermMemory';
import {
  getProfile,
  updateProfileFromConversation,
  formatProfile,
  _resetProfilesForTest,
} from '../memory/longTermMemory';
import {
  saveToVectorMemory,
  searchVectorMemory,
  _clearVectorMemoryForTest,
} from '../memory/vectorMemory';
import { buildMemoryContext, updateMemory } from '../memory/index';

afterEach(() => {
  vi.restoreAllMocks();
  _clearSessionStoreForTest();
  _resetProfilesForTest();
  _clearVectorMemoryForTest();
});

describe('shortTermMemory', () => {
  it('历史不足窗口时返回原文，不调用 LLM 摘要', async () => {
    const spy = vi.spyOn(sharedModel, 'invoke');
    const ctx = await getShortTermContext('s1', [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好' },
    ]);
    expect(ctx.summary).toBe('');
    expect(ctx.recent.length).toBe(2);
    expect(spy).not.toHaveBeenCalled();
  });

  it('历史超过窗口时调用 LLM 生成摘要，recent 只保留最后 N 条', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: '这是对话摘要',
    } as any);

    const history = Array.from({ length: 12 }, (_, i) => ({
      role: ('user' as const),
      content: `消息${i}`,
    }));
    const ctx = await getShortTermContext('s1', history);

    expect(ctx.summary).toBe('这是对话摘要');
    expect(ctx.recent.length).toBeLessThanOrEqual(6);
    expect(ctx.recent[ctx.recent.length - 1].content).toBe('消息11');
  });

  it('摘要失败时静默降级，不抛错', async () => {
    vi.spyOn(sharedModel, 'invoke').mockRejectedValueOnce(new Error('LLM fail'));
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: ('user' as const),
      content: `消息${i}`,
    }));
    const ctx = await getShortTermContext('s1', history);
    expect(ctx.summary).toBe('');
    expect(ctx.recent.length).toBeGreaterThan(0);
  });
});

describe('longTermMemory', () => {
  it('无 userId 返回空档案', () => {
    const p = getProfile(undefined);
    expect(p.concerns).toEqual([]);
  });

  it('从对话提取并合并档案（去重）', async () => {
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({
        concerns: ['眼皮下垂'],
        pastProcedures: ['重睑术'],
        preferences: ['偏好微创'],
      }),
    } as any);

    const p = await updateProfileFromConversation('u1', '我想做双眼皮，我眼皮有点下垂');
    expect(p.concerns).toContain('眼皮下垂');
    expect(p.pastProcedures).toContain('重睑术');

    // 第二次合并
    vi.spyOn(sharedModel, 'invoke').mockResolvedValueOnce({
      content: JSON.stringify({ concerns: ['鼻梁低'], pastProcedures: [], preferences: [] }),
    } as any);
    const p2 = await updateProfileFromConversation('u1', '鼻子也想做');
    expect(p2.concerns).toContain('眼皮下垂'); // 保留旧
    expect(p2.concerns).toContain('鼻梁低'); // 合并新
  });

  it('档案提取失败时保留旧档案，不抛错', async () => {
    vi.spyOn(sharedModel, 'invoke').mockRejectedValueOnce(new Error('LLM fail'));
    const p = await updateProfileFromConversation('u1', '我想咨询');
    expect(p.concerns).toEqual([]);
  });

  it('formatProfile 正确格式化', () => {
    const text = formatProfile({
      userId: 'u1',
      concerns: ['眼皮'],
      pastProcedures: ['重睑术'],
      preferences: ['微创'],
      updatedAt: '',
    });
    expect(text).toContain('眼皮');
    expect(text).toContain('重睑术');
  });
});

describe('vectorMemory', () => {
  it('保存后可按语义检索', async () => {
    // mock embedding 为固定向量
    vi.spyOn(sharedModel, 'invoke').mockResolvedValue({ content: '' } as any);

    const { GoogleGenerativeAIEmbeddings } = await import('@langchain/google-genai');
    vi.spyOn(GoogleGenerativeAIEmbeddings.prototype, 'embedDocuments')
      .mockResolvedValueOnce([[1, 0, 0]]) // 保存时 question A
      .mockResolvedValueOnce([[1, 0, 0]]); // 检索时 query

    await saveToVectorMemory('u1', '我想做双眼皮', '重睑术相关建议');
    const hits = await searchVectorMemory('u1', '双眼皮', 2);
    expect(hits.length).toBe(1);
    expect(hits[0].question).toBe('我想做双眼皮');
  });

  it('不同 userId 隔离', async () => {
    const { GoogleGenerativeAIEmbeddings } = await import('@langchain/google-genai');
    vi.spyOn(GoogleGenerativeAIEmbeddings.prototype, 'embedDocuments')
      .mockResolvedValueOnce([[1, 0, 0]])
      .mockResolvedValueOnce([[1, 0, 0]]);

    await saveToVectorMemory('u1', '双眼皮', 'a');
    const hits = await searchVectorMemory('u2', '双眼皮', 2);
    expect(hits.length).toBe(0);
  });
});

describe('memory 门面', () => {
  it('buildMemoryContext 组装三件套（无记忆时返回空）', async () => {
    const ctx = await buildMemoryContext({
      sessionId: 's1',
      userId: 'u1',
      history: [],
      userMessage: 'hi',
    });
    expect(ctx).toHaveProperty('summary');
    expect(ctx).toHaveProperty('profileText');
    expect(ctx).toHaveProperty('relevantHistoryText');
  });

  it('updateMemory 无 userId 时安全返回', async () => {
    await expect(updateMemory({ userMessage: 'hi' })).resolves.toBeUndefined();
  });
});
