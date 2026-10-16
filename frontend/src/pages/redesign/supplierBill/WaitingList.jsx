// One Toy Store F9 (f) 6/6: "Waiting for supplier's bill": extra pieces kept
// on a bill (already in stock) until the supplier sends the bill for them.
// The check screen matches them to that bill; here they can be marked
// "No bill coming (free)" with a note (stock stays, nothing on the account).
import { useState } from "react";
import { api } from "../../../api";
import { Button, Input, Modal, ModalFooter, SectionCard } from "../../../ui/primitives";

const q3 = (v) => String(Math.round(Number(v) * 1000) / 1000);

export default function WaitingList({ items, onChanged, disabled = false }) {
  const [freeing, setFreeing] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!items.length) return null;

  const ask = (w) => {
    setFreeing(w);
    setNote("");
    setError("");
  };
  const markFree = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/supplier-bills/waiting/${freeing.id}/free`, { note });
      setFreeing(null);
      onChanged();
    } catch (e) {
      setError(e.body?.error || e.message || "Could not mark the pieces free");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard className="mb-4 p-4">
      <h2 className="mb-1 text-sm font-semibold">Waiting for supplier&apos;s bill ({items.length})</h2>
      <p className="mb-2 text-xs text-(--ui-text-muted)">
        Extra pieces kept: already in stock, the supplier sends a bill for them. When that bill is checked here, they are matched to it.
      </p>
      <table className="w-full text-sm" data-testid="f9-waiting">
        <thead className="text-left text-xs uppercase text-(--ui-text-muted)">
          <tr>
            <th className="py-1 pr-3">Supplier</th><th className="py-1 pr-3">Toy</th><th className="py-1 pr-3 text-right">Pieces</th>
            <th className="py-1 pr-3">Came on bill</th><th className="py-1 pr-3 text-right">Waiting</th><th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.id} className="border-t border-(--ui-border)">
              <td className="py-1 pr-3">{w.supplier_name}</td>
              <td className="py-1 pr-3"><span className="font-mono text-xs">{w.sku}</span> {w.name}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{q3(w.qty)}</td>
              <td className="py-1 pr-3">{w.bill_number || "(no number)"}{w.bill_date ? ` · ${w.bill_date}` : ""}{w.outlet_name ? ` · ${w.outlet_name}` : ""}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{w.days === 1 ? "1 day" : `${w.days} days`}</td>
              <td className="py-1 text-right">
                <Button size="sm" onClick={() => ask(w)} disabled={disabled}>No bill coming (free)</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!freeing} onClose={() => setFreeing(null)} title="No bill coming for these pieces?">
        {freeing ? (
          <p className="text-sm">
            {q3(freeing.qty)} × {freeing.name} from {freeing.supplier_name} bill {freeing.bill_number || "(no number)"}: they stay in stock
            and nothing goes on the supplier&apos;s account.
          </p>
        ) : null}
        <label className="mt-3 block text-xs font-semibold uppercase text-(--ui-text-muted)">
          Note (why)
          <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Why no bill" />
        </label>
        {error ? <p className="mt-2 text-sm text-(--ui-danger-fg)">{error}</p> : null}
        <ModalFooter>
          <Button onClick={() => setFreeing(null)} disabled={busy}>Keep waiting</Button>
          <Button tone="primary" onClick={markFree} disabled={busy || !note.trim()}>Mark free</Button>
        </ModalFooter>
      </Modal>
    </SectionCard>
  );
}
