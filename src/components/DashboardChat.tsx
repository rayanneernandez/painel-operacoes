import { useEffect, useRef, useState } from 'react';
import { X, Send, Loader2, User, ChevronDown } from 'lucide-react';

export type ChatContext = {
  dashboardName: string;
  data: Record<string, unknown>;
};

export type QueryFn = (startDate: string, endDate: string) => Promise<Record<string, unknown>>;

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
};

type HistoryMsg = { role: 'user' | 'assistant'; content: string };

function TypingDots() {
  return (
    <span className="inline-flex gap-1 items-center h-4">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

export function DashboardChat({ context }: { context: ChatContext; queryFn?: QueryFn }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HistoryMsg[]>([]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 100);
    if (messages.length === 0) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `Olá! Sou a **Lia**, assistente do **${context.dashboardName}**. Pode me perguntar sobre os dados atuais.`,
      }]);
    }
  }, [open, messages.length, context.dashboardName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function setAssistant(id: string, content: string, loadingState = false) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content, loading: loadingState } : m)));
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userText = input.trim();
    const userId = Date.now().toString();
    const assistId = (Date.now() + 1).toString();

    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: userText },
      { id: assistId, role: 'assistant', content: '', loading: true },
    ]);
    setInput('');
    setLoading(true);
    historyRef.current.push({ role: 'user', content: userText });

    try {
      const response = await fetch('/api/lia-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          messages: historyRef.current,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || `HTTP ${response.status}`);

      const text = String(json?.text || '').trim() || 'Não consegui responder agora.';
      setAssistant(assistId, text, false);
      historyRef.current.push({ role: 'assistant', content: text });
    } catch (error) {
      console.error('[Lia]', error);
      setAssistant(assistId, 'Erro ao conectar com a Lia. Verifique a chave da Anthropic no ambiente e tente novamente.', false);
    } finally {
      setLoading(false);
    }
  }

  function renderContent(text: string) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 rounded-full shadow-lg shadow-violet-900/40 hover:scale-105 transition-transform overflow-hidden border-2 border-violet-500/60"
        style={{ width: 52, height: 52 }}
        title="Lia - Assistente IA"
      >
        {open ? (
          <div className="w-full h-full bg-[#0d1117] flex items-center justify-center">
            <ChevronDown size={20} className="text-violet-400" />
          </div>
        ) : (
          <img src="/lia.png" alt="Lia" className="w-full h-full object-cover" />
        )}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[360px] max-h-[520px] flex flex-col rounded-2xl border border-gray-700/60 bg-[#0d1117] shadow-2xl shadow-black/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full overflow-hidden border border-violet-500/40">
                <img src="/lia.png" alt="Lia" className="w-full h-full object-cover" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Lia</div>
                <div className="text-[10px] text-gray-500">{context.dashboardName}</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-600 hover:text-gray-400 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0" style={{ maxHeight: 380 }}>
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className="flex-shrink-0 w-6 h-6 rounded-full overflow-hidden mt-0.5 border border-gray-700/40">
                  {msg.role === 'user' ? (
                    <div className="w-full h-full bg-indigo-600/20 flex items-center justify-center">
                      <User size={12} className="text-indigo-400" />
                    </div>
                  ) : (
                    <img src="/lia.png" alt="Lia" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className={`max-w-[260px] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-600/20 text-gray-200 rounded-tr-sm'
                    : 'bg-gray-800/60 text-gray-300 rounded-tl-sm'
                }`}>
                  {msg.loading ? (
                    <TypingDots />
                  ) : (
                    <span dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }} />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="px-3 py-3 border-t border-gray-800/60">
            <div className="flex items-center gap-2 bg-gray-800/50 rounded-xl px-3 py-2 border border-gray-700/40 focus-within:border-violet-500/40 transition-colors">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="Pergunte sobre os dados..."
                className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="flex-shrink-0 w-6 h-6 rounded-lg bg-violet-600 disabled:opacity-30 flex items-center justify-center hover:bg-violet-500 transition-colors"
              >
                {loading ? <Loader2 size={12} className="text-white animate-spin" /> : <Send size={12} className="text-white" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
