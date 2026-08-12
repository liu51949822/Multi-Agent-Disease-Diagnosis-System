// SSE 事件类型（与后端 SseEvent 对应）
export type SseEvent =
  | { type: 'agent_start'; agent: string }
  | { type: 'agent_complete'; agent: string; summary: string }
  | { type: 'hitl_required'; procedures: { name: string; risks: string[] }[]; question: string; threadId: string }
  | { type: 'final_result'; data: AdvisorResult }
  | { type: 'error'; message: string }
  | { type: 'done' };

// Agent 执行轨迹状态
export interface AgentTrace {
  agent: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  summary?: string;
}

// 最终建议结果（与后端 AdvisorResult 对应）
export interface RecommendedProcedure {
  name: string;
  reason: string;
  expectedOutcome: string;
  precautions: string[];
}

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

// 聊天消息（UI 层）
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  image?: string; // 用户消息携带的照片 data URI
  traces?: AgentTrace[];
  result?: AdvisorResult;
  error?: string;
  streaming?: boolean;
}
