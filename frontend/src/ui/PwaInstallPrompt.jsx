import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * PWA install prompt (Item 15, Option A).
 *
 * Listens for `beforeinstallprompt` (Chrome/Edge desktop + Android Chrome).
 * Renders a dismissible banner the first time the browser offers the
 * installation. Dismissal is remembered in localStorage so we don't nag.
 *
 * iOS Safari does not fire this event — users must use "Add to Home Screen"
 * from the share sheet manually. We don't show a fallback banner there to
 * avoid noise; can be added later if install rate needs a push.
 */
const DISMISSED_KEY = "pwa_install_dismissed";

export default function PwaInstallPrompt() {
  const [prompt, setPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    const choice = await prompt.userChoice;
    setVisible(false);
    if (choice.outcome === "dismissed") {
      // User dismissed the native prompt — respect that across sessions.
      localStorage.setItem(DISMISSED_KEY, "1");
    }
    setPrompt(null);
  };

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
    setPrompt(null);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 z-200 max-w-sm rounded-xl border border-emerald-200 bg-white shadow-lg p-3 flex items-start gap-3">
      <div className="shrink-0 grid place-items-center h-9 w-9 rounded-full bg-emerald-100 text-emerald-700">
        <Download size={18} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-800">Install SanoPOS</p>
        <p className="text-xs text-slate-600 mt-0.5">
          Add to your home screen for a faster, app-like experience.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={install}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
          >
            Install
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50"
          >
            Not now
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-slate-400 hover:text-slate-700"
      >
        <X size={16} />
      </button>
    </div>
  );
}
