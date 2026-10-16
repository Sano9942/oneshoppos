// Product History tab (One Toy Store pilot, Phase B step 7): stock ledger with
// running balance (per branch or all branches, per variant), price & cost
// changes (who, why) and sales by bill no (returns as minus lines). The stock
// and price rows are recorded by the database from the day this went live;
// sales come from the bills themselves. See backend services/product-history.js.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, SectionCard, Select, TabBar } from "../../ui/primitives";
import { useCurrency } from "../../contexts/CurrencyContext";
import { api } from "../../api";
import { fmtUtcDateTime } from "../../utils/dates";

const KIND_LABELS = {
  opening: "Opening stock",
  new_item: "New item",
  edit: "Product edit",
  sale: "Sale",
  void: "Sale voided",
  return: "Return",
  delivery: "Delivery",
  bill_undone: "Supplier bill undone",
  adjustment: "Adjustment",
  transfer: "Transfer",
  count: "Stock count",
  supplier_return: "Return to supplier",
  online_order: "Online order",
  price_sheet: "Price sheet",
  import: "Import",
};

function kindLabel(kind, qtyChange) {
  if (kind === "transfer" && qtyChange != null) return Number(qtyChange) < 0 ? "Transfer out" : "Transfer in";
  return KIND_LABELS[kind] || "Other change";
}

// 2.000 → "2", -1.5 → "−1.5"; signed adds "+" for positives.
function fmtQty(v, { signed = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const abs = String(Math.abs(Math.round(n * 1000) / 1000));
  if (n < 0) return `−${abs}`;
  return signed && n > 0 ? `+${abs}` : abs;
}

function BillLink({ no }) {
  if (!no) return null;
  return (
    <Link to={`/sales-history?q=${encodeURIComponent(no)}`} className="text-(--ui-link) hover:underline">
      {no}
    </Link>
  );
}

function RefCell({ row }) {
  const billish = row.ref_type === "sale" || row.ref_type === "return";
  return (
    <>
      <span className="font-medium text-(--ui-text)">{kindLabel(row.kind, row.qty_change)}</span>
      {row.ref_no && <> {billish ? <BillLink no={row.ref_no} /> : <span>{row.ref_no}</span>}</>}
      {row.note && <div className="text-xs text-(--ui-text-muted)">{row.note}</div>}
    </>
  );
}

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase text-(--ui-text-muted)";
const TD = "px-3 py-2 align-top";

function StockTab({ productId, variantId, outlets }) {
  const [outletId, setOutletId] = useState("all");
  const [data, setData] = useState(null);
  const [more, setMore] = useState(false);

  const url = useCallback((beforeId) => {
    let u = `/api/products/${productId}/history/stock?outlet_id=${outletId}`;
    if (variantId) u += `&variant_id=${variantId}`;
    if (beforeId) u += `&before_id=${beforeId}`;
    return u;
  }, [productId, variantId, outletId]);

  useEffect(() => {
    let live = true;
    api.get(url()).then((d) => { if (live) { setData({ items: d?.items || [], on_hand: d?.on_hand ?? null }); setMore((d?.items || []).length >= 200); } })
      .catch(() => { if (live) setData({ items: [], on_hand: null }); });
    return () => { live = false; };
  }, [url]);

  const loadMore = async () => {
    const last = data.items[data.items.length - 1];
    const d = await api.get(url(last.id));
    setData((prev) => ({ ...prev, items: [...prev.items, ...(d.items || [])] }));
    setMore((d.items || []).length >= 200);
  };

  const all = outletId === "all";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-(--ui-text-muted)">
          Branch
          <Select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="all">All branches</option>
            {outlets.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </Select>
        </label>
        {data?.on_hand != null && (
          <div data-testid="history-on-hand" className="text-sm text-(--ui-text-muted)">
            On hand now: <strong className="text-(--ui-text)">{fmtQty(data.on_hand)}</strong>
          </div>
        )}
      </div>
      {!data ? (
        <p className="text-sm text-(--ui-text-muted)">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-(--ui-radius-md) border border-(--ui-border)">
          <table data-testid="history-stock" className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border)">
                <th className={TH}>When</th>
                {all && <th className={TH}>Branch</th>}
                <th className={TH}>What</th>
                <th className={TH}>Who</th>
                <th className={`${TH} text-right`}>Change</th>
                <th className={`${TH} text-right`}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr><td className={TD} colSpan={all ? 6 : 5}>No stock movements recorded yet.</td></tr>
              )}
              {data.items.map((r) => (
                <tr key={r.id} className="border-b border-(--ui-border) last:border-0">
                  <td className={`${TD} whitespace-nowrap text-(--ui-text-muted)`}>{fmtUtcDateTime(r.created_at)}</td>
                  {all && <td className={TD}>{r.outlet_name || `#${r.outlet_id}`}</td>}
                  <td className={TD}><RefCell row={r} /></td>
                  <td className={TD}>{r.employee_name || "—"}</td>
                  <td className={`${TD} text-right tabular-nums ${Number(r.qty_change) < 0 ? "text-(--ui-danger-fg)" : "text-(--ui-success-fg)"}`}>
                    {fmtQty(r.qty_change, { signed: true })}
                  </td>
                  <td className={`${TD} text-right font-medium tabular-nums`}>{fmtQty(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <Button size="sm" onClick={loadMore}>Load older</Button>}
      <p className="text-xs text-(--ui-text-muted)">
        Recorded from the day the history was switched on; the first line is the stock on hand then.
      </p>
    </div>
  );
}

function PricesTab({ productId, variantId }) {
  const { fmt } = useCurrency();
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    const u = `/api/products/${productId}/history/prices` + (variantId ? `?variant_id=${variantId}` : "");
    api.get(u).then((d) => { if (live) setItems(d.items || []); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [productId, variantId]);

  if (!items) return <p className="text-sm text-(--ui-text-muted)">Loading…</p>;
  return (
    <div className="overflow-x-auto rounded-(--ui-radius-md) border border-(--ui-border)">
      <table data-testid="history-prices" className="w-full text-sm">
        <thead>
          <tr className="border-b border-(--ui-border)">
            <th className={TH}>When</th>
            <th className={TH}>Which</th>
            <th className={TH}>Old → new</th>
            <th className={TH}>Why</th>
            <th className={TH}>Who</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && <tr><td className={TD} colSpan={5}>No price or cost changes recorded yet.</td></tr>}
          {items.map((r) => (
            <tr key={r.id} className="border-b border-(--ui-border) last:border-0">
              <td className={`${TD} whitespace-nowrap text-(--ui-text-muted)`}>{fmtUtcDateTime(r.changed_at)}</td>
              <td className={TD}>
                {r.field === "price" ? "Selling price" : "Cost"}
                {r.variant_sku && <div className="text-xs text-(--ui-text-muted)">{r.variant_sku}</div>}
              </td>
              <td className={`${TD} whitespace-nowrap`}>
                {r.old_value == null ? "—" : fmt(r.old_value)} → <strong>{fmt(r.new_value)}</strong>
              </td>
              <td className={TD}><RefCell row={r} /></td>
              <td className={TD}>{r.employee_name || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SalesTab({ productId, variantId }) {
  const { fmt } = useCurrency();
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(false);
  const base = `/api/products/${productId}/history/sales` + (variantId ? `?variant_id=${variantId}` : "");

  useEffect(() => {
    let live = true;
    api.get(base).then((d) => { if (live) { setItems(d.items || []); setMore((d.items || []).length >= 200); } })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [base]);

  const loadMore = async () => {
    const d = await api.get(`${base}${base.includes("?") ? "&" : "?"}offset=${items.length}`);
    setItems((prev) => [...prev, ...(d.items || [])]);
    setMore((d.items || []).length >= 200);
  };

  if (!items) return <p className="text-sm text-(--ui-text-muted)">Loading…</p>;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-(--ui-radius-md) border border-(--ui-border)">
        <table data-testid="history-sales" className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--ui-border)">
              <th className={TH}>When</th>
              <th className={TH}>Bill no</th>
              <th className={TH}>Type</th>
              <th className={`${TH} text-right`}>Qty</th>
              <th className={`${TH} text-right`}>Price</th>
              <th className={TH}>Cashier</th>
              <th className={TH}>Branch</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td className={TD} colSpan={7}>No sales yet.</td></tr>}
            {items.map((r) => (
              <tr key={`${r.line_type}-${r.line_id}`}
                className={`border-b border-(--ui-border) last:border-0 ${r.voided ? "text-(--ui-text-muted) line-through" : ""}`}>
                <td className={`${TD} whitespace-nowrap text-(--ui-text-muted)`}>{fmtUtcDateTime(r.at)}</td>
                <td className={TD}>{r.invoice_number ? <BillLink no={r.invoice_number} /> : `#${r.sale_id ?? "—"}`}</td>
                <td className={TD}>
                  {r.line_type === "return" ? "Return" : "Sale"}
                  {r.voided && <> <Badge tone="warning">Voided</Badge></>}
                  {r.variant_sku && <div className="text-xs text-(--ui-text-muted)">{r.variant_sku}</div>}
                </td>
                <td className={`${TD} text-right tabular-nums`}>{fmtQty(r.quantity)}</td>
                <td className={`${TD} text-right tabular-nums`}>{fmt(r.price)}</td>
                <td className={TD}>{r.cashier || "—"}</td>
                <td className={TD}>{r.outlet_name || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && <Button size="sm" onClick={loadMore}>Load older</Button>}
    </div>
  );
}

export default function ProductHistory({ productId, variants = [] }) {
  const [tab, setTab] = useState("stock");
  const [variantId, setVariantId] = useState("");
  const [outlets, setOutlets] = useState([]);

  useEffect(() => {
    api.get("/api/outlets").then((d) => setOutlets(Array.isArray(d) ? d : d?.outlets || [])).catch(() => {});
  }, []);

  const variantLabel = (v) => (v.options || []).map((o) => o.option_value).filter(Boolean).join(" / ") || v.sku || `#${v.id}`;

  return (
    <SectionCard>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">History</p>
          </div>
          {variants.length > 0 && (
            <label className="flex flex-col gap-1 text-xs font-medium text-(--ui-text-muted)">
              Variant
              <Select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                <option value="">All variants (product total)</option>
                {variants.filter((v) => v.id).map((v) => <option key={v.id} value={String(v.id)}>{variantLabel(v)}</option>)}
              </Select>
            </label>
          )}
        </div>
        <TabBar
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "stock", label: "Stock" },
            { value: "prices", label: "Price & cost" },
            { value: "sales", label: "Sales" },
          ]}
        />
        {tab === "stock" && <StockTab productId={productId} variantId={variantId} outlets={outlets} />}
        {tab === "prices" && <PricesTab productId={productId} variantId={variantId} />}
        {tab === "sales" && <SalesTab productId={productId} variantId={variantId} />}
      </div>
    </SectionCard>
  );
}
