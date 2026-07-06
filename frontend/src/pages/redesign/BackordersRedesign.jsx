import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { PackagePlus, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import {
  PageShell, SectionCard, Button, Select, Badge, Modal, ModalBody, ModalFooter,
  TabBar, EmptyState, Input,
} from "../../ui/primitives";
import { fmtUtcDate } from "../../utils/dates";

/**
 * V02 wholesale — Backorders fulfillment screen.
 *
 * Lists open/partial backorders (oldest first — the fulfillment order the
 * suggestions endpoint uses), shows live stock next to each row, and converts
 * a backorder into an invoice through the STANDARD sale path
 * (POST /api/sales with cartItems[].backorder_id) at the ORDER-time snapshot
 * price. "By product" tab is the purchasing view (open value per product).
 */
export default function BackordersRedesign() {
  const { authHeaders, employee } = useAuth();
  const authHeadersMemo = useMemo(() => authHeaders, [authHeaders]);
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeadersMemo);
  const { fmt } = useCurrency();
  const toast = useToast();

  const [tab, setTab] = useState("open");
  const [statusFilter, setStatusFilter] = useState("");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // Convert modal state
  const [converting, setConverting] = useState(null); // backorder row
  const [convertQty, setConvertQty] = useState("");
  const [convertTender, setConvertTender] = useState("Credit");
  const [convertBusy, setConvertBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        api.get("/api/backorders", statusFilter ? { status: statusFilter } : undefined),
        api.get("/api/backorders/summary"),
      ]);
      setRows(list.backorders || []);
      setSummary(sum);
    } catch (err) {
      toast.error(err.message || "Failed to load backorders");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const openConvert = (row) => {
    const remaining = Number(row.qty_remaining);
    const stock = Number(row.stock_available || 0);
    setConverting(row);
    setConvertQty(String(Math.max(0, Math.min(remaining, stock)) || remaining));
    setConvertTender("Credit");
  };

  const doConvert = async () => {
    if (!converting) return;
    const qty = Number(convertQty);
    if (!(qty > 0)) return toast.error("Enter a quantity");
    if (qty > Number(converting.qty_remaining)) {
      return toast.error(`Only ${converting.qty_remaining} remaining on this backorder`);
    }
    setConvertBusy(true);
    try {
      const amount = Math.round(qty * Number(converting.unit_price) * 100) / 100;
      const data = await api.post("/api/sales", {
        outlet_id: Number(converting.outlet_id) || undefined,
        employee_id: employee?.id || null,
        customer_id: Number(converting.customer_id),
        cartItems: [{
          id: Number(converting.product_id),
          variant_id: converting.variant_id || null,
          name: converting.product_name,
          // snapshot price — the backend rejects any drift
          price: Number(converting.unit_price),
          quantity: qty,
          backorder_id: converting.id,
        }],
        payments: [{ method: convertTender, amount }],
        idempotency_key: crypto.randomUUID(),
      });
      toast.success(
        `Backorder fulfilled — invoice ${data.invoiceNumber || data.saleId}${convertTender === "Credit" && data.arInvoice ? ` (A/R ${data.arInvoice.invoice_number})` : ""}`
      );
      setConverting(null);
      await load();
    } catch (err) {
      toast.error(err.message || "Conversion failed");
    } finally {
      setConvertBusy(false);
    }
  };

  const cancelRow = async (row) => {
    const reason = window.prompt(`Cancel backorder #${row.id} for ${row.customer_name}? Reason (optional):`);
    if (reason === null) return;
    try {
      await api.put(`/api/backorders/${row.id}/cancel`, { reason: reason || null });
      toast.success("Backorder cancelled");
      await load();
    } catch (err) {
      toast.error(err.message || "Cancel failed");
    }
  };

  const statusTone = (s) => (s === "open" ? "warning" : s === "partial" ? "default" : s === "fulfilled" ? "success" : "default");

  const totals = useMemo(() => summary?.totals || { open_count: 0, value_remaining: 0 }, [summary]);

  if (flagsLoading) return null;
  if (!flags.wholesale_backorders) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Backorders"
      subtitle={`${totals.open_count} open — ${fmt(Number(totals.value_remaining || 0))} committed at order-time prices`}
      right={
        <Button onClick={load} iconOnly aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      }
    >
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "open", label: "Backorders" },
          { value: "products", label: "By product (purchasing)" },
        ]}
        className="mb-4"
      />

      {tab === "open" && (
        <SectionCard>
          <div className="flex items-center gap-2 mb-3">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
              <option value="">Open + partial</option>
              <option value="open">Open</option>
              <option value="partial">Partial</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>

          {loading ? null : rows.length === 0 ? (
            <EmptyState
              icon={<PackagePlus className="h-8 w-8" />}
              title="No backorders"
              body="When an order can't be fully fulfilled, the offered remainder lands here at the order-time price."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
                    <th className="py-2 pr-3 font-medium">Ordered</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium text-right">Remaining</th>
                    <th className="py-2 pr-3 font-medium text-right">Snapshot price</th>
                    <th className="py-2 pr-3 font-medium text-right">Value</th>
                    <th className="py-2 pr-3 font-medium text-right">In stock</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-0" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-(--ui-border) last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtUtcDate(r.created_at)}</td>
                      <td className="py-2 pr-3">{r.customer_name}</td>
                      <td className="py-2 pr-3">
                        {r.product_name}
                        {r.variant_sku ? <span className="text-(--ui-text-muted)"> — {r.variant_sku}</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-right">{Number(r.qty_remaining)}</td>
                      <td className="py-2 pr-3 text-right">{fmt(Number(r.unit_price))}</td>
                      <td className="py-2 pr-3 text-right">{fmt(Number(r.value_remaining))}</td>
                      <td className="py-2 pr-3 text-right">
                        <span className={Number(r.stock_available) > 0 ? "text-(--ui-success-fg) font-medium" : "text-(--ui-text-muted)"}>
                          {Number(r.stock_available)}
                        </span>
                      </td>
                      <td className="py-2 pr-3"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                      <td className="py-2 pr-0 text-right whitespace-nowrap">
                        {["open", "partial"].includes(r.status) && (
                          <>
                            <Button size="sm" tone="primary" onClick={() => openConvert(r)} disabled={Number(r.stock_available) <= 0}>
                              Fulfill
                            </Button>{" "}
                            <Button size="sm" onClick={() => cancelRow(r)}>Cancel</Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === "products" && (
        <SectionCard>
          {!summary || summary.products.length === 0 ? (
            <EmptyState icon={<PackagePlus className="h-8 w-8" />} title="Nothing on backorder" body="Open backorder demand by product appears here to feed purchasing." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium">SKU</th>
                    <th className="py-2 pr-3 font-medium text-right">Open orders</th>
                    <th className="py-2 pr-3 font-medium text-right">Qty needed</th>
                    <th className="py-2 pr-3 font-medium text-right">Committed value</th>
                    <th className="py-2 pr-3 font-medium">Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.products.map((p) => (
                    <tr key={p.product_id} className="border-b border-(--ui-border) last:border-0">
                      <td className="py-2 pr-3">{p.product_name}</td>
                      <td className="py-2 pr-3 text-(--ui-text-muted)">{p.sku || "—"}</td>
                      <td className="py-2 pr-3 text-right">{Number(p.open_count)}</td>
                      <td className="py-2 pr-3 text-right">{Number(p.qty_remaining)}</td>
                      <td className="py-2 pr-3 text-right">{fmt(Number(p.value_remaining))}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtUtcDate(p.oldest_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      <Modal open={!!converting} onClose={() => (convertBusy ? null : setConverting(null))} title="Fulfill backorder">
        {converting && (
          <>
            <ModalBody>
              <p className="text-sm text-(--ui-text-muted)">
                {converting.customer_name} — {converting.product_name} at the order-time price of{" "}
                <span className="font-semibold text-(--ui-text)">{fmt(Number(converting.unit_price))}</span>{" "}
                (never re-priced). Remaining: {Number(converting.qty_remaining)} · In stock: {Number(converting.stock_available)}.
              </p>
              <label className="block text-sm">
                <span className="text-(--ui-text-muted)">Quantity to fulfill now</span>
                <Input
                  type="number"
                  min="0"
                  value={convertQty}
                  onChange={(e) => setConvertQty(e.target.value)}
                  className="mt-1"
                />
              </label>
              <label className="block text-sm">
                <span className="text-(--ui-text-muted)">Tender</span>
                <Select value={convertTender} onChange={(e) => setConvertTender(e.target.value)} className="mt-1">
                  <option value="Credit">On account (Credit — creates A/R invoice)</option>
                  <option value="Cash">Cash</option>
                  <option value="Card">Card</option>
                </Select>
              </label>
              <p className="text-xs text-(--ui-text-muted)">
                Total: {fmt(Math.round(Number(convertQty || 0) * Number(converting.unit_price) * 100) / 100)}.
                Goes through the standard sale path (stock, tax, A/R, notifications). Requires an open shift on the outlet.
              </p>
            </ModalBody>
            <ModalFooter>
              <Button onClick={() => setConverting(null)} disabled={convertBusy}>Close</Button>
              <Button tone="primary" onClick={doConvert} disabled={convertBusy}>
                {convertBusy ? "Fulfilling…" : "Fulfill & invoice"}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </PageShell>
  );
}
