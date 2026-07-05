import { useRef, useState } from "react";
import { useCurrency } from "../../../contexts/CurrencyContext";

const TAB_KEYS = ["all", "matched", "short", "over", "unmatched", "duplicate"];

const TAB_FILTERS = {
  all: null,
  matched: "matched",
  short: "short",
  over: "over",
  unmatched: "unmatched",
  duplicate: "duplicate",
};

const MATCH_PILL = {
  matched: "bg-(--ui-success-bg) text-(--ui-success-fg)",
  short: "bg-(--ui-danger-bg) text-(--ui-danger-fg)",
  over: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
  unmatched: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
  duplicate: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
};

export default function LineTable({ lines, readOnly, onResolveNote, onManualMatch }) {
  const { fmt } = useCurrency();
  const [tab, setTab] = useState("all");
  const [editingNoteFor, setEditingNoteFor] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const cancelledRef = useRef(false);

  const counts = {
    all: lines.length,
    matched: lines.filter((l) => l.match_status === "matched").length,
    short: lines.filter((l) => l.match_status === "short").length,
    over: lines.filter((l) => l.match_status === "over").length,
    unmatched: lines.filter((l) => l.match_status === "unmatched").length,
    duplicate: lines.filter((l) => l.match_status === "duplicate").length,
  };

  const filter = TAB_FILTERS[tab];
  const visible = filter ? lines.filter((l) => l.match_status === filter) : [...lines];

  if (tab === "short" || tab === "over") {
    visible.sort((a, b) => Math.abs(Number(b.difference || 0)) - Math.abs(Number(a.difference || 0)));
  } else if (tab === "unmatched") {
    visible.sort((a, b) => Number(b.remitted_amount || 0) - Number(a.remitted_amount || 0));
  }

  async function commitNote(line) {
    const note = noteDraft;
    setEditingNoteFor(null);
    setNoteDraft("");
    await onResolveNote(line.id, note);
  }

  function cancelNote() {
    setEditingNoteFor(null);
    setNoteDraft("");
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-(--border)">
        {TAB_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-xs font-medium rounded-t-md transition-colors ${
              tab === k
                ? "bg-(--bg-subtle) text-(--text-primary) border-b-2 border-(--accent)"
                : "text-(--text-muted) hover:text-(--text-primary)"
            }`}
          >
            {k.charAt(0).toUpperCase() + k.slice(1)}
            <span className="ml-1 text-[10px] opacity-70">({counts[k]})</span>
          </button>
        ))}
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <div className="py-12 text-center text-(--text-muted) text-sm">No lines in this view.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-(--bg-subtle) text-(--text-muted) uppercase">
              <th className="text-left px-3 py-2 font-medium">Tracking</th>
              <th className="text-left px-3 py-2 font-medium">Courier Ref</th>
              <th className="text-left px-3 py-2 font-medium">Matched Order</th>
              <th className="text-right px-3 py-2 font-medium">Expected</th>
              <th className="text-right px-3 py-2 font-medium">Remitted</th>
              <th className="text-right px-3 py-2 font-medium">Fee</th>
              <th className="text-right px-3 py-2 font-medium">Difference</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {visible.map((line) => {
              const diff = Number(line.difference || 0);
              const diffColor =
                diff < 0
                  ? "text-(--ui-danger-fg)"
                  : diff > 0
                  ? "text-(--ui-text)"
                  : "text-(--text-muted)";
              return (
                <tr key={line.id} className="hover:bg-(--bg-subtle)/40">
                  <td className="px-3 py-2 text-(--text-primary) font-mono text-[11px]">
                    {line.courier_tracking_number}
                  </td>
                  <td className="px-3 py-2 text-(--text-muted)">
                    {line.courier_order_ref || "—"}
                  </td>
                  <td className="px-3 py-2 text-(--text-secondary)">
                    {line.external_order_number || "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-(--text-secondary)">
                    {line.expected_amount != null ? fmt(Number(line.expected_amount)) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-(--text-primary)">
                    {fmt(Number(line.remitted_amount || 0))}
                  </td>
                  <td className="px-3 py-2 text-right text-(--text-muted)">
                    {line.courier_fee != null ? fmt(Number(line.courier_fee)) : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${diffColor}`}>
                    {line.expected_amount != null ? fmt(diff) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        MATCH_PILL[line.match_status] || ""
                      }`}
                    >
                      {line.match_status}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-[180px]">
                    {editingNoteFor === line.id ? (
                      <input
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        autoFocus
                        onBlur={() => {
                          if (cancelledRef.current) {
                            cancelledRef.current = false;
                            return;
                          }
                          commitNote(line);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitNote(line);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelledRef.current = true;
                            cancelNote();
                          }
                        }}
                        className="w-full rounded border border-(--accent) bg-(--bg-input) text-(--text-primary) px-2 py-1 text-xs"
                      />
                    ) : line.resolution_note ? (
                      <span
                        title={line.resolution_note}
                        className="text-(--text-secondary) truncate block"
                      >
                        {line.resolution_note}
                      </span>
                    ) : (
                      <span className="text-(--text-muted) italic">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!readOnly && (
                      <div className="flex gap-2 justify-end">
                        {line.match_status === "unmatched" && (
                          <button
                            onClick={() => onManualMatch(line)}
                            className="text-(--accent) hover:underline text-[11px]"
                          >
                            Match
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingNoteFor(line.id);
                            setNoteDraft(line.resolution_note || "");
                          }}
                          className="text-(--text-muted) hover:text-(--accent) text-[11px]"
                        >
                          Note
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
