import { usePOS } from "./POSContext";
import { Keyboard, X } from "lucide-react";

const SHORTCUTS = [
  { key: "F1", action: "Toggle this help" },
  { key: "F2", action: "Apply discount" },
  { key: "F3", action: "Park sale" },
  { key: "F4", action: "Customer search" },
  { key: "F5", action: "View parked sales" },
  { key: "F8", action: "Remove last item" },
  { key: "F9", action: "Checkout / Pay" },
  { key: "F10", action: "Clear cart" },
  { key: "Esc", action: "Close modal" },
];

export default function POSShortcutsOverlay() {
  const { showShortcutsOverlay, setShowShortcutsOverlay } = usePOS();
  if (!showShortcutsOverlay) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={() => setShowShortcutsOverlay(false)}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-(--ui-surface) p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-(--ui-text)">
            <Keyboard size={20} />
            <h2 className="text-lg font-bold">Keyboard Shortcuts</h2>
          </div>
          <button onClick={() => setShowShortcutsOverlay(false)} className="text-(--ui-text-muted) hover:text-(--ui-text) cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-1">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-(--ui-text)">{s.action}</span>
              <kbd className="rounded bg-(--ui-muted-surface) px-2 py-0.5 font-mono text-xs text-(--ui-text-muted) border border-(--ui-border)">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-(--ui-text-muted) text-center">
          Press F1 or Esc to close
        </p>
      </div>
    </div>
  );
}
