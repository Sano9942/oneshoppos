import { useState, useEffect, useCallback, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { Send, X, User, Phone, MessageSquare } from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";
import { api } from "../../api";

const STATUS_TONES = { open: "success", closed: "default", snoozed: "warning" };

export default function MessagingInboxRedesign() {
  const { authHeaders, employee } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get(`/messaging/threads?status=${statusFilter}`);
      setThreads(result.threads || []);
    } catch { setThreads([]); }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const loadMessages = async (threadId) => {
    try {
      const result = await api.get(`/messaging/threads/${threadId}/messages?limit=100`);
      setMessages(result.messages || []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch { setMessages([]); }
  };

  const selectThread = (thread) => {
    setSelectedThread(thread);
    loadMessages(thread.id);
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selectedThread) return;
    setSending(true);
    try {
      await api.post(`/messaging/threads/${selectedThread.id}/send`, { content: replyText.trim() });
      setReplyText("");
      loadMessages(selectedThread.id);
      loadThreads();
    } catch (err) { toast.error(err.message); }
    setSending(false);
  };

  const toggleThreadStatus = async (threadId, newStatus) => {
    try {
      await api.put(`/messaging/threads/${threadId}`, { status: newStatus });
      loadThreads();
      if (selectedThread?.id === threadId) setSelectedThread({ ...selectedThread, status: newStatus });
    } catch (err) { toast.error(err.message); }
  };

  if (!flagsLoading && !flags.customer_messaging) return <Navigate to="/dashboard" replace />;

  return (
    <PageShell title="Messaging Inbox">
      <div className="flex gap-4 h-[calc(100vh-180px)]">
        {/* Thread list */}
        <div className="w-80 shrink-0 flex flex-col border border-(--ui-border) rounded-lg overflow-hidden bg-(--ui-bg)">
          <div className="p-3 border-b border-(--ui-border)">
            <select className="w-full border border-(--ui-border) rounded px-2 py-1.5 text-sm bg-(--ui-bg)" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="overflow-y-auto grow">
            {loading ? <p className="text-center text-(--ui-text-muted) py-4">Loading...</p> :
              threads.length === 0 ? <p className="text-center text-(--ui-text-muted) py-4">No threads</p> :
              threads.map((t) => (
                <button key={t.id} onClick={() => selectThread(t)}
                  className={`w-full text-left p-3 border-b border-(--ui-border) hover:bg-(--ui-bg-hover) ${selectedThread?.id === t.id ? "bg-(--ui-bg-hover)" : ""}`}>
                  <div className="flex justify-between items-start">
                    <span className="font-medium text-sm truncate">{t.customer_name || t.channel_identifier}</span>
                    {t.unread_count > 0 && <Badge tone="danger">{t.unread_count}</Badge>}
                  </div>
                  <p className="text-xs text-(--ui-text-muted) truncate mt-0.5">{t.last_message || "No messages"}</p>
                  <div className="flex gap-1 items-center mt-1">
                    <Badge tone={STATUS_TONES[t.status]}>{t.status}</Badge>
                    <span className="text-xs text-(--ui-text-muted)">{t.channel}</span>
                  </div>
                </button>
              ))}
          </div>
        </div>

        {/* Message pane */}
        <div className="grow flex flex-col border border-(--ui-border) rounded-lg overflow-hidden bg-(--ui-bg)">
          {!selectedThread ? (
            <div className="flex items-center justify-center h-full text-(--ui-text-muted)">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>Select a conversation</p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="p-3 border-b border-(--ui-border) flex justify-between items-center">
                <div>
                  <h3 className="font-medium">{selectedThread.customer_name || selectedThread.channel_identifier}</h3>
                  <div className="flex gap-2 text-xs text-(--ui-text-muted)">
                    {selectedThread.customer_mobile && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{selectedThread.customer_mobile}</span>}
                    <span>{selectedThread.channel}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {selectedThread.status === "open" ? (
                    <Button size="sm" tone="plain" onClick={() => toggleThreadStatus(selectedThread.id, "closed")}>Close</Button>
                  ) : (
                    <Button size="sm" tone="plain" onClick={() => toggleThreadStatus(selectedThread.id, "open")}>Reopen</Button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="grow overflow-y-auto p-4 space-y-3">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === "outbound" ? "bg-blue-600 text-white" : "bg-(--ui-bg-hover) text-(--ui-text)"
                    }`}>
                      <p>{m.content}</p>
                      <p className={`text-xs mt-1 ${m.direction === "outbound" ? "text-blue-200" : "text-(--ui-text-muted)"}`}>
                        {fmtUtcDateTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply composer */}
              <div className="p-3 border-t border-(--ui-border) flex gap-2">
                <input
                  className="grow border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) text-sm"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                  placeholder="Type a message..."
                />
                <Button onClick={sendReply} disabled={sending || !replyText.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
