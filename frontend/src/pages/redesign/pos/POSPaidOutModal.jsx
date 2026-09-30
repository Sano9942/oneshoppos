import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../../api";
import { Button, Input, Modal, Select } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";

/**
 * F3 (D50): cash paid out of the till. Every kind comes off the drawer at
 * Close Shift; only shop costs and discounts after sale count in profit
 * (backend/services/till-payouts.js).
 */
const HINTS = {
  shop_cost: "Staff food, water, repairs… counts as a shop cost",
  supplier: "Comes off what the shop owes this supplier",
  owner: "Home, school fees, card bill… not a shop cost",
  staff_advance: "Saved against the staff member",
  late_discount: "Discount handed back after the bill was charged in full",
};


export default function POSPaidOutModal({ open, onClose, shift, onSaved }) {
  const { fmt: money } = useCurrency();
  const [options, setOptions] = useState(null);
  const [list, setList] = useState({ payouts: [], total: 0 });
  const [kind, setKind] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    if (!shift?.id) return;
    try {
      setList(await api.get(`/api/till-payouts?shift_id=${shift.id}`));
    } catch {
      /* the list is a convenience; saving still works */
    }
  }, [shift?.id]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setNotice("");
    api.get("/api/till-payouts/options").then(setOptions).catch((err) => setError(err.message || "Could not load the lists"));
    loadList();
  }, [open, loadList]);

  const resetForm = () => {
    setKind("");
    setAmount("");
    setCategoryId("");
    setSupplierId("");
    setStaffId("");
    setInvoice("");
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
    if (!kind) return setError("Tap what the money was for first");
    if (!(Number(amount) > 0)) return setError("Enter the amount");
    setBusy(true);
    try {
      await api.post("/api/till-payouts", {
        shift_id: shift.id,
        kind,
        amount: Number(amount),
        note: note || null,
        category_id: kind === "shop_cost" ? Number(categoryId) || null : undefined,
        supplier_id: kind === "supplier" ? Number(supplierId) || null : undefined,
        staff_employee_id: kind === "staff_advance" ? Number(staffId) || null : undefined,
        invoice_number: kind === "late_discount" ? invoice.trim() : undefined,
      });
      setNotice(`Paid out ${money(Number(amount))}. It comes off the drawer at Close Shift.`);
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
    if (!window.confirm(`Remove this paid-out of ${money(p.amount)}? Only do this if it was typed by mistake.`)) return;
    setError("");
    try {
      await api.del(`/api/till-payouts/${p.id}`);
      await loadList();
      onSaved?.();
    } catch (err) {
      setError(err.message || "Could not remove");
    }
  };

  const describe = (p) =>
    (p.invoice_number ? `Discount after sale · bill ${p.invoice_number}` : null) ||
    p.category_name || p.supplier_name ||
    (p.staff_name ? `Advance · ${p.staff_name}` : null) ||
    options?.kinds?.find((k) => k.key === p.kind)?.label || p.kind;

  return (
    <Modal open={open} onClose={close} title={`Paid out (shift #${shift?.id ?? ""})`} size="xl">
      <form className="space-y-4" onSubmit={save}>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-(--ui-text-muted)">What was it for?</p>
          <div className="flex flex-wrap gap-2">
            {(options?.kinds || []).map((k) => (
              <Button key={k.key} type="button" tone={kind === k.key ? "primary" : "default"} onClick={() => setKind(k.key)}>
                {k.label}
              </Button>
            ))}
          </div>
          {kind && <p className="mt-2 text-xs text-(--ui-text-muted)">{HINTS[kind]}</p>}
        </div>

        {kind === "shop_cost" && (
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-white p-3">
            {options?.categories?.length ? (
              <div className="flex flex-wrap gap-2">
                {options.categories.map((c) => (
                  <Button key={c.id} type="button" size="sm" tone={String(categoryId) === String(c.id) ? "primary" : "default"}
                    onClick={() => setCategoryId(c.id)}>
                    {c.name}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-(--ui-text-muted)">No expense categories yet: add them on the Expenses page.</p>
            )}
          </div>
        )}

        {kind === "supplier" && (
          <Select className="w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">
            <option value="">Pick the supplier…</option>
            {(options?.suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        )}

        {kind === "staff_advance" && (
          <Select className="w-full" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Staff member">
            <option value="">Pick the staff member…</option>
            {(options?.staff || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        )}

        {kind === "late_discount" && (
          <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Bill number, e.g. INV-2026-00046" aria-label="Bill number" />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input type="number" min="0" step="any" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="Amount" aria-label="Amount" />
          <Input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={kind === "owner" ? "What for? (required)" : "Note (optional)"} aria-label="Note" />
        </div>

        {error && <p className="text-sm font-semibold text-(--ui-danger)">{error}</p>}
        {notice && <p className="text-sm font-semibold text-(--ui-success-fg)">{notice}</p>}

        <div className="flex gap-2">
          <Button type="button" onClick={close}>Close</Button>
          <Button tone="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Pay out"}</Button>
        </div>
      </form>

      <div className="mt-6 border-t border-(--ui-border) pt-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-(--ui-text)">Paid out this shift</span>
          <span className="font-black text-(--ui-text)">{money(Number(list.total || 0))}</span>
        </div>
        {list.payouts?.length ? (
          <ul className="divide-y divide-(--ui-border) text-sm">
            {list.payouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className={p.voided ? "text-(--ui-text-muted) line-through" : "text-(--ui-text)"}>
                  {describe(p)}{p.note ? ` · ${p.note}` : ""}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-(--ui-text)">{money(p.amount)}</span>
                  {!p.voided && (
                    <Button type="button" size="sm" onClick={() => remove(p)}>
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-(--ui-text-muted)">Nothing paid out yet.</p>
        )}
      </div>
    </Modal>
  );
}
