// One Toy Store F9: receive a supplier bill without a purchase order.
// Step (b): pick the supplier, upload the bill's PDF(s) / photo(s), see every
// line read from it with its check (qty × rate = amount) and the total check.
// Nothing is saved yet: the check screen (match toys, prices, save) is step (c).
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { Badge, Button, Input, PageShell, SectionCard, Select } from "../../ui/primitives";

const CHECK = {
  ok: { tone: "success", label: "✓" },
  mismatch: { tone: "danger", label: "qty × rate ≠ amount" },
  missing: { tone: "warning", label: "number missing" },
};

export default function ReceiveSupplierBillRedesign() {
  const { fmt } = useCurrency();
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [files, setFiles] = useState([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get("/api/suppliers")
      .then((d) => setSuppliers((d.suppliers || d || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))))
      .catch(() => {});
  }, []);

  const read = async () => {
    if (!files.length) return;
    setReading(true);
    setError("");
    setResult(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      if (supplierId) fd.append("supplier_id", supplierId);
      const res = await api.upload("/api/supplier-bills/read", fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read the bill");
      setResult(data);
    } catch (e) {
      setError(e.body?.error || e.message || "Could not read the bill");
    } finally {
      setReading(false);
    }
  };

  const supplierName = (id) => suppliers.find((s) => String(s.id) === String(id))?.name;
  const counts = useMemo(() => {
    const lines = result?.lines || [];
    return {
      ok: lines.filter((l) => l.check === "ok").length,
      bad: lines.filter((l) => l.check !== "ok").length,
      pieces: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
    };
  }, [result]);
  const printedForLines = result ? (result.printed?.subtotal ?? result.printed?.total) : null;

  return (
    <PageShell
      title="Receive supplier bill"
      subtitle="Upload the supplier's bill (PDF or photo). Reading only for now: nothing is saved."
    >
      <SectionCard className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            Supplier
            <Select className="mt-1 w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">
              <option value="">Choose the supplier…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            Bill file(s)
            <Input
              className="mt-1"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              aria-label="Bill files"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          <Button tone="primary" onClick={read} disabled={!files.length || reading}>
            {reading ? "Reading…" : "Read bill"}
          </Button>
        </div>
        {error ? <p className="mt-3 text-sm text-(--ui-danger-fg)">{error}</p> : null}
      </SectionCard>

      {result ? (
        <>
          <SectionCard className="mb-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {result.layout_label ? <Badge>{result.layout_label}</Badge> : <Badge tone="warning">Layout not recognised</Badge>}
              {result.bill_number ? <span className="text-sm">Bill <b>{result.bill_number}</b></span> : null}
              {result.bill_date ? <span className="text-sm">dated <b>{result.bill_date}</b></span> : null}
              <span className="text-sm text-(--ui-text-muted)">
                {result.files.length} file{result.files.length === 1 ? "" : "s"}
              </span>
            </div>

            {result.supplier_suggestion ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span>This looks like a bill from <b>{result.supplier_suggestion.name}</b>.</span>
                <Button size="sm" onClick={() => setSupplierId(String(result.supplier_suggestion.id))}>
                  Use this supplier
                </Button>
              </div>
            ) : null}
            {result.layout_warning ? <p className="mt-2 text-sm text-(--ui-warning-fg)">{result.layout_warning}</p> : null}
            {result.files.filter((f) => f.already).map((f) => (
              <p key={f.sha256} className="mt-2 text-sm text-(--ui-danger-fg)">
                {f.file_name} is already on bill {f.already.bill_number || `#${f.already.bill_id}`} of {f.already.supplier_name} ({f.already.status}): the same file can't be saved twice.
              </p>
            ))}
            {result.needs_photo_reader ? (
              <p className="mt-2 text-sm text-(--ui-warning-fg)">
                A photo or a scanned PDF can't be read by position: the photo reader comes in a later step.
              </p>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Lines read" value={result.lines.length} />
              <Stat label="Lines checked ✓" value={`${counts.ok} of ${result.lines.length}`} tone={counts.bad ? "danger" : "success"} />
              <Stat label="Pieces" value={counts.pieces.toLocaleString()} />
              <Stat
                label="Lines add up to"
                value={fmt(result.lines_total)}
                note={printedForLines != null ? `Bill says ${fmt(printedForLines)}` : "No total found on the bill"}
                tone={result.total_matches === false ? "danger" : result.total_matches ? "success" : undefined}
              />
            </div>
            {result.printed?.prev_balance != null ? (
              <p className="mt-3 text-sm text-(--ui-text-muted)">
                Printed on the bill: previous balance {fmt(result.printed.prev_balance)}
                {result.printed.total_balance != null ? ` · new balance ${fmt(result.printed.total_balance)}` : ""}
                {result.printed.due_date ? ` · due ${result.printed.due_date}` : ""}
              </p>
            ) : null}
            {result.printed?.discount ? (
              <p className="mt-1 text-sm text-(--ui-text-muted)">
                Bill discount {fmt(result.printed.discount)}{result.printed.discount_pct ? ` (${result.printed.discount_pct} %)` : ""} · total {fmt(result.printed.total)}
              </p>
            ) : null}
            {result.warnings.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm text-(--ui-warning-fg)">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            ) : null}
            {supplierId ? <p className="mt-2 text-xs text-(--ui-text-muted)">Supplier: {supplierName(supplierId)}</p> : null}
          </SectionCard>

          {result.lines.length ? (
            <SectionCard className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-(--ui-muted-surface) text-left text-xs uppercase text-(--ui-text-muted)">
                  <tr>
                    <th className="px-3 py-2">S.No</th>
                    <th className="px-3 py-2">Page</th>
                    <th className="px-3 py-2">Supplier code</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l) => (
                    <tr key={`${l.file_index}-${l.page}-${l.line_no}`} className="border-t border-(--ui-border)">
                      <td className="px-3 py-1.5 tabular-nums">{l.line_no}</td>
                      <td className="px-3 py-1.5 tabular-nums text-(--ui-text-muted)">{result.files.length > 1 ? `${l.file_index + 1}·` : ""}{l.page}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{l.supplier_code}</td>
                      <td className="px-3 py-1.5">
                        {l.description}
                        {l.packing && l.packing.ctn ? (
                          <span className="ml-2 text-xs text-(--ui-text-muted)">{l.packing.ctn} ctn × {l.packing.pkg}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.qty}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.rate?.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.amount?.toLocaleString()}</td>
                      <td className="px-3 py-1.5">
                        <Badge tone={CHECK[l.check]?.tone}>{CHECK[l.check]?.label || l.check}</Badge>
                        {l.check === "mismatch" ? (
                          <span className="ml-1 text-xs text-(--ui-text-muted)">should be {l.expected_amount?.toLocaleString()}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </PageShell>
  );
}

function Stat({ label, value, note, tone }) {
  const color = tone === "danger" ? "text-(--ui-danger-fg)" : tone === "success" ? "text-(--ui-success-fg)" : "text-(--ui-text)";
  return (
    <div className="rounded-(--ui-radius-sm) border border-(--ui-border) px-3 py-2">
      <div className="text-xs uppercase text-(--ui-text-muted)">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      {note ? <div className="text-xs text-(--ui-text-muted)">{note}</div> : null}
    </div>
  );
}
