// ===== 共享状态 =====

export interface CoordinatorDecision {
  needsAesthetic: boolean;
  needsSurgeon: boolean;
  needsRisk: boolean;
  needsCare: boolean;
  complexity: 'simple' | 'medium' | 'complex';
  plan: string[];
  reasoning: string;
}

/** 美学分析结果（含照片视觉分析） */
export interface AestheticResult {
  analyzed: boolean; // 是否基于照片分析（有图时 true）
  photoObservations: string[]; // 照片观察要点（有图时）
  facialAnalysis: string; // 面部/形体美学评估描述
  concerns: string[]; // 用户关注点 / 可能存在的美学问题
  suggestions: string[]; // 可考虑的改善方向（非手术/手术）
  confidence: number; // 0-100
}

/** 整形手术项目建议结果 */
export interface SurgeonResult {
  procedures: Procedure[];
  warnings: string[];
  sources?: string[];
}

export interface Procedure {
  name: string;
  type: string;
  description: string;
  indication: string;
  recoveryTime: string;
  risks: string[];
  suitable: boolean;
}

/** 术前风险评估结果 */
export interface RiskAssessmentResult {
  riskLevel: 'low' | 'medium' | 'high';
  riskFactors: string[];
  contraindications: string[];
  recommendations: string[];
}

/** 术后护理建议结果 */
export interface CareResult {
  recoveryTimeline: string;
  careTips: string[];
  warningSigns: string[]; // 需立即就医的警示信号
  followUp: string;
}

/** 总顾问最终建议 */
export interface AdvisorResult {
  summary: string;
  aestheticAnalysis?: string;
  recommendedProcedures: RecommendedProcedure[];
  riskAssessment?: string;
  carePlan?: string;
  precautions: string[];
  references: string[];
  urgency: string;
  disclaimer: string;
}

export interface RecommendedProcedure {
  name: string;
  reason: string;
  expectedOutcome: string;
  precautions: string[];
}

export interface AgentState {
  userMessage: string;
  image?: string; // data URI（照片，可选）
  // ---- 记忆三件套字段（均由 memory 门面注入，均可选） ----
  sessionId?: string;
  userId?: string;
  summary?: string; // 早期对话摘要（短期记忆）
  recentHistory?: { role: 'user' | 'assistant'; content: string }[]; // 最近对话窗口
  userProfile?: string; // 长期用户档案文本
  relevantHistory?: string; // 向量检索到的相关历史文本
  // ---- HITL 人工审批 ----
  hitlApproved?: boolean; // 手术建议是否经用户确认
  hitlFeedback?: string; // 用户审批反馈
  coordinatorDecision?: CoordinatorDecision;
  aestheticResults?: AestheticResult;
  surgeonResults?: SurgeonResult;
  riskResults?: RiskAssessmentResult;
  careResults?: CareResult;
  advisorResults?: AdvisorResult;
  errors: string[];
}

// ===== Agent 接口（不暴露底层模型类型）=====

export interface IAgent {
  name: string;
  description: string;
  execute(state: AgentState): Promise<Partial<AgentState>>;
}

// ===== Coordinator 内部分析结果 =====

import { z } from 'zod';

export const CoordinatorAnalysisSchema = z.object({
  needsAesthetic: z.boolean(),
  needsSurgeon: z.boolean(),
  needsRisk: z.boolean(),
  needsCare: z.boolean(),
  complexity: z.enum(['simple', 'medium', 'complex']),
  reasoning: z.string(),
});
export type CoordinatorAnalysis = z.infer<typeof CoordinatorAnalysisSchema>;

export const AestheticResultSchema = z.object({
  analyzed: z.boolean(),
  photoObservations: z.array(z.string()),
  facialAnalysis: z.string(),
  concerns: z.array(z.string()),
  suggestions: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});

export const RiskAssessmentResultSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']),
  riskFactors: z.array(z.string()),
  contraindications: z.array(z.string()),
  recommendations: z.array(z.string()),
});

// ===== SSE 事件类型 =====

export type SseEvent =
  | { type: 'agent_start'; agent: string }
  | { type: 'agent_complete'; agent: string; summary: string }
  | { type: 'hitl_required'; procedures: { name: string; risks: string[] }[]; question: string; threadId: string }
  | { type: 'final_result'; data: AdvisorResult }
  | { type: 'error'; message: string }
  | { type: 'done' };
