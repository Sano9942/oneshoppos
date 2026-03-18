import { createContext, useCallback, useContext, useState } from "react";

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

  const COLORS = {
    success: "bg-emerald-600 text-white",
    error: "bg-red-600 text-white",
    warning: "bg-amber-500 text-white",
    info: "bg-(--ui-surface) text-(--ui-text) border border-(--ui-border)",
  };

  return (
    <ToastContext.Provider value={{ toast, success, error, warning }}>
      {children}
      <div className="fixed bottom-4 right-4 z-200 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-right-4 duration-200 ${COLORS[t.type] || COLORS.info}`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-2 opacity-70 hover:opacity-100 cursor-pointer"
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
