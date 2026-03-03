import React from "react";
import { X } from "lucide-react";
import { usePOS } from "./POSContext";

export default function POSNoteModal() {
  const { showNoteModal, setShowNoteModal, orderNote, setOrderNote } = usePOS();

  if (!showNoteModal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-bold text-slate-800">Order Note</h3>
          <button
            onClick={() => setShowNoteModal(false)}
            className="text-slate-400 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <textarea
            value={orderNote}
            onChange={(e) => setOrderNote(e.target.value)}
            autoFocus
            className="w-full border-2 border-slate-200 rounded-lg px-4 py-3 focus:border-[#8066FF] outline-none min-h-25 resize-none text-slate-800"
            placeholder="Add instructions or comments for this order…"
          />
          <button
            onClick={() => setShowNoteModal(false)}
            className="mt-3 w-full bg-[#8066FF] hover:bg-[#7055E6] text-white font-bold py-2.5 rounded-lg transition"
          >
            Save Note
          </button>
        </div>
      </div>
    </div>
  );
}
