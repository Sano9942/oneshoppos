// Import → "Update prices" (One Toy Store pilot, Phase B step 6c): a price
// sheet updates the selling price and cost of EXISTING items, matched by SKU,
// else barcode (products and variants). Preview shows old → new; the owner
// unticks any row to leave out, then confirms. Never creates items. Changed
// selling prices land on "Labels to reprint" (the database does that).
import { useCallback, useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { Badge, Button, SectionCard } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { api } from "../../api";

function Money({ from, to, fmt }) {
  if (from === to) return <span>{fmt(to)}</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="text-(--ui-text-muted) line-through">{fmt(from)}</span> → <strong>{fmt(to)}</strong>
    </span>
  );
}

export default function PriceSheetImport() {
  const { success, error: showError } = useToast();
  const { fmt } = useCurrency();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [ticked, setTicked] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [dl, setDl] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setTicked(new Set());
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadTemplate = useCallback(async () => {
    setDl(true);
    try {
      const res = await api.raw("/api/import/template/prices");
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "prices_template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showError(err.message || "Could not download the template");
    } finally {
      setDl(false);
    }
  }, [showError]);

  const onFile = async (e) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreview(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", selected);
      const res = await api.upload("/api/import/prices?preview=1", fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview(data);
      setTicked(new Set(data.rows.filter((r) => r.status === "change").map((r) => r._row)));
    } catch (err) {
      showError(err.message);
      reset();
    } finally {
      setLoading(false);
    }
  };

  const toggle = (row) => setTicked((prev) => {
    const next = new Set(prev);
    if (next.has(row)) next.delete(row); else next.add(row);
    return next;
  });

  const apply = async () => {
    if (!file || !ticked.size) return;
    setApplying(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("rows", JSON.stringify([...ticked].sort((a, b) => a - b)));
      const res = await api.upload("/api/import/prices", fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      success(`Updated ${data.updated} price${data.updated === 1 ? "" : "s"}. Changed selling prices are on Labels to reprint.`);
      reset();
    } catch (err) {
      showError(err.message);
    } finally {
      setApplying(false);
    }
  };

  const s = preview?.summary;
  const n = ticked.size;

  return (
    <SectionCard className="p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <p className="text-sm text-(--ui-text-muted)">
          Update the selling price and cost of items you already have. Each row is matched by SKU, or by barcode when
          there is no SKU. A blank cell keeps the current value. Rows that match nothing are skipped: this never adds
          new items. For a product with variants, put each variant's own SKU or barcode.
        </p>
        <Button onClick={downloadTemplate} disabled={dl}>
          {dl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download Template
        </Button>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-(--ui-radius-md) border border-dashed border-(--ui-border-strong) p-6 text-sm text-(--ui-text-muted) hover:bg-(--ui-muted-surface)">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        <span>{file ? file.name : "Choose a price sheet (.csv)"}</span>
        <input ref={fileRef} data-testid="price-sheet-file" type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </label>

      {preview && (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="success">{s.change} to update</Badge>
            <Badge>{s.unchanged} no change</Badge>
            <Badge tone="warning">{s.not_found} not found</Badge>
            <Badge tone="danger">{s.error} with problems</Badge>
          </div>
          <div className="overflow-x-auto rounded-(--ui-radius-md) border border-(--ui-border)">
            <table data-testid="price-sheet-preview" className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-xs font-semibold uppercase text-(--ui-text-muted)">
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Selling price</th>
                  <th className="px-3 py-2">Cost</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const matched = r.product_id != null && r.status !== "not_found";
                  return (
                    <tr key={r._row} data-testid={`price-row-${r._row}`}
                      className={`border-b border-(--ui-border) last:border-0 ${r.status === "unchanged" ? "text-(--ui-text-muted)" : ""}`}>
                      <td className="px-3 py-2">
                        {r.status === "change" && (
                          <input type="checkbox" aria-label={`Update row ${r._row}`} checked={ticked.has(r._row)}
                            onChange={() => toggle(r._row)} className="h-4 w-4 accent-(--ui-primary)" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">{r._row}</td>
                      <td className="px-3 py-2">
                        {matched ? (
                          <>
                            <div className="font-medium text-(--ui-text)">{r.item_name}</div>
                            {r.variant_label && <div className="text-xs text-(--ui-text-muted)">{r.variant_label}</div>}
                          </>
                        ) : (
                          <span className="text-(--ui-text-muted)">{[r.sku, r.barcode].filter(Boolean).join(" / ") || "—"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{r.new_price != null && <Money from={r.old_price} to={r.new_price} fmt={fmt} />}</td>
                      <td className="px-3 py-2">{r.new_cost != null && <Money from={r.old_cost} to={r.new_cost} fmt={fmt} />}</td>
                      <td className="px-3 py-2">
                        {r.status === "change" && (r.below_cost ? <Badge tone="warning">Update · below cost</Badge> : <Badge tone="success">Update</Badge>)}
                        {r.status === "unchanged" && <Badge>No change</Badge>}
                        {r.status === "not_found" && <Badge tone="warning">Not found · skipped</Badge>}
                        {r.status === "error" && <span className="text-xs text-(--ui-danger-fg)">{r._errors.join("; ")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={reset} disabled={applying}>Cancel</Button>
            <Button tone="primary" onClick={apply} disabled={applying || n === 0}>
              {applying ? "Updating…" : `Update ${n} price${n === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
