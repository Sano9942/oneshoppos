// Staff attendance register (One Toy Store F3b): a month grid like the shop's
// paper register. A box shows P / A / S; a kiosk clock-in shows as P on its
// own. Only the owner marks boxes, always with a reason, and every change is
// kept (history per person). PHASE-F-PLAN F3b Q3b.1–Q3b.6.
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../api";
import { Badge, Button, Input, Modal, SectionCard } from "../../../ui/primitives";
import { useToast } from "../../../contexts/ToastContext";
import {
  orderStaff,
  MARK_LABEL, dayOf, emptyDays, monthLabel, monthOf, nextMonth, pastDays, prevMonth, signed,
} from "./staffPay";

const REASONS = ["From paper register", "Forgot to clock in", "Sick", "Correction"];
const CELL_TONE = {
  P: "!text-(--ui-text)",
  A: "!bg-(--ui-danger-bg) !text-(--ui-danger-fg)",
  S: "!bg-(--ui-warning-bg) !text-(--ui-warning-fg)",
};

export default function StaffRegister() {
  const toast = useToast();
  const [month, setMonth] = useState(monthOf());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [brush, setBrush] = useState("P");
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api.get("/api/staff-pay/register", { month }));
    } catch (err) {
      setError(err.message);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const needReason = () => {
    if (!reason.trim()) {
      toast.error("Write a reason first");
      return true;
    }
    return false;
  };

  const markOne = async (s, d) => {
    if (busy || needReason()) return;
    const cur = s.marks[d]?.source === "mark" ? s.marks[d].mark : null;
    const mark = brush === "clear" ? null : brush;
    if (cur === mark) return;
    setBusy(true);
    try {
      await api.put("/api/staff-pay/register", { employee_id: s.id, day: dayOf(month, d), mark, reason });
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const fillEmpty = async (s) => {
    if (busy || needReason()) return;
    const upTo = pastDays(month, data.days);
    const days = emptyDays(s.marks, upTo);
    if (!days.length) return toast.success(`${s.name}: nothing empty`);
    setBusy(true);
    try {
      await api.put("/api/staff-pay/register/bulk", {
        reason,
        marks: days.map((d) => ({ employee_id: s.id, day: dayOf(month, d), mark: "P" })),
      });
      toast.success(`${s.name}: ${days.length} days marked P`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const showHistory = async (s) => {
    try {
      const r = await api.get("/api/staff-pay/register/history", { employee_id: s.id, month });
      setHistory({ name: s.name, rows: r.history });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const days = data ? Array.from({ length: data.days }, (_, i) => i + 1) : [];

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => setMonth(prevMonth(month))} aria-label="Previous month">‹</Button>
          <span className="min-w-36 text-center font-bold text-(--ui-text)">{monthLabel(month)}</span>
          <Button size="sm" onClick={() => setMonth(nextMonth(month))} aria-label="Next month">›</Button>
          <span className="ml-auto text-sm text-(--ui-text-muted)">Click a box to mark it:</span>
          {["P", "A", "S", "clear"].map((b) => (
            <Button key={b} size="sm" tone={brush === b ? "primary" : "default"} onClick={() => setBrush(b)}>
              {b === "clear" ? "Clear" : `${b} · ${MARK_LABEL[b]}`}
            </Button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-(--ui-text-muted)">Reason (kept with every change):</span>
          {REASONS.map((r) => (
            <Button key={r} size="sm" tone={reason === r ? "primary" : "default"} onClick={() => setReason(r)}>{r}</Button>
          ))}
          <Input className="w-56" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
        </div>
      </SectionCard>

      {error && <p className="text-sm text-(--ui-danger)">{error}</p>}

      {data && (
        <SectionCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-(--ui-text-muted)">
                <th className="sticky left-0 bg-(--ui-surface) px-3 py-2 text-left">Name</th>
                {days.map((d) => <th key={d} className="w-6 px-0 py-2 text-center text-[11px]">{d}</th>)}
                <th className="px-2 py-2 text-center text-xs">A</th>
                <th className="px-2 py-2 text-center text-xs">S</th>
                <th className="px-2 py-2 text-center text-xs">Allowed</th>
                <th className="px-2 py-2 text-center text-xs">±</th>
              </tr>
            </thead>
            <tbody>
              {orderStaff(data.staff).map((s) => (
                <tr key={s.id} className="border-b border-(--ui-border)">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-(--ui-surface) px-3 py-1">
                    <div className="font-semibold text-(--ui-text)">
                      {s.name}
                      {s.home_staff && <Badge tone="warning" className="ml-1" title="Works for the home: not counted as present in the shop">Home staff</Badge>}
                    </div>
                    <div className="text-xs">
                      <Button size="sm" tone="link" onClick={() => fillEmpty(s)} disabled={busy}>Empty → P</Button>
                      <span className="mx-1 text-(--ui-text-muted)">·</span>
                      <Button size="sm" tone="link" onClick={() => showHistory(s)}>History</Button>
                    </div>
                  </td>
                  {days.map((d) => {
                    const c = s.marks[d];
                    const title = c
                      ? `${dayOf(month, d)} · ${MARK_LABEL[c.mark]}${c.source === "clock" ? " (clock-in)" : ""}${c.reason ? ` · ${c.reason}` : ""}`
                      : dayOf(month, d);
                    return (
                      <td key={d} className="p-0 text-center">
                        <Button
                          size="sm"
                          iconOnly
                          tone="plain"
                          title={title}
                          aria-label={`${s.name} ${title}`}
                          disabled={busy}
                          onClick={() => markOne(s, d)}
                          className={`!h-6 !w-6 !rounded-sm border border-(--ui-border) text-[11px] ${c ? CELL_TONE[c.mark] : ""} ${c?.source === "clock" ? "underline" : ""}`}
                        >
                          {c?.mark || ""}
                        </Button>
                      </td>
                    );
                  })}
                  <td className="px-2 text-center">{s.a_days}</td>
                  <td className="px-2 text-center">{s.s_days}</td>
                  <td className="px-2 text-center">{s.allowance}</td>
                  <td className="px-2 text-center">
                    <Badge tone={s.diff < 0 ? "danger" : s.diff > 0 ? "success" : "default"}>{s.diff === 0 ? "ok" : signed(s.diff)}</Badge>
                  </td>
                </tr>
              ))}
              <tr className="text-(--ui-text-muted)">
                <td className="sticky left-0 bg-(--ui-surface) px-3 py-2 text-xs">Present</td>
                {days.map((d) => <td key={d} className="text-center text-xs">{data.present_by_day[d] || ""}</td>)}
                <td colSpan={4} />
              </tr>
            </tbody>
          </table>
          {!data.staff.length && <p className="p-4 text-sm text-(--ui-text-muted)">No staff with a monthly salary.</p>}
        </SectionCard>
      )}
      <p className="text-xs text-(--ui-text-muted)">
        ± = allowed leave − A days (paid extra or cut at salary ÷ 30). S (sick) is not taken from the allowance.
        Underlined P = a clock-in at the kiosk.
      </p>

      <Modal open={!!history} onClose={() => setHistory(null)} title={`Changes · ${history?.name || ""} · ${monthLabel(month)}`} size="lg">
        {history?.rows?.length ? (
          <ul className="divide-y divide-(--ui-border) text-sm">
            {history.rows.map((h) => (
              <li key={h.id} className="py-2">
                <span className="font-semibold">{h.day}</span>: {h.old_mark || "empty"} → {h.new_mark || "empty"} · {h.reason}
                <span className="text-(--ui-text-muted)"> · {h.set_by_name || "?"}, {new Date(h.set_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-(--ui-text-muted)">No changes this month.</p>
        )}
      </Modal>
    </div>
  );
}
