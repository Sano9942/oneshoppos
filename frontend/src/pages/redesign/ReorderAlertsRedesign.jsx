import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { PageShell, SectionCard } from "../../ui/primitives";

function rowClass(days) {
  if (days == null) return "";
  if (days < 7) return "bg-red-50";
  if (days <= 14) return "bg-amber-50";
  return "bg-green-50";
}

export default function ReorderAlertsRedesign() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/reports/replenishment-smart")
      .then((data) => {
        const sorted = (data.products || []).slice().sort(
          (a, b) => (a.days_of_stock_remaining ?? Infinity) - (b.days_of_stock_remaining ?? Infinity)
        );
        setProducts(sorted);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell title="Reorder Alerts" subtitle="Products sorted by urgency (most critical first)">
      <SectionCard>
        {loading && <p className="p-4 text-sm text-(--ui-text-muted)">Loading...</p>}
        {error && <p className="p-4 text-sm text-red-500">{error}</p>}
        {!loading && !error && products.length === 0 && (
          <p className="p-4 text-sm text-(--ui-text-muted)">No products require reordering.</p>
        )}
        {!loading && !error && products.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-xs font-semibold uppercase text-(--ui-text-muted)">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3 text-right">Current Stock</th>
                  <th className="px-4 py-3 text-right">Days Remaining</th>
                  <th className="px-4 py-3 text-right">Suggested Reorder Qty</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <tr
                    key={row.product_id}
                    className={`border-b border-(--ui-border) last:border-0 ${rowClass(row.days_of_stock_remaining)}`}
                  >
                    <td className="px-4 py-3 font-medium text-(--ui-text)">{row.name}</td>
                    <td className="px-4 py-3 text-(--ui-text-muted)">{row.sku || "—"}</td>
                    <td className="px-4 py-3 text-right">{row.current_stock ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      {row.days_of_stock_remaining != null
                        ? row.days_of_stock_remaining
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">{row.suggested_reorder_qty ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() =>
                          navigate("/purchase-orders", {
                            state: {
                              prefill_product_id: row.product_id,
                              prefill_supplier_id: row.supplier_id,
                            },
                          })
                        }
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Create PO
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}
