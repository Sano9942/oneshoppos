// Salaries + staff accounts (One Toy Store F3b). Pay = salary + (allowed − A
// days) × salary ÷ 30, rounded to 10; the owner cuts some or all of what the
// person owes (advances, toys) and the rest is paid in cash from the open till
// shift. PHASE-F-PLAN F3b Q3b.1–Q3b.15.
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Badge, Button, Drawer, Input, Modal, PageShell, SectionCard, Select } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";
import { monthLabel, monthOf, nextMonth, orderStaff, pastDays, prevMonth, rs, signed, splitTotals } from "./staff/staffPay";

const KIND_LABEL = {
  earlier_advance: "Advance (paper register)",
  earlier_purchase: "Toy taken (paper register)",
  adjust: "Correction",
  staff_advance: "Advance from the till",
  staff_repay: "Paid back into the till",
  salary_cut: "Cut from salary",
  staff_purchase: "Toy at cost, cut from salary",
  staff_return: "Toy returned",
};

export default function SalariesRedesign() {
  const toast = useToast();
  const [month, setMonth] = useState(() => prevMonth(monthOf()));
  const [data, setData] = useState(null);
  const [shift, setShift] = useState(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(null);
  const [accountOf, setAccountOf] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(async () => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get("/api/staff-pay/salaries", { month }),
      api.get("/api/shifts").catch(() => ({ shifts: [] })),
    ])
      .then(([s, sh]) => {
        if (!alive) return;
        setError("");
        setData(s);
        setShift((sh.shifts || []).find((x) => x.status === "open") || null);
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [month, reloadKey]);

  const saveAllowance = async (s, value) => {
    if (String(value) === String(s.allowance)) return;
    try {
      await api.put(`/api/staff-pay/staff/${s.id}`, { monthly_leave_allowance: Number(value) });
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const undo = async (s) => {
    if (!window.confirm(`Undo ${s.name}'s ${monthLabel(month)} salary? The cash goes back into the till's expected amount.`)) return;
    try {
      await api.del(`/api/staff-pay/salaries/${s.paid.id}`);
      toast.success("Salary undone");
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const past = data ? pastDays(month, data.days) : 0;
  const totals = splitTotals(data?.staff);
  const hasHome = (data?.staff || []).some((s) => s.home_staff);

  return (
    <PageShell
      title="Salaries"
      subtitle="Month pay from the attendance register, staff accounts (advances, toys) and paying from the till"
      right={
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setMonth(prevMonth(month))} aria-label="Previous month">‹</Button>
          <span className="min-w-36 text-center font-bold text-(--ui-text)">{monthLabel(month)}</span>
          <Button size="sm" onClick={() => setMonth(nextMonth(month))} aria-label="Next month">›</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-sm text-(--ui-danger)">{error}</p>}
      <p className="mb-3 text-sm text-(--ui-text-muted)">
        {shift
          ? `Salaries are paid from the open till shift #${shift.id}.`
          : "No till shift is open: open the shift on the POS to pay salaries."}
        {" "}Mark attendance on People → Attendance → Register.
        {data?.staff_discounts?.bills > 0 && (
          <> Staff toys at cost in {monthLabel(month)}: {data.staff_discounts.bills} bills, staff discount {rs(data.staff_discounts.value)}.</>
        )}
      </p>
      {data && (
        <SectionCard className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 text-right">Salary</th>
                <th className="px-3 py-2 text-center">Allowed</th>
                <th className="px-3 py-2 text-center">A</th>
                <th className="px-3 py-2 text-center">S</th>
                <th className="px-3 py-2 text-center">±</th>
                <th className="px-3 py-2 text-right">Leave pay / cut</th>
                <th className="px-3 py-2 text-right">Salary to pay</th>
                <th className="px-3 py-2 text-right">Owes shop</th>
                <th className="px-3 py-2">Paid</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {orderStaff(data.staff).map((s) => (
                <tr key={s.id} className="border-b border-(--ui-border)">
                  <td className="px-3 py-2 font-semibold text-(--ui-text)">
                    {s.name}
                    {s.home_staff && <Badge tone="warning" className="ml-1" title="Salary booked as Owner / home, not a shop cost">Home staff</Badge>}
                    {s.marked_days < past && (
                      <div className="text-xs font-normal text-(--ui-warning-fg)">{past - s.marked_days} days not marked</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{rs(s.monthly_salary)}</td>
                  <td className="px-3 py-2 text-center">
                    <Input
                      key={`${s.id}-${s.allowance}`}
                      type="number"
                      min="0"
                      max="31"
                      defaultValue={s.allowance}
                      disabled={!!s.paid}
                      onBlur={(e) => saveAllowance(s, e.target.value)}
                      className="!w-16 text-center"
                      aria-label={`${s.name} leave allowed`}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">{s.a_days}</td>
                  <td className="px-3 py-2 text-center">{s.s_days}</td>
                  <td className="px-3 py-2 text-center">{s.diff === 0 ? "ok" : signed(s.diff)}</td>
                  <td className="px-3 py-2 text-right">{rs(s.leave_adjust)}</td>
                  <td className="px-3 py-2 text-right font-bold">{rs(s.paid ? s.paid.gross : s.gross)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" tone="link" onClick={() => setAccountOf(s)}>{rs(s.balance)}</Button>
                  </td>
                  <td className="px-3 py-2">
                    {s.paid ? (
                      <Badge tone="success">
                        {rs(s.paid.net_pay)} paid{s.paid.cut_amount ? ` (cut ${rs(s.paid.cut_amount)})` : ""}
                      </Badge>
                    ) : (
                      <span className="text-(--ui-text-muted)">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {s.paid ? (
                      s.paid.shift_status === "open" && <Button size="sm" onClick={() => undo(s)}>Undo</Button>
                    ) : (
                      <Button size="sm" tone="primary" disabled={!shift} onClick={() => setPaying(s)}>Pay</Button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="px-3 py-2" colSpan={7}>{hasHome ? "Total shop staff" : "Total"}</td>
                <td className="px-3 py-2 text-right">{rs(totals.shop.gross)}</td>
                <td />
                <td className="px-3 py-2">{rs(totals.shop.paid)} paid</td>
                <td />
              </tr>
              {hasHome && (
                <tr className="font-bold text-(--ui-text-muted)">
                  <td className="px-3 py-2" colSpan={7}>Home staff total (Owner / home, not a shop cost)</td>
                  <td className="px-3 py-2 text-right">{rs(totals.home.gross)}</td>
                  <td />
                  <td className="px-3 py-2">{rs(totals.home.paid)} paid</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </SectionCard>
      )}

      {paying && <PayModal
        key={paying.id}
        staff={paying}
        month={month}
        shift={shift}
        onClose={() => setPaying(null)}
        onPaid={async () => {
          setPaying(null);
          await load();
        }}
      />}
      <AccountDrawer staff={accountOf} onClose={() => { setAccountOf(null); load(); }} />
    </PageShell>
  );
}

function PayModal({ staff, month, shift, onClose, onPaid }) {
  const toast = useToast();
  // Opened fresh per person (key = staff id): suggest cutting all that is owed.
  const [cut, setCut] = useState(() => String(Math.max(0, Math.min(staff.balance, staff.gross))));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const cutNum = Number(cut || 0);
  const net = Math.round((staff.gross - cutNum) * 100) / 100;

  const pay = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/staff-pay/salaries", { employee_id: staff.id, month, shift_id: shift?.id, cut_amount: cutNum, note });
      toast.success(`${staff.name}: ${rs(net)} paid from the till`);
      await onPaid();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!staff} onClose={onClose} title={`Pay ${staff.name} · ${monthLabel(month)}`} size="md">
      <form className="space-y-3 text-sm" onSubmit={pay}>
        <div className="grid grid-cols-2 gap-y-1">
          <span>Salary</span><span className="text-right">{rs(staff.monthly_salary)}</span>
          <span>Leave ({staff.diff === 0 ? "ok" : `${signed(staff.diff)} days × ${rs(staff.per_day)}`})</span>
          <span className="text-right">{rs(staff.leave_adjust)}</span>
          <span className="font-bold">Salary to pay (rounded to 10)</span><span className="text-right font-bold">{rs(staff.gross)}</span>
          <span>Owes the shop now</span><span className="text-right">{rs(staff.balance)}</span>
        </div>
        {staff.home_staff && (
          <p className="rounded-(--ui-radius-md) bg-(--ui-warning-bg) px-3 py-2 text-(--ui-warning-fg)">
            Home staff: the cash is booked as Paid out → Owner / home, not as a shop cost.
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-(--ui-text-muted)">Cut from this salary (the rest stays on the account for next month)</span>
          <Input type="number" min="0" step="1" value={cut} onChange={(e) => setCut(e.target.value)} aria-label="Amount to cut" />
        </label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
        <div className="flex items-center justify-between rounded-(--ui-radius-md) bg-(--ui-muted-surface) px-3 py-2">
          <span className="font-bold">Cash from the till</span>
          <span className="text-lg font-black">{rs(net)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button tone="primary" type="submit" disabled={busy || net < 0}>{busy ? "Paying…" : `Pay ${rs(net)}`}</Button>
        </div>
      </form>
    </Modal>
  );
}

function AccountDrawer({ staff, onClose }) {
  const toast = useToast();
  const [acc, setAcc] = useState(null);
  const [form, setForm] = useState({ kind: "earlier_advance", amount: "", entry_date: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    if (!staff) return;
    setLoadError("");
    try {
      setAcc(await api.get(`/api/staff-pay/accounts/${staff.id}`));
    } catch (err) {
      setLoadError(err.message);
    }
  }, [staff]);

  useEffect(() => {
    setAcc(null);
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/api/staff-pay/accounts/${staff.id}/entries`, { ...form, amount: Number(form.amount) });
      setForm({ ...form, amount: "", note: "" });
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry) => {
    if (!window.confirm("Remove this entry?")) return;
    try {
      await api.del(`/api/staff-pay/accounts/entries/${entry.id}`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Drawer open={!!staff} onClose={onClose} title={`Account · ${staff?.name || ""}`} size="lg">
      {loadError && <p className="text-sm text-(--ui-danger)">{loadError}</p>}
      {acc && (
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between rounded-(--ui-radius-md) bg-(--ui-muted-surface) px-3 py-2">
            <span className="font-bold">Owes the shop</span>
            <span className="text-lg font-black">{rs(acc.balance)}</span>
          </div>
          {acc.entries.length ? (
            <table className="w-full">
              <thead>
                <tr className="text-left text-(--ui-text-muted)">
                  <th className="py-1">Date</th><th>What</th><th className="text-right">Amount</th><th className="text-right">Balance</th><th />
                </tr>
              </thead>
              <tbody>
                {acc.entries.map((e) => (
                  <tr key={`${e.source}-${e.id}`} className="border-t border-(--ui-border)">
                    <td className="py-1">{e.day}</td>
                    <td>
                      {KIND_LABEL[e.kind] || e.kind}
                      {e.shift_id ? ` · shift #${e.shift_id}` : ""}
                      {e.note ? <div className="text-xs text-(--ui-text-muted)">{e.note}</div> : null}
                    </td>
                    <td className="text-right">{rs(e.amount)}</td>
                    <td className="text-right">{rs(e.balance)}</td>
                    <td className="text-right">
                      {e.source === "entry" && <Button size="sm" tone="link" onClick={() => remove(e)}>Remove</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-(--ui-text-muted)">Nothing on the account.</p>
          )}
          {acc.purchases?.length > 0 && (
            <div>
              <p className="mb-1 font-bold">Toys at cost (every staff purchase)</p>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-(--ui-text-muted)">
                    <th className="py-1">Date</th><th>Bill</th><th>Item</th><th className="text-right">Qty</th>
                    <th className="text-right">Price</th><th className="text-right">Staff disc.</th><th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {acc.purchases.map((p, i) => (
                    <tr key={`${p.sale_id}-${i}`} className="border-t border-(--ui-border)">
                      <td className="py-1">{p.day}</td>
                      <td>{p.invoice_number || `#${p.sale_id}`}</td>
                      <td>{p.name}</td>
                      <td className="text-right">{p.quantity}</td>
                      <td className="text-right">{rs(p.price)}</td>
                      <td className="text-right">{rs(p.staff_discount)}</td>
                      <td>{p.paid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form className="space-y-2 border-t border-(--ui-border) pt-3" onSubmit={add}>
            <p className="font-bold">Add from the paper register</p>
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="What">
              {(acc.entry_kinds || []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </Select>
            <div className="flex gap-2">
              <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} aria-label="Date" />
              <Input type="number" step="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount" aria-label="Amount" />
            </div>
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder={form.kind === "adjust" ? "Why? (required; minus = owes less)" : "Note (optional)"} aria-label="Note" />
            <Button tone="primary" type="submit" disabled={busy}>Add</Button>
          </form>
        </div>
      )}
    </Drawer>
  );
}
