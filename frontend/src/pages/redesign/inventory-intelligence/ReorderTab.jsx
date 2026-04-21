import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api";
import { useToast } from "../../../contexts/ToastContext";
import { Button, Select, TableToolbar } from "../../../ui/primitives";
import LeadTimeTag from "./LeadTimeTag";

function groupBySupplier(selected) {
  const byId = new Map();
  for (const r of selected) {
    const key = r.supplier_id || "none";
    if (!byId.has(key)) {
      byId.set(key, { supplier_id: r.supplier_id, supplier_name: r.supplier_name, rows: [] });
    }
    byId.get(key).rows.push(r);
  }
  return [...byId.values()];
}

export default function ReorderTab() {
  const navigate = useNavigate();
  const toast = useToast();
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");
  const [items, setItems] = useState([]);
  const [checked, setChecked] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Load outlet list once for the outlet selector.
  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/outlets")
      .then((res) => {
        if (!cancelled) setOutlets(res.outlets || res || []);
      })
      .catch(() => {
        // Outlet selector is optional — ignore failure here.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const q = outletId ? `?outlet_id=${outletId}` : "";
    api
      .get(`/api/inventory-intelligence/reorder${q}`)
      .then((res) => {
        if (!cancelled) {
          setItems(res.suggestions || []);
          setChecked(new Set());
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [outletId]);

  // Stable composite key — product_id × outlet_id, since a product can
  // appear once per outlet when no outlet filter is set.
  const rowKey = (r) => `${r.product_id}:${r.outlet_id ?? "none"}`;

  const allSelected = items.length > 0 && items.every((r) => checked.has(rowKey(r)));
  const toggleAll = () => {
    if (allSelected) setChecked(new Set());
    else setChecked(new Set(items.map(rowKey)));
  };

  const toggleRow = (r) => {
    const k = rowKey(r);
    const next = new Set(checked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setChecked(next);
  };

  const selectedRows = useMemo(
    () => items.filter((r) => checked.has(rowKey(r))),
    [items, checked]
  );

  const createPOs = async () => {
    const withSupplier = selectedRows.filter((r) => r.supplier_id);
    if (withSupplier.length === 0) {
      toast.warning("Select at least one product that has a default supplier.");
      return;
    }
    const skipped = selectedRows.length - withSupplier.length;
    const groups = groupBySupplier(withSupplier);
    setSubmitting(true);
    const created = [];
    for (const g of groups) {
      try {
        const res = await api.post("/api/inventory-intelligence/reorder/create-po", {
          supplier_id: g.supplier_id,
          outlet_id: outletId ? Number(outletId) : undefined,
          items: g.rows.map((r) => ({
            product_id: r.product_id,
            qty: r.suggested_qty,
            cost_price: 0,
          })),
        });
        created.push(res.po_id);
      } catch (err) {
        toast.error(`PO for ${g.supplier_name || "supplier " + g.supplier_id}: ${err.message}`);
      }
    }
    setSubmitting(false);
    if (created.length === 0) return;
    if (skipped > 0) {
      toast.warning(`${skipped} row(s) without a default supplier were skipped.`);
    }
    toast.success(
      created.length === 1
        ? "Draft PO created."
        : `${created.length} Draft POs created — opening the first.`
    );
    navigate(`/purchase-orders?po=${created[0]}`);
  };

  return (
    <div className="space-y-4">
      <TableToolbar
        left={
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-(--ui-text-muted)">Outlet</label>
            <Select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
              <option value="">All outlets</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        }
        right={
          <Button
            tone="primary"
            size="sm"
            onClick={createPOs}
            disabled={submitting || selectedRows.length === 0}
          >
            {submitting ? "Creating…" : `Create POs (${selectedRows.length})`}
          </Button>
        }
      />

      {error && <p className="text-sm text-(--ui-danger)">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--ui-border) text-left text-xs font-semibold uppercase text-(--ui-text-muted)">
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2 text-right">Current stock</th>
              <th className="px-3 py-2 text-right">Velocity /day</th>
              <th className="px-3 py-2">Lead time</th>
              <th className="px-3 py-2 text-right">Safety</th>
              <th className="px-3 py-2 text-right">Suggested qty</th>
              <th className="px-3 py-2">Supplier</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-(--ui-text-muted)">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-(--ui-text-muted)">
                  No products below threshold — nothing to reorder right now.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((r) => {
                const k = rowKey(r);
                return (
                  <tr key={k} className="border-b border-(--ui-border)">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked.has(k)}
                        onChange={() => toggleRow(r)}
                        aria-label={`Select ${r.name}`}
                      />
                    </td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right">
                      {Number(r.current_stock).toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {Number(r.velocity).toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <LeadTimeTag source={r.lead_time_source} days={r.lead_time_days} />
                    </td>
                    <td className="px-3 py-2 text-right">{r.safety_stock_days}d</td>
                    <td className="px-3 py-2 text-right font-semibold">{r.suggested_qty}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {r.supplier_name || "—"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
