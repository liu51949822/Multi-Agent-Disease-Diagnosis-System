// 长期用户档案记忆（Long-term / cross-thread memory）
//
// 官方模式对应：LangGraph Store + Profile 策略。
// 实现为内存版 profileStore + JSON 文件持久化（生产可替换为 PostgresStore 等）。
// 每个 userId 存一份结构化档案（Profile 式），跨会话/跨线程共享，
// 多 agent 共享同一 store → 天然实现多 agent 共享长期记忆。
//
// 关键设计（对应面试常考点）：
//   1. Profile 策略：单个持续更新的 JSON 档案，而非不断堆积的文档集合。
//   2. 从对话中"提取"档案（LLM 结构化），而非人工维护。
//   3. 失败静默降级：提取失败则保留旧档案，不打断主流程。

import { sharedModel } from '../agents/BaseAgent';
import fs from 'node:fs';
import path from 'node:path';

export interface UserProfile {
  userId: string;
  concerns: string[]; // 关注点
  pastProcedures: string[]; // 既往咨询/考虑过的项目
  preferences: string[]; // 偏好（如"偏好微创""对疼痛敏感"等）
  updatedAt: string;
}

// 文件持久化路径（data/memory/profiles.json，gitignored）
const PROFILES_FILE = path.resolve(__dirname, '../../data/memory/profiles.json');

// 测试环境（vitest NODE_ENV=test）跳过磁盘读写，避免测试间相互污染
const IS_TEST = process.env.NODE_ENV === 'test';

const profileStore = new Map<string, UserProfile>();

function loadProfilesFromDisk(): void {
  if (IS_TEST) return;
  try {
    if (!fs.existsSync(PROFILES_FILE)) return;
    const raw = fs.readFileSync(PROFILES_FILE, 'utf-8');
    const data = JSON.parse(raw) as Record<string, UserProfile>;
    Object.entries(data).forEach(([k, v]) => profileStore.set(k, v));
  } catch (err) {
    // 读取失败静默降级（例如首次运行无文件）
    console.warn('[memory] load profiles failed:', err);
  }
}

function saveProfilesToDisk(): void {
  if (IS_TEST) return;
  try {
    fs.mkdirSync(path.dirname(PROFILES_FILE), { recursive: true });
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(Object.fromEntries(profileStore), null, 2));
  } catch (err) {
    // 写盘失败不阻断主流程
    console.warn('[memory] save profiles failed:', err);
  }
}

/** 读取用户档案（无则返回空档案） */
export function getProfile(userId: string | undefined): UserProfile {
  if (!userId) {
    return { userId: '', concerns: [], pastProcedures: [], preferences: [], updatedAt: '' };
  }
  const p = profileStore.get(userId);
  if (!p) {
    return { userId, concerns: [], pastProcedures: [], preferences: [], updatedAt: '' };
  }
  return p;
}

/**
 * 从一次对话中提取/更新用户档案（LLM 结构化提取，Profile 增量更新策略）。
 * 提取失败静默降级：保留旧档案。
 */
export async function updateProfileFromConversation(
  userId: string | undefined,
  userMessage: string,
): Promise<UserProfile> {
  if (!userId) return getProfile(undefined);

  const existing = getProfile(userId);
  try {
    const updated = await extractProfile(userMessage, existing);
    profileStore.set(userId, updated);
    saveProfilesToDisk();
    return updated;
  } catch (err) {
    console.warn('[memory] profile extract failed, keep existing:', err);
    return existing;
  }
}

/** 用 LLM 从用户一句话中提取结构化档案（增量式：结合已有档案） */
async function extractProfile(message: string, existing: UserProfile): Promise<UserProfile> {
  const prompt = `你是用户画像分析师。根据用户最新发言，提取或更新该用户的整形咨询档案。
只提取"从这句话能可靠推断"的信息，不要臆测。请返回 JSON：
{
  "concerns": ["关注点数组"],
  "pastProcedures": ["已咨询/考虑过的整形项目数组"],
  "preferences": ["偏好数组"]
}

【已有档案】
${JSON.stringify({ concerns: existing.concerns, pastProcedures: existing.pastProcedures, preferences: existing.preferences })}

【用户最新发言】
${message}

要求：与已有档案合并去重，保持增量更新。只返回 JSON，不要其他内容。`;

  const raw = await sharedModel.invoke(prompt);
  const text = raw.content.toString();
  const match = text.match(/(\{[\s\S]*\})/);
  if (!match) throw new Error('profile JSON parse failed');
  const parsed = JSON.parse(match[0]) as {
    concerns?: string[];
    pastProcedures?: string[];
    preferences?: string[];
  };

  const merge = (a: string[], b: string[] | undefined) => {
    const set = new Set([...(a ?? []), ...(b ?? [])]);
    return Array.from(set).slice(0, 20);
  };

  return {
    userId: existing.userId,
    concerns: merge(existing.concerns, parsed.concerns),
    pastProcedures: merge(existing.pastProcedures, parsed.pastProcedures),
    preferences: merge(existing.preferences, parsed.preferences),
    updatedAt: new Date().toISOString(),
  };
}

/** 把档案格式化为注入 agent 的文本 */
export function formatProfile(profile: UserProfile): string {
  const parts: string[] = [];
  if (profile.concerns.length) parts.push(`关注点: ${profile.concerns.join('、')}`);
  if (profile.pastProcedures.length) parts.push(`既往咨询/项目: ${profile.pastProcedures.join('、')}`);
  if (profile.preferences.length) parts.push(`偏好: ${profile.preferences.join('、')}`);
  return parts.length ? parts.join('\n') : '';
}

// 启动时从磁盘加载
loadProfilesFromDisk();

/** 测试辅助：清空内存 store 并重载磁盘 */
export function _resetProfilesForTest(): void {
  profileStore.clear();
  loadProfilesFromDisk();
}
