import { createContext, useCallback, useContext, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

const ToastContext = createContext(null);
let _id = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message, type = "info") => {
    const id = ++_id;
    setToasts((prev) => {
      const next = [...prev, { id, message, type }];
      return next.length > 3 ? next.slice(-3) : next;
    });
    setTimeout(() => dismiss(id), 4000);
    return id;
  }, [dismiss]);

  const success = useCallback((msg) => toast(msg, "success"), [toast]);
  const error = useCallback((msg) => toast(msg, "error"), [toast]);
  const warning = useCallback((msg) => toast(msg, "warning"), [toast]);

  // Square-style toast: near-black pill, white text, colored status icon.
  const ICONS = {
    success: <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />,
    error: <XCircle size={16} className="shrink-0 text-red-400" />,
    warning: <AlertTriangle size={16} className="shrink-0 text-amber-400" />,
    info: <Info size={16} className="shrink-0 text-white/70" />,
  };

  return (
    <ToastContext.Provider value={{ toast, success, error, warning }}>
      {children}
      <div className="fixed bottom-4 left-4 z-200 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="ui-anim-fade pointer-events-auto flex items-center gap-2.5 rounded-(--ui-radius-md) bg-(--ui-primary) px-4 py-2.5 text-sm font-medium text-white shadow-(--ui-shadow-lg)"
          >
            {ICONS[t.type] || ICONS.info}
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-2 cursor-pointer opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}
