// One Toy Store F9: receive a supplier bill without a purchase order.
// (b) pick the supplier, upload the bill's PDF(s) / photo(s), every line is
//     read and checked (qty × rate = amount, lines vs the printed total);
// (c1) each line matched to our toy(s) and checked on screen: pieces received,
//     split packs, cost per piece, our price, the total written on the bill.
// Save (stock in, bill onto the supplier's account) is step (c2).
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { Badge, Button, Input, PageShell, SectionCard, Select } from "../../ui/primitives";
import CheckLines from "./supplierBill/CheckLines";
import { billSummary, lineFromRead } from "./supplierBill/billMath";

export default function ReceiveSupplierBillRedesign() {
  const { fmt } = useCurrency();
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [lines, setLines] = useState([]);
  const [header, setHeader] = useState({ bill_number: "", bill_date: "", written_total: "", differs: false, differs_note: "" });

  useEffect(() => {
    api.get("/api/suppliers")
      .then((d) => setSuppliers((d.suppliers || d || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))))
      .catch(() => {});
  }, []);

  const match = async (sid, readResult) => {
    if (!sid || !readResult?.lines?.length) {
      setLines([]);
      return;
    }
    setBusy("Matching toys…");
    try {
      const d = await api.post("/api/supplier-bills/match", {
        supplier_id: Number(sid),
        lines: readResult.lines.map((l, i) => ({ key: String(i), supplier_code: l.supplier_code, barcode: l.barcode, description: l.description })),
      });
      setLines(readResult.lines.map((l, i) => lineFromRead(l, d.lines[i])));
    } catch (e) {
      setError(e.body?.error || e.message || "Could not match the toys");
    } finally {
      setBusy("");
    }
  };

  const read = async () => {
    if (!files.length) return;
    setBusy("Reading…");
    setError("");
    setResult(null);
    setLines([]);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      if (supplierId) fd.append("supplier_id", supplierId);
      const res = await api.upload("/api/supplier-bills/read", fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read the bill");
      setResult(data);
      const printed = data.printed?.total ?? data.printed?.subtotal;
      setHeader({
        bill_number: data.bill_number || "",
        bill_date: data.bill_date || "",
        written_total: printed != null ? String(printed) : "",
        differs: false,
        differs_note: "",
      });
      setBusy("");
      await match(supplierId, data);
    } catch (e) {
      setError(e.body?.error || e.message || "Could not read the bill");
      setBusy("");
    }
  };

  const chooseSupplier = (sid) => {
    setSupplierId(sid);
    if (result) match(sid, result);
  };

  const billDiscount = Number(result?.printed?.discount) || 0;
  const discountRatio = result?.lines_total ? billDiscount / result.lines_total : 0;
  const summary = useMemo(() => billSummary(lines, header.written_total), [lines, header.written_total]);
  const totalOk = summary.total_matches || (header.differs && header.differs_note.trim());
  const allReady = lines.length > 0 && summary.ready === lines.length;

  return (
    <PageShell
      title="Receive supplier bill"
      subtitle="Upload the supplier's bill, check every line, then save (save comes in the next step)."
    >
      <SectionCard className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            Supplier
            <Select className="mt-1 w-full" value={supplierId} onChange={(e) => chooseSupplier(e.target.value)} aria-label="Supplier">
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
          <Button tone="primary" onClick={read} disabled={!files.length || !!busy}>
            {busy || "Read bill"}
          </Button>
        </div>
        {error ? <p className="mt-3 text-sm text-(--ui-danger-fg)">{error}</p> : null}
      </SectionCard>

      {result ? (
        <SectionCard className="mb-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {result.layout_label ? <Badge>{result.layout_label}</Badge> : <Badge tone="warning">Layout not recognised</Badge>}
            <span className="text-sm text-(--ui-text-muted)">
              {result.files.length} file{result.files.length === 1 ? "" : "s"} · {result.lines.length} lines read ·{" "}
              {result.lines.filter((l) => l.check === "ok").length} with qty × rate = amount
            </span>
          </div>
          {result.supplier_suggestion ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span>This looks like a bill from <b>{result.supplier_suggestion.name}</b>.</span>
              <Button size="sm" onClick={() => chooseSupplier(String(result.supplier_suggestion.id))}>Use this supplier</Button>
            </div>
          ) : null}
          {result.layout_warning && !result.supplier_suggestion ? <p className="mt-2 text-sm text-(--ui-warning-fg)">{result.layout_warning}</p> : null}
          {result.layout_warning && result.supplier_suggestion && String(result.supplier_suggestion.id) !== supplierId ? (
            <p className="mt-2 text-sm text-(--ui-warning-fg)">{result.layout_warning}</p>
          ) : null}
          {result.files.filter((f) => f.already).map((f) => (
            <p key={f.sha256} className="mt-2 text-sm text-(--ui-danger-fg)">
              {f.file_name} is already on bill {f.already.bill_number || `#${f.already.bill_id}`} of {f.already.supplier_name} ({f.already.status}): the same file can't be saved twice.
            </p>
          ))}
          {result.needs_photo_reader ? (
            <p className="mt-2 text-sm text-(--ui-warning-fg)">A photo or a scanned PDF can't be read by position: the photo reader comes in a later step.</p>
          ) : null}
          {result.warnings.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-(--ui-warning-fg)">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          ) : null}
          {result.printed?.prev_balance != null ? (
            <p className="mt-2 text-sm text-(--ui-text-muted)">
              Printed on the bill: previous balance {fmt(result.printed.prev_balance)}
              {result.printed.total_balance != null ? ` · new balance ${fmt(result.printed.total_balance)}` : ""}
              {result.printed.due_date ? ` · due ${result.printed.due_date}` : ""}
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
              Bill number
              <Input className="mt-1" value={header.bill_number} onChange={(e) => setHeader((h) => ({ ...h, bill_number: e.target.value }))} />
            </label>
            <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
              Bill date
              <Input className="mt-1" type="date" value={header.bill_date} onChange={(e) => setHeader((h) => ({ ...h, bill_date: e.target.value }))} />
            </label>
            <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
              Total written on the bill
              <Input className="mt-1" type="number" value={header.written_total} onChange={(e) => setHeader((h) => ({ ...h, written_total: e.target.value }))} />
            </label>
            <div className="rounded-(--ui-radius-sm) border border-(--ui-border) px-3 py-2">
              <div className="text-xs uppercase text-(--ui-text-muted)">Lines add up to</div>
              <div className={`text-lg font-bold tabular-nums ${summary.total_matches ? "text-(--ui-success-fg)" : summary.total_matches === false ? "text-(--ui-danger-fg)" : ""}`}>
                {fmt(summary.lines_total)}
              </div>
              {summary.difference ? <div className="text-xs text-(--ui-danger-fg)">Difference {fmt(summary.difference)}</div> : null}
            </div>
          </div>
          {billDiscount ? (
            <p className="mt-2 text-sm text-(--ui-text-muted)">
              Bill discount {fmt(billDiscount)} spread over the lines by value (cost per piece already less it).
            </p>
          ) : null}
          {summary.total_matches === false ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={header.differs} onChange={(e) => setHeader((h) => ({ ...h, differs: e.target.checked }))} />
                Supplier&apos;s total is different
              </label>
              {header.differs ? (
                <Input className="max-w-md" placeholder="Why? (e.g. they added it up wrong)" aria-label="Why the total is different"
                  value={header.differs_note} onChange={(e) => setHeader((h) => ({ ...h, differs_note: e.target.value }))} />
              ) : null}
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {result && !supplierId && result.lines.length ? (
        <SectionCard className="mb-4 p-4 text-sm">Choose the supplier to match the lines to your toys.</SectionCard>
      ) : null}

      {lines.length ? (
        <>
          <CheckLines lines={lines} onChange={setLines} billDiscountRatio={discountRatio} multiFile={result?.files.length > 1} />
          <SectionCard className="mt-4 flex flex-wrap items-center gap-3 p-4">
            <span className="text-sm">
              {summary.ready} of {lines.length} lines ready
              {summary.new_toys ? ` · ${summary.new_toys} new toys` : ""}
              {summary.returns ? ` · ${summary.returns} sent back` : ""}
              {!totalOk ? " · the total doesn't match yet" : ""}
            </span>
            <div className="flex-1" />
            <Button tone="primary" disabled title="Save comes in the next step">
              Save bill {allReady && totalOk ? "(next step)" : ""}
            </Button>
          </SectionCard>
        </>
      ) : null}
    </PageShell>
  );
}
