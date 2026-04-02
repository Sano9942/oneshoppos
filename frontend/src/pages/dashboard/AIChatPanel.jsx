import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { api } from "../../api";

function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-(--ui-primary) text-white rounded-br-sm"
            : "bg-(--ui-muted-surface) text-(--ui-text) rounded-bl-sm"
        }`}
      >
        {msg.text}
      </div>
    </div>
  );
}

export function AIChatPanel({ flagEnabled }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  if (!flagEnabled) return null;

  const sendMessage = async () => {
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    setError("");
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setLoading(true);

    try {
      const res = await api.raw("/api/insights/ask", {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to get response");
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: data.error || "Sorry, something went wrong." },
        ]);
      } else {
        setMessages((prev) => [...prev, { role: "ai", text: data.answer }]);
      }
    } catch {
      setError("Network error");
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: "Network error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-(--ui-primary) px-4 py-3 text-white shadow-lg hover:opacity-90 transition"
          title="Ask AI"
        >
          <Sparkles size={18} />
          <span className="text-sm font-medium hidden sm:inline">Ask AI</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col w-80 sm:w-96 h-[28rem] rounded-xl border border-(--ui-border) bg-(--ui-surface) shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-(--ui-border) px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-(--ui-primary)" />
              <span className="text-sm font-semibold text-(--ui-text)">Ask AI</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) transition"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            {messages.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-(--ui-text-muted)">
                <Sparkles size={32} className="mb-2 opacity-30" />
                <p className="text-sm">Ask a question about your store data.</p>
                <p className="text-xs mt-1 opacity-70">e.g. "What are my best-selling products?"</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatMessage key={i} msg={msg} />
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-xl bg-(--ui-muted-surface) px-3 py-2 text-sm text-(--ui-text-muted)">
                  <Loader2 size={14} className="animate-spin" />
                  Thinking...
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-(--ui-border) px-3 py-2">
            {error && (
              <p className="text-xs text-red-500 mb-1">{error}</p>
            )}
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                maxLength={500}
                disabled={loading}
                className="flex-1 rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted) focus:outline-none focus:ring-2 focus:ring-(--ui-primary) disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="rounded-lg bg-(--ui-primary) p-2 text-white hover:opacity-90 transition disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
