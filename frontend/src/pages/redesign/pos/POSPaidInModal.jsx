import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../../api";
import { Button, Input, Modal, Select } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";

/**
 * F3c: cash put INTO the till that is not a sale (from the bank, the owner,
 * or a staff member paying back). It is added to the drawer at Close Shift;
 * it is never a sale or profit (backend/services/till-payins.js).
 */
const HINTS = {
  bank: "Cash taken out of a shop account and put in the drawer",
  owner: "Cash the owner brought from home",
  staff_repay: "A staff member pays back an advance or a toy",
};

export default function POSPaidInModal({ open, onClose, shift, onSaved }) {
  const { fmt: money } = useCurrency();
  const [options, setOptions] = useState(null);
  const [list, setList] = useState({ payins: [], total: 0 });
  const [kind, setKind] = useState("");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [staffId, setStaffId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    if (!shift?.id) return;
    try {
      setList(await api.get(`/api/till-payins?shift_id=${shift.id}`));
    } catch {
      /* the list is a convenience; saving still works */
    }
  }, [shift?.id]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setNotice("");
    api.get("/api/till-payins/options").then(setOptions).catch((err) => setError(err.message || "Could not load the lists"));
    loadList();
  }, [open, loadList]);

  const resetForm = () => {
    setKind("");
    setAmount("");
    setAccount("");
    setStaffId("");
    setNote("");
  };

  const close = () => {
    resetForm();
    setError("");
    setNotice("");
    onClose();
  };

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!kind) return setError("Tap where the money came from first");
    if (kind === "bank" && !account) return setError("Pick the bank account");
    if (kind === "staff_repay" && !staffId) return setError("Pick the staff member");
    if (!(Number(amount) > 0)) return setError("Enter the amount");
    setBusy(true);
    try {
      await api.post("/api/till-payins", {
        shift_id: shift.id,
        kind,
        amount: Number(amount),
        note: note || null,
        account: kind === "bank" ? account : undefined,
        staff_employee_id: kind === "staff_repay" ? Number(staffId) : undefined,
      });
      setNotice(`Put in ${money(Number(amount))}. It is added to the drawer at Close Shift.`);
      resetForm();
      await loadList();
      onSaved?.();
    } catch (err) {
      setError(err.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Remove this paid-in of ${money(p.amount)}? Only do this if it was typed by mistake.`)) return;
    setError("");
    try {
      await api.del(`/api/till-payins/${p.id}`);
      await loadList();
      onSaved?.();
    } catch (err) {
      setError(err.message || "Could not remove");
    }
  };

  const describe = (p) => {
    const label = options?.kinds?.find((k) => k.key === p.kind)?.label || p.kind;
    if (p.account) return `${label} · ${p.account}`;
    if (p.staff_name) return `${label} · ${p.staff_name}`;
    return label;
  };

  return (
    <Modal open={open} onClose={close} title={`Paid in (shift #${shift?.id ?? ""})`} size="xl">
      <form className="space-y-4" onSubmit={save}>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-(--ui-text-muted)">Where did the money come from?</p>
          <div className="flex flex-wrap gap-2">
            {(options?.kinds || []).map((k) => (
              <Button key={k.key} type="button" tone={kind === k.key ? "primary" : "default"} onClick={() => setKind(k.key)}>
                {k.label}
              </Button>
            ))}
          </div>
          {kind && <p className="mt-2 text-xs text-(--ui-text-muted)">{HINTS[kind]}</p>}
        </div>

        {kind === "bank" && (
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-white p-3">
            <div className="flex flex-wrap gap-2">
              {(options?.accounts || []).map((a) => (
                <Button key={a} type="button" size="sm" tone={account === a ? "primary" : "default"} onClick={() => setAccount(a)}>
                  {a}
                </Button>
              ))}
            </div>
          </div>
        )}

        {kind === "staff_repay" && (
          <Select className="w-full" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Staff member">
            <option value="">Pick the staff member…</option>
            {(options?.staff || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input type="number" min="0" step="any" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="Amount" aria-label="Amount" />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
        </div>

        {error && <p className="text-sm font-semibold text-(--ui-danger)">{error}</p>}
        {notice && <p className="text-sm font-semibold text-(--ui-success-fg)">{notice}</p>}

        <div className="flex gap-2">
          <Button type="button" onClick={close}>Close</Button>
          <Button tone="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Put in"}</Button>
        </div>
      </form>

      <div className="mt-6 border-t border-(--ui-border) pt-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-(--ui-text)">Paid in this shift</span>
          <span className="font-black text-(--ui-text)">{money(Number(list.total || 0))}</span>
        </div>
        {list.payins?.length ? (
          <ul className="divide-y divide-(--ui-border) text-sm">
            {list.payins.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-(--ui-text)">
                  {describe(p)}{p.note ? ` · ${p.note}` : ""}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-(--ui-text)">{money(p.amount)}</span>
                  <Button type="button" size="sm" onClick={() => remove(p)}>
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-(--ui-text-muted)">Nothing paid in yet.</p>
        )}
      </div>
    </Modal>
  );
}
