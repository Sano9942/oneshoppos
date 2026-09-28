import { useEffect, useState } from "react";
import { api } from "../../api";
import { Button, Input, Modal, ModalFooter } from "../../ui/primitives";
import { todayLocalStr } from "../../utils/dates";

const METHODS = ["Cash", "Bank Transfer", "Cheque"];

// Pay a supplier ON ACCOUNT (One Toy Store pilot, D13): a lump sum that lowers
// what we owe without naming a bill (POST /api/suppliers/:id/payments). Paying
// a single bill stays on the Supplier Payables page.
export default function PaySupplierModal({ supplier, balance, fmt, onClose, onPaid }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(todayLocalStr());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supplier) return;
    setAmount("");
    setMethod("Cash");
    setReference("");
    setDate(todayLocalStr());
    setNotes("");
    setError("");
  }, [supplier]);

  const submit = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) {
      setError("Enter an amount above zero.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.post(`/api/suppliers/${supplier.id}/payments`, {
        amount: amt,
        payment_method: method,
        reference,
        notes,
        paid_at: date,
      });
      onPaid?.(res);
      onClose();
    } catch (e) {
      setError(e.body?.error || e.message || "Payment failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!supplier} onClose={saving ? undefined : onClose} title={supplier ? `Pay ${supplier.name}` : ""} size="md">
      {supplier ? (
        <>
          {balance != null ? (
            <p className="mb-3 text-sm text-(--ui-text-muted)">
              {Number(balance) >= 0 ? "Owed now: " : "Paid ahead: "}
              <span className="font-semibold text-(--ui-text)">{fmt(Math.abs(Number(balance)))}</span>
              <span className="block text-xs">A payment on account lowers the balance; it doesn't mark any bill as paid.</span>
            </p>
          ) : null}
          {error ? <p className="mb-2 text-sm text-(--ui-danger-fg)">{error}</p> : null}
          <div className="space-y-2">
            <div>
              <label htmlFor="pay-amount" className="mb-1 block text-xs text-(--ui-text-muted)">Amount</label>
              <Input id="pay-amount" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <p className="mb-1 text-xs text-(--ui-text-muted)">Paid by</p>
              <div className="flex gap-2">
                {METHODS.map((m) => (
                  <Button key={m} size="sm" tone={method === m ? "primary" : "default"} onClick={() => setMethod(m)}>
                    {m}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="pay-ref" className="mb-1 block text-xs text-(--ui-text-muted)">Reference</label>
                <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer / cheque no" />
              </div>
              <div>
                <label htmlFor="pay-date" className="mb-1 block text-xs text-(--ui-text-muted)">Date</label>
                <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="pay-notes" className="mb-1 block text-xs text-(--ui-text-muted)">Notes</label>
              <Input id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <ModalFooter>
            <Button onClick={onClose} disabled={saving}>Cancel</Button>
            <Button tone="primary" onClick={submit} disabled={saving || !amount}>
              {saving ? "Saving..." : "Record payment"}
            </Button>
          </ModalFooter>
        </>
      ) : null}
    </Modal>
  );
}
