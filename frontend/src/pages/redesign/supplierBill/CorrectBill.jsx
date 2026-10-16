// One Toy Store F9 (f) 5/6: "Correct this bill" on a saved supplier bill
// (owner decision 2026-10-16: four kinds, a note always required):
//   pieces received changed · wrong rate · money only · wrong toy.
// The server (POST /api/supplier-bills/:id/corrections) moves stock, cost and
// the supplier's account; this box only collects the change and says what
// it will do.
import { useMemo, useState } from "react";
import { api } from "../../../api";
import ItemSearchBox from "../../../ui/ItemSearchBox";
import { Button, Input, Select } from "../../../ui/primitives";
import { CORRECTION_LABELS, correctionPreview } from "./correctionText";

const q3 = (v) => String(Math.round(Number(v) * 1000) / 1000);

export default function CorrectBill({ bill, fmt, onDone, onCancel }) {
  const lines = bill.lines.filter((l) => Number(l.billed_qty) >= 0);
  const [kind, setKind] = useState("pieces");
  const [lineId, setLineId] = useState(lines[0] ? String(lines[0].id) : "");
  const [form, setForm] = useState({ received_qty: "", toys: {}, rate: "", amount: "", from_product_id: "", to: null, qty: "" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const line = useMemo(() => lines.find((l) => String(l.id) === lineId) || null, [lines, lineId]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const preview = correctionPreview(kind, line, form, fmt);

  const body = () => {
    const b = { kind, note: note.trim() };
    if (kind === "money") return { ...b, amount: Number(form.amount) };
    b.line_id = line?.id;
    if (kind === "pieces") {
      b.received_qty = Number(form.received_qty);
      if (line && line.toys.length > 1) {
        b.toys = line.toys.map((t) => ({ product_id: t.product_id, qty: Number(form.toys[t.product_id] ?? t.qty) || 0 }));
      }
    } else if (kind === "rate") {
      b.rate = Number(form.rate);
    } else if (kind === "toy") {
      b.from_product_id = Number(form.from_product_id || line?.toys[0]?.product_id);
      b.to_product_id = form.to?.id;
      if (form.qty !== "") b.qty = Number(form.qty);
    }
    return b;
  };

  const save = async () => {
    setError("");
    if (!note.trim()) return setError("Write a note: why is the bill corrected?");
    setBusy(true);
    try {
      const d = await api.post(`/api/supplier-bills/${bill.id}/corrections`, body());
      onDone(d.bill);
    } catch (e) {
      setError(e.body?.error || e.message || "Could not save the correction");
    } finally {
      setBusy(false);
    }
  };

  const label = "block text-xs font-semibold uppercase text-(--ui-text-muted)";
  return (
    <div className="space-y-3 rounded-(--ui-radius-sm) border border-(--ui-border-strong) p-3" data-testid="correct-bill">
      <h3 className="font-semibold">Correct this bill</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          What is wrong
          <Select className="mt-1 w-full" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What is wrong">
            {Object.entries(CORRECTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </label>
        {kind !== "money" ? (
          <label className={label}>
            Line
            <Select className="mt-1 w-full" value={lineId} onChange={(e) => setLineId(e.target.value)} aria-label="Line">
              {lines.map((l) => <option key={l.id} value={l.id}>{l.line_no} · {l.description || l.supplier_code || "line"}</option>)}
            </Select>
          </label>
        ) : null}
      </div>

      {kind === "pieces" && line ? (
        <div className="space-y-2">
          <label className={label}>
            Received (billed {q3(line.billed_qty)}, the bill says {q3(line.received_qty)} received)
            <Input className="mt-1" type="number" min="0" step="any" value={form.received_qty} onChange={set("received_qty")} aria-label="Received" />
          </label>
          {line.toys.length > 1 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {line.toys.map((t) => (
                <label key={t.product_id} className={label}>
                  {t.name} pieces (now {q3(t.qty)})
                  <Input className="mt-1" type="number" min="0" step="any" aria-label={`${t.name} pieces`}
                    value={form.toys[t.product_id] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, toys: { ...f.toys, [t.product_id]: e.target.value } }))} />
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {kind === "rate" && line ? (
        <label className={label}>
          Right rate (the bill says {Number(line.rate).toLocaleString()})
          <Input className="mt-1" type="number" min="0" step="any" value={form.rate} onChange={set("rate")} aria-label="Right rate" />
        </label>
      ) : null}

      {kind === "money" ? (
        <label className={label}>
          Amount (plus = we owe more, minus = we owe less)
          <Input className="mt-1" type="number" step="any" value={form.amount} onChange={set("amount")} aria-label="Amount" />
        </label>
      ) : null}

      {kind === "toy" && line ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {line.toys.length > 1 ? (
            <label className={label}>
              Wrong toy
              <Select className="mt-1 w-full" value={form.from_product_id || String(line.toys[0].product_id)} onChange={set("from_product_id")} aria-label="Wrong toy">
                {line.toys.map((t) => <option key={t.product_id} value={t.product_id}>{t.name} · {q3(t.qty)} pcs</option>)}
              </Select>
            </label>
          ) : (
            <div className={label}>Wrong toy<span className="mt-1 block text-sm normal-case text-(--ui-text)">{line.toys[0]?.name} · {q3(line.toys[0]?.qty)} pcs</span></div>
          )}
          <label className={label}>
            Pieces to move (empty = all)
            <Input className="mt-1" type="number" min="0" step="any" value={form.qty} onChange={set("qty")} aria-label="Pieces to move" />
          </label>
          <div className={`${label} sm:col-span-2`}>
            Right toy
            {form.to ? (
              <span className="mt-1 flex items-center gap-2 text-sm normal-case text-(--ui-text)">
                <span className="font-mono text-xs">{form.to.sku}</span> {form.to.name}
                <Button size="sm" onClick={() => setForm((f) => ({ ...f, to: null }))}>Change</Button>
              </span>
            ) : (
              <ItemSearchBox className="mt-1" ariaLabel="Find the right toy" onPick={(p) => setForm((f) => ({ ...f, to: p }))} />
            )}
          </div>
        </div>
      ) : null}

      <label className={label}>
        Note (why)
        <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      </label>
      {preview ? <p className="text-sm" data-testid="correction-preview">{preview}</p> : null}
      {error ? <p className="text-sm text-(--ui-danger-fg)">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button tone="primary" onClick={save} disabled={busy}>Save correction</Button>
      </div>
    </div>
  );
}
