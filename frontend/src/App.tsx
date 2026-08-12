import { useState, useEffect, useRef } from 'react';
import { chatService } from './services/chatService';
import type { ChatMessage, AgentTrace, SseEvent, AdvisorResult } from './types/chat';
import './index.css';

const AGENT_LABELS: Record<string, string> = {
  coordinator: '任务协调',
  aesthetic: '美学分析',
  surgeon: '手术咨询',
  risk: '术前评估',
  care: '术后护理',
  advisor: '综合建议',
};

const AGENT_ICONS: Record<string, string> = {
  coordinator: '🧭',
  aesthetic: '🪞',
  surgeon: '🏥',
  risk: '⚠️',
  care: '🩹',
  advisor: '📋',
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function TracePanel({ traces }: { traces: AgentTrace[] }) {
  return (
    <div className="space-y-2 py-2">
      {traces.map((t) => (
        <div key={t.agent} className="flex items-start gap-3">
          <div className={`w-7 h-7 flex items-center justify-center rounded-full text-sm flex-shrink-0 mt-0.5
            ${t.status === 'done' ? 'bg-green-100' : t.status === 'running' ? 'bg-blue-100' : t.status === 'error' ? 'bg-red-100' : 'bg-gray-100'}`}>
            {t.status === 'running' ? (
              <span className="animate-spin text-xs">⟳</span>
            ) : (
              <span>{AGENT_ICONS[t.agent] ?? '•'}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium
                ${t.status === 'done' ? 'text-green-700' : t.status === 'running' ? 'text-blue-700' : 'text-gray-500'}`}>
                {t.label}
              </span>
              {t.status === 'running' && (
                <span className="text-xs text-blue-500 animate-pulse">处理中...</span>
              )}
            </div>
            {t.summary && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{t.summary}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultCard({ result }: { result: AdvisorResult }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-800 leading-relaxed">{result.summary}</p>

      {result.aestheticAnalysis && (
        <div className="bg-pink-50 rounded-lg p-3">
          <div className="font-semibold text-pink-800 mb-1">🪞 美学分析</div>
          <p className="text-gray-700">{result.aestheticAnalysis}</p>
        </div>
      )}

      {result.recommendedProcedures.length > 0 && (
        <div className="space-y-2">
          <div className="font-semibold text-gray-800">🏥 建议咨询项目</div>
          {result.recommendedProcedures.map((p, i) => (
            <div key={i} className="bg-green-50 rounded-lg p-3 border border-green-200">
              <div className="font-medium text-gray-800">{p.name}</div>
              <div className="text-gray-600 mt-1">{p.reason}</div>
              <div className="text-blue-700 mt-1">预期效果（参考）：{p.expectedOutcome}</div>
              {p.precautions.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {p.precautions.map((pc, j) => (
                    <li key={j} className="text-xs text-amber-700">⚠ {pc}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {result.riskAssessment && (
        <div className="bg-red-50 rounded-lg p-3">
          <div className="font-semibold text-red-800 mb-1">⚠️ 术前风险评估</div>
          <p className="text-gray-700">{result.riskAssessment}</p>
        </div>
      )}

      {result.carePlan && (
        <div className="bg-blue-50 rounded-lg p-3">
          <div className="font-semibold text-blue-800 mb-1">🩹 术后护理建议</div>
          <p className="text-gray-700">{result.carePlan}</p>
        </div>
      )}

      {result.precautions.length > 0 && (
        <div className="bg-amber-50 rounded-lg p-3">
          <div className="font-semibold text-amber-800 mb-1">📌 注意事项</div>
          <ul className="space-y-1">
            {result.precautions.map((p, i) => <li key={i} className="text-gray-700">• {p}</li>)}
          </ul>
        </div>
      )}

      <div className="bg-gray-50 rounded-lg p-3 border-l-4 border-blue-400">
        <div className="font-semibold text-gray-700 mb-1">面诊建议</div>
        <p className="text-gray-600">{result.urgency}</p>
      </div>

      <p className="text-xs text-gray-400 italic">{result.disclaimer}</p>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-blue-600 text-white rounded-2xl px-4 py-3 space-y-2">
          {msg.image && (
            <img src={msg.image} alt="uploaded" className="max-h-48 rounded-lg object-cover" />
          )}
          {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        {/* 执行轨迹 */}
        {msg.traces && msg.traces.length > 0 && (
          <div className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
            <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
              Agent 执行轨迹
            </div>
            <TracePanel traces={msg.traces} />
          </div>
        )}

        {/* 最终结果 */}
        {msg.result && (
          <div className="bg-white rounded-xl px-4 py-4 border border-gray-200 shadow-sm">
            <ResultCard result={msg.result} />
          </div>
        )}

        {/* 错误 */}
        {msg.error && (
          <div className="bg-red-50 rounded-xl px-4 py-3 text-red-700 text-sm">
            {msg.error}
          </div>
        )}

        {/* 仅流式处理中，尚无结果时显示省略号 */}
        {msg.streaming && !msg.result && !msg.error && msg.traces?.every(t => t.status === 'pending') && (
          <div className="bg-gray-100 rounded-2xl px-4 py-3">
            <div className="flex space-x-1">
              {[0, 0.15, 0.3].map((d, i) => (
                <div key={i} className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${d}s` }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<string | undefined>(undefined);
  const [imageError, setImageError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 记忆参数：sessionId/userId 由前端生成并存 localStorage（无鉴权，演示用）
  const [sessionId] = useState(() => localStorage.getItem('wa-session') ?? (() => {
    const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('wa-session', id);
    return id;
  })());
  const [userId] = useState(() => localStorage.getItem('wa-user') ?? (() => {
    const id = `user-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('wa-user', id);
    return id;
  })());
  // HITL 审批状态
  const [hitlWaiting, setHitlWaiting] = useState(false);
  const [hitlProcs, setHitlProcs] = useState<{ name: string; risks: string[] }[]>([]);
  const [hitlThreadId, setHitlThreadId] = useState('');
  const pendingResumeRef = useRef<boolean | null>(null);

  useEffect(() => {
    chatService.checkHealth()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateAssistantMsg = (id: string, patch: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  };

  const handleFileSelect = (file: File) => {
    setImageError('');
    if (!ALLOWED_TYPES.includes(file.type)) {
      setImageError('仅支持 PNG / JPEG / WebP 图片');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError('图片大小不能超过 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.onerror = () => setImageError('图片读取失败，请重试');
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    if ((!input.trim() && !image) || loading) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: input.trim() || undefined, image };
    const assistantId = `${Date.now()}-ai`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      traces: [],
      streaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setImage(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setLoading(true);

    abortRef.current = new AbortController();

    try {
      // 历史对话作为短期记忆的事实来源传给后端（只取 role + content 精简字段）
      const history = messages
        .filter(m => m.content && !m.streaming)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));

      await chatService.streamConsult(
        userMsg.content ?? '',
        image,
        (event: SseEvent) => {
          if (event.type === 'agent_start') {
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m;
              const existing = m.traces?.find(t => t.agent === event.agent);
              if (existing) return m;
              const newTrace: AgentTrace = {
                agent: event.agent,
                label: AGENT_LABELS[event.agent] ?? event.agent,
                status: 'running',
              };
              return { ...m, traces: [...(m.traces ?? []), newTrace] };
            }));
          } else if (event.type === 'agent_complete') {
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m;
              const traces = (m.traces ?? []).map(t =>
                t.agent === event.agent ? { ...t, status: 'done' as const, summary: event.summary } : t
              );
              return { ...m, traces };
            }));
          } else if (event.type === 'hitl_required') {
            // HITL：暂停流式，弹出审批对话框
            setHitlProcs(event.procedures ?? []);
            setHitlThreadId(event.threadId);
            setHitlWaiting(true);
          } else if (event.type === 'final_result') {
            updateAssistantMsg(assistantId, { result: event.data, streaming: false });
          } else if (event.type === 'error') {
            updateAssistantMsg(assistantId, { error: event.message, streaming: false });
          } else if (event.type === 'done') {
            updateAssistantMsg(assistantId, { streaming: false });
          }
        },
        abortRef.current.signal,
        { sessionId, userId, history },
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        updateAssistantMsg(assistantId, { error: `请求失败：${err.message}`, streaming: false });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // HITL 审批：用户确认/拒绝后 resume 图执行
  const handleResume = async (approved: boolean) => {
    setHitlWaiting(false);
    setLoading(true);
    const assistantId = `${Date.now()}-resume`;
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', traces: [], streaming: true }]);
    try {
      await chatService.streamConsult(
        '.', // resume 时消息可空，仅用于 continuation
        undefined,
        (event: SseEvent) => {
          if (event.type === 'agent_start') {
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m;
              return { ...m, traces: [...(m.traces ?? []), { agent: event.agent, label: AGENT_LABELS[event.agent] ?? event.agent, status: 'running' as const }] };
            }));
          } else if (event.type === 'agent_complete') {
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m;
              return { ...m, traces: (m.traces ?? []).map(t => t.agent === event.agent ? { ...t, status: 'done' as const, summary: event.summary } : t) };
            }));
          } else if (event.type === 'final_result') {
            updateAssistantMsg(assistantId, { result: event.data, streaming: false });
          } else if (event.type === 'error') {
            updateAssistantMsg(assistantId, { error: event.message, streaming: false });
          } else if (event.type === 'done') {
            updateAssistantMsg(assistantId, { streaming: false });
          }
        },
        undefined,
        { sessionId, userId, history: messages.filter(m => m.content && !m.streaming).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string })) },
        { resume: approved, threadId: hitlThreadId },
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        updateAssistantMsg(assistantId, { error: `Resume 失败：${err.message}`, streaming: false });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-rose-100 flex flex-col">
      {/* 导航栏 */}
      <nav className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🪞</span>
            <span className="font-bold text-gray-800">整形美容智能顾问</span>
            <span className="text-xs bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full">多智能体</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className={`w-2 h-2 rounded-full ${connected === null ? 'bg-gray-300' : connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-gray-500">{connected === null ? '检查中' : connected ? '已连接' : '未连接'}</span>
          </div>
        </div>
      </nav>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="text-center pt-16 space-y-4">
              <div className="text-5xl">🪞</div>
              <h2 className="text-2xl font-bold text-gray-800">欢迎使用整形美容智能顾问</h2>
              <p className="text-gray-500 text-sm">多智能体协作 · 实时执行追踪 · 可上传照片进行美学分析</p>
              <div className="grid grid-cols-2 gap-2 max-w-lg mx-auto pt-4">
                {['我想做双眼皮，需要注意什么？', '我脸型偏方，适合做下颌角手术吗？', '玻尿酸填充和肉毒素有什么区别？', '做完抽脂手术后怎么护理？'].map((q) => (
                  <button key={q} onClick={() => setInput(q)}
                    className="p-3 text-left bg-white hover:bg-pink-50 rounded-xl text-sm text-gray-700 border border-gray-200 transition-colors shadow-sm">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map(m => <MessageBubble key={m.id} msg={m} />)}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入区 */}
      <div className="bg-white border-t border-gray-200 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-3 space-y-2">
          {/* 照片预览 */}
          {image && (
            <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-2">
              <img src={image} alt="preview" className="h-16 w-16 object-cover rounded-lg" />
              <span className="text-xs text-gray-500 flex-1">照片已就绪，将随问题一起发送给美学分析师</span>
              <button onClick={() => { setImage(undefined); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                className="text-xs text-red-500 hover:text-red-700">移除</button>
            </div>
          )}
          {imageError && <p className="text-xs text-red-500">{imageError}</p>}

          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
            />
            <button onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm text-gray-700 disabled:opacity-50 flex-shrink-0"
              title="上传照片">
              📷
            </button>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述您的整形美容诉求，或上传照片后咨询..."
              disabled={loading || !connected}
              rows={1}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-pink-500 resize-none disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
            <button onClick={handleSend}
              disabled={loading || (!input.trim() && !image) || !connected}
              className="px-5 py-2.5 bg-pink-600 text-white rounded-xl hover:bg-pink-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium text-sm flex-shrink-0">
              {loading ? '处理中' : '发送'}
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center">AI 回复仅供参考，整形/医疗建议请务必咨询专业医生面诊</p>
        </div>
      </div>

      {/* HITL 审批对话框 */}
      {hitlWaiting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm mx-4 w-full">
            <div className="text-center mb-4">
              <span className="text-3xl">⚠️</span>
              <h3 className="text-lg font-bold text-gray-800 mt-2">手术建议审批</h3>
              <p className="text-sm text-gray-500 mt-1">系统已将手术建议提交审核</p>
            </div>
            <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
              {hitlProcs.map((p, i) => (
                <div key={i} className="bg-amber-50 rounded-lg p-3">
                  <div className="font-semibold text-gray-800">{p.name}</div>
                  {p.risks.length > 0 && (
                    <ul className="mt-1 text-xs text-red-600">
                      {p.risks.map((r, j) => <li key={j}>⚠ {r}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => handleResume(false)}
                className="flex-1 py-2.5 bg-gray-200 hover:bg-gray-300 rounded-xl font-semibold text-gray-700">
                拒绝，仅咨询
              </button>
              <button onClick={() => handleResume(true)}
                className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 rounded-xl font-semibold text-white">
                确认，继续评估
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
