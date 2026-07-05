import React from "react";
import { X } from "lucide-react";
import { usePOS } from "./POSContext";

export default function POSNoteModal() {
  const { showNoteModal, setShowNoteModal, orderNote, setOrderNote } = usePOS();

  if (!showNoteModal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border) bg-(--ui-muted-surface)">
          <h3 className="font-bold text-(--ui-text)">Order Note</h3>
          <button
            onClick={() => setShowNoteModal(false)}
            className="text-(--ui-text-muted) hover:text-(--ui-text)"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <textarea
            value={orderNote}
            onChange={(e) => setOrderNote(e.target.value)}
            autoFocus
            className="w-full border border-(--ui-border-strong) rounded-lg px-4 py-3 focus:border-(--ui-focus) outline-none min-h-25 resize-none text-(--ui-text)"
            placeholder="Add instructions or comments for this order…"
          />
          <button
            onClick={() => setShowNoteModal(false)}
            className="mt-3 w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-bold py-2.5 rounded-lg transition"
          >
            Save Note
          </button>
        </div>
      </div>
    </div>
  );
}
