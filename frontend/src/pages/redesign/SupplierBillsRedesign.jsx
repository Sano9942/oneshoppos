// One Toy Store F9 (f): Supplier bills. Every saved / undone bill with who
// saved it and its files (PDFs, photos), one supplier at a time from the
// Suppliers page (?supplier_id=) or all of them. A bill opens with its lines
// as the supplier wrote them, the toys they went to, and its account entries.
// A saved bill is corrected from here (Correct this bill, step (f) 5/6).
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { Badge, Button, Drawer, Input, PageShell, SectionCard, Select } from "../../ui/primitives";
import { billFileHref } from "./supplierBill/billFiles";
import CorrectBill from "./supplierBill/CorrectBill";
import { CORRECTION_LABELS, correctionWords } from "./supplierBill/correctionText";

const PAGE = 50;
const ENTRY_LABELS = { not_received: "Not received", discount: "Discount", correction: "Correction" };
const PAID_LABELS = { till_cash: "Cash from the till", cheque: "Cheque", bank_transfer: "Bank transfer" };

const qty = (v) => String(Math.round(Number(v) * 1000) / 1000);
const when = (t) => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export default function SupplierBillsRedesign() {
  const { fmt } = useCurrency();
  const [params, setParams] = useSearchParams();
  const [suppliers, setSuppliers] = useState([]);
  const [filters, setFilters] = useState({
    supplier_id: params.get("supplier_id") || "", status: "", from: "", to: "", q: "",
  });
  const [data, setData] = useState({ bills: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.get("/api/suppliers")
      .then((d) => setSuppliers((d.suppliers || d || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))))
      .catch(() => {});
  }, []);

  const load = async (at = 0) => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(at) });
      for (const [k, v] of Object.entries(filters)) if (String(v).trim()) qs.set(k, String(v).trim());
      setData(await api.get(`/api/supplier-bills?${qs}`));
      setOffset(at);
    } catch (e) {
      setError(e.body?.error || e.message || "Could not load the bills");
    } finally {
      setLoading(false);
    }
  };
  // Supplier and status apply at once; dates and search on "Show".
  useEffect(() => {
    load(0);
    if (filters.supplier_id) setParams({ supplier_id: filters.supplier_id }, { replace: true });
    else setParams({}, { replace: true });
  }, [filters.supplier_id, filters.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const openBill = async (id) => {
    setOpen({ loading: true });
    try {
      const d = await api.get(`/api/supplier-bills/${id}`);
      setOpen(d.bill);
    } catch (e) {
      setOpen({ error: e.body?.error || e.message || "Could not open the bill" });
    }
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const supplierName = suppliers.find((s) => String(s.id) === String(filters.supplier_id))?.name;

  return (
    <PageShell
      title={supplierName ? `Supplier bills: ${supplierName}` : "Supplier bills"}
      subtitle="Every bill received, who saved it and its files."
      right={<Link to="/supplier-bills/new"><Button tone="primary">Receive supplier bill</Button></Link>}
    >
      <SectionCard className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_2fr_auto] md:items-end">
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            Supplier
            <Select className="mt-1 w-full" value={filters.supplier_id} onChange={set("supplier_id")} aria-label="Supplier">
              <option value="">All suppliers</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            Bills
            <Select className="mt-1 w-full" value={filters.status} onChange={set("status")} aria-label="Bills">
              <option value="">Saved and undone</option>
              <option value="saved">Saved</option>
              <option value="undone">Undone</option>
            </Select>
          </label>
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            Bill date from
            <Input className="mt-1" type="date" value={filters.from} onChange={set("from")} aria-label="From" />
          </label>
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            To
            <Input className="mt-1" type="date" value={filters.to} onChange={set("to")} aria-label="To" />
          </label>
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            Bill number or supplier
            <Input className="mt-1" value={filters.q} onChange={set("q")} aria-label="Search"
              onKeyDown={(e) => { if (e.key === "Enter") load(0); }} />
          </label>
          <Button onClick={() => load(0)} disabled={loading}>Show</Button>
        </div>
        {error ? <p className="mt-3 text-sm text-(--ui-danger-fg)">{error}</p> : null}
      </SectionCard>

      <SectionCard className="p-0">
        <table className="w-full text-sm" data-testid="supplier-bills">
          <thead className="text-left text-xs uppercase text-(--ui-text-muted)">
            <tr>
              <th className="px-3 py-2">Bill date</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Bill</th>
              <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Lines</th><th className="px-3 py-2">Files</th>
              <th className="px-3 py-2">Saved</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.bills.map((b) => (
              <tr key={b.id} className="border-t border-(--ui-border)">
                <td className="px-3 py-2 whitespace-nowrap">{b.bill_date || "—"}</td>
                <td className="px-3 py-2">{b.supplier_name}</td>
                <td className="px-3 py-2">
                  {b.bill_number || "(no number)"}
                  {b.status === "undone" ? <> <Badge tone="warning">Undone</Badge></> : null}
                  {b.paid_now_method ? <span className="block text-xs text-(--ui-text-muted)">Paid now {fmt(Number(b.paid_now_amount) || 0)} · {PAID_LABELS[b.paid_now_method]}</span> : null}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${b.status === "undone" ? "text-(--ui-text-muted) line-through" : ""}`}>{fmt(Number(b.amount) || 0)}</td>
                <td className="px-3 py-2 tabular-nums">{b.lines}</td>
                <td className="px-3 py-2 tabular-nums">{b.files || "—"}</td>
                <td className="px-3 py-2">{when(b.saved_at)}{b.saved_by_name ? ` · ${b.saved_by_name}` : ""}</td>
                <td className="px-3 py-2 text-right"><Button size="sm" onClick={() => openBill(b.id)}>Open</Button></td>
              </tr>
            ))}
            {!data.bills.length && !loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-(--ui-text-muted)">No bills{supplierName ? ` from ${supplierName}` : ""} yet.</td></tr>
            ) : null}
          </tbody>
        </table>
        {data.total > PAGE ? (
          <div className="flex items-center justify-end gap-2 border-t border-(--ui-border) px-3 py-2 text-sm">
            <span className="text-(--ui-text-muted)">{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
            <Button size="sm" disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - PAGE))}>Prev</Button>
            <Button size="sm" disabled={offset + PAGE >= data.total || loading} onClick={() => load(offset + PAGE)}>Next</Button>
          </div>
        ) : null}
      </SectionCard>

      <Drawer open={!!open} onClose={() => setOpen(null)} size="lg"
        title={open?.id ? `${open.supplier_name} bill ${open.bill_number || "(no number)"}` : "Supplier bill"}>
        {open?.loading ? <p className="text-sm">Opening…</p> : null}
        {open?.error ? <p className="text-sm text-(--ui-danger-fg)">{open.error}</p> : null}
        {open?.id ? <BillDetail bill={open} fmt={fmt} onCorrected={(b) => { setOpen(b); load(offset); }} /> : null}
      </Drawer>
    </PageShell>
  );
}

function BillDetail({ bill, fmt, onCorrected }) {
  const [correcting, setCorrecting] = useState(false);
  const [done, setDone] = useState("");
  const corrections = bill.corrections || [];
  const correctedLines = new Set(corrections.map((c) => c.line_id).filter(Boolean));
  const correctionsTotal = Math.round(corrections.reduce((t, c) => t + Number(c.amount || 0), 0) * 100) / 100;
  return (
    <div className="space-y-4 text-sm">
      {bill.status === "saved" ? (
        correcting ? (
          <CorrectBill bill={bill} fmt={fmt} onCancel={() => setCorrecting(false)}
            onDone={(b) => { setCorrecting(false); setDone("Correction saved"); onCorrected(b); }} />
        ) : (
          <div className="flex items-center justify-end gap-3">
            {done ? <span className="text-(--ui-success-fg)">{done}</span> : null}
            <Button onClick={() => { setDone(""); setCorrecting(true); }}>Correct this bill</Button>
          </div>
        )
      ) : null}
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div><span className="text-(--ui-text-muted)">Bill date:</span> {bill.bill_date || "—"}</div>
        <div><span className="text-(--ui-text-muted)">Goods went to:</span> {bill.outlet_name || "—"}</div>
        <div><span className="text-(--ui-text-muted)">On the supplier&apos;s account:</span> <b>{fmt(Number(bill.amount) || 0)}</b></div>
        {correctionsTotal ? (
          <div className="sm:col-span-2" data-testid="corrections-total">
            <span className="text-(--ui-text-muted)">Corrections on the account:</span> {correctionsTotal > 0 ? "+" : "−"}{fmt(Math.abs(correctionsTotal))}
          </div>
        ) : null}
        <div><span className="text-(--ui-text-muted)">Saved:</span> {when(bill.saved_at)}{bill.saved_by_name ? ` by ${bill.saved_by_name}` : ""}</div>
        {bill.total_differs ? <div className="sm:col-span-2 text-(--ui-warning-fg)">Supplier&apos;s total was different: {bill.total_note}</div> : null}
        {bill.paid_now_method ? (
          <div className="sm:col-span-2">
            <span className="text-(--ui-text-muted)">Paid now:</span> {fmt(Number(bill.paid_now_amount) || 0)} · {PAID_LABELS[bill.paid_now_method]}
            {bill.paid_now_reference ? ` · ${bill.paid_now_reference}` : ""}
          </div>
        ) : null}
        {bill.status === "undone" ? (
          <div className="sm:col-span-2">
            <Badge tone="warning">Undone</Badge> {when(bill.undone_at)}{bill.undone_by_name ? ` by ${bill.undone_by_name}` : ""}: {bill.undo_reason}
          </div>
        ) : null}
      </div>

      <div>
        <h3 className="mb-1 font-semibold">Files ({bill.files.length})</h3>
        {bill.files.length ? (
          <ul className="list-disc pl-5">
            {bill.files.map((f) => {
              const href = billFileHref(f.storage_key);
              return (
                <li key={f.id}>
                  {href ? <a className="underline" href={href} target="_blank" rel="noreferrer">{f.file_name}</a> : f.file_name}
                  <span className="text-(--ui-text-muted)"> · {f.content_type === "application/pdf" ? "PDF" : "photo"}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-(--ui-text-muted)">Typed in, no file.</p>}
      </div>

      <div>
        <h3 className="mb-1 font-semibold">Lines ({bill.lines.length})</h3>
        <table className="w-full" data-testid="supplier-bill-lines">
          <thead className="text-left text-xs uppercase text-(--ui-text-muted)">
            <tr>
              <th className="py-1 pr-2">S.No</th><th className="py-1 pr-2">Their code · description</th>
              <th className="py-1 pr-2 text-right">Billed</th><th className="py-1 pr-2 text-right">Received</th>
              <th className="py-1 pr-2 text-right">Rate</th><th className="py-1 pr-2 text-right">Amount</th>
              <th className="py-1 pr-2 text-right">Cost / pc</th><th className="py-1">Our toy</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l) => (
              <tr key={l.id} className="border-t border-(--ui-border) align-top">
                <td className="py-1 pr-2">
                  {l.line_no}{l.page ? <span className="block text-xs text-(--ui-text-muted)">p{l.page}</span> : null}
                  {correctedLines.has(l.id) ? <Badge tone="warning">Corrected</Badge> : null}
                </td>
                <td className="py-1 pr-2">
                  {l.supplier_code ? <span className="block font-mono text-xs">{l.supplier_code}</span> : null}
                  {l.description}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{qty(l.billed_qty)}</td>
                <td className={`py-1 pr-2 text-right tabular-nums ${Number(l.received_qty) !== Number(l.billed_qty) ? "font-semibold text-(--ui-warning-fg)" : ""}`}>
                  {qty(l.received_qty)}{Number(l.split_into) > 1 ? <span className="block text-xs text-(--ui-text-muted)">× {l.split_into} pcs</span> : null}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {Number(l.rate).toLocaleString()}{Number(l.discount_pct) ? <span className="block text-xs text-(--ui-text-muted)">− {Number(l.discount_pct)}%</span> : null}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{Number(l.amount).toLocaleString()}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{l.unit_cost != null ? Number(l.unit_cost).toLocaleString() : "—"}</td>
                <td className="py-1">
                  {l.toys.map((t) => (
                    <span key={t.product_id} className="block">
                      <span className="font-mono text-xs">{t.sku}</span> {t.name} · {qty(t.qty)}
                      {Number(t.extra_qty) > 0 ? ` (${qty(t.extra_qty)} extra)` : ""}
                    </span>
                  ))}
                  {l.is_new_product ? <Badge>New toy</Badge> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {corrections.length ? (
        <div>
          <h3 className="mb-1 font-semibold">Corrections ({corrections.length})</h3>
          <ul className="list-disc pl-5" data-testid="supplier-bill-corrections">
            {corrections.map((c) => (
              <li key={c.id}>
                <b>{CORRECTION_LABELS[c.kind] || c.kind}</b>{c.line_no ? `, line ${c.line_no}` : ""}: {correctionWords(c)}
                {Number(c.amount) ? ` · we owe ${fmt(Math.abs(Number(c.amount)))} ${Number(c.amount) > 0 ? "more" : "less"}` : ""}
                {" · "}{c.note}
                <span className="text-(--ui-text-muted)"> · {when(c.created_at)}{c.employee_name ? ` by ${c.employee_name}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {bill.entries.length ? (
        <div>
          <h3 className="mb-1 font-semibold">On the supplier&apos;s account besides the bill</h3>
          <ul className="list-disc pl-5">
            {bill.entries.map((e) => (
              <li key={e.id} className={e.voided ? "line-through text-(--ui-text-muted)" : ""}>
                {ENTRY_LABELS[e.kind] || e.kind} {fmt(Number(e.amount))} · {e.entry_date}{e.note ? ` · ${e.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
