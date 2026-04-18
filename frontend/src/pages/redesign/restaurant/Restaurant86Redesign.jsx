import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Ban, RotateCcw } from "lucide-react";
import { PageShell, SectionCard, Button } from "../../../ui/primitives";
import { useAuth } from "../../../auth/AuthProvider";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { useToast } from "../../../contexts/ToastContext";
import { api } from "../../../api";
import { fmtUtcDateTime } from "../../../utils/dates";

// Phase 2-R.1 — Admin view of currently 86'd items.
// Flag-gated by phase4_restaurant_86. Reading is product-scoped only;
// variant-level reinstatement will be added alongside 2-R.2 reason codes.

export default function Restaurant86Redesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { success, error } = useToast();
  const [rows, setRows] = useState({ products: [], variants: [] });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/restaurant/sold-out");
      setRows({ products: data.products || [], variants: data.variants || [] });
    } catch (e) {
      error(e?.message || "Failed to load 86'd items");
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => { load(); }, [load]);

  if (flagsLoading) return null;
  if (!flags.phase4_restaurant_86) return <Navigate to="/" replace />;
  if (!hasPerm("manage_restaurant")) return <Navigate to="/" replace />;

  const un86 = async (id, name) => {
    setBusyId(id);
    try {
      await api.del(`/api/restaurant/products/${id}/sold-out`);
      success(`${name} is back on the menu`);
      await load();
    } catch (e) {
      error(e?.message || "Failed to clear sold-out");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageShell
      title="86'd Items"
      subtitle="Products currently marked sold-out on the restaurant menu"
    >
      <SectionCard>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm text-(--ui-text-muted)">
            <Ban size={16} />
            <span>{rows.products.length} product{rows.products.length === 1 ? "" : "s"} offline</span>
          </div>
          <Button tone="default" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-(--ui-text-muted)">Loading…</div>
        ) : rows.products.length === 0 ? (
          <div className="text-sm text-(--ui-text-muted) italic">
            Nothing is 86'd right now. Mark an item sold-out from the POS overflow menu.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-(--ui-border)">
                  <th className="py-2 pr-4 font-semibold">Product</th>
                  <th className="py-2 pr-4 font-semibold">Reason</th>
                  <th className="py-2 pr-4 font-semibold">Since</th>
                  <th className="py-2 pr-4 font-semibold">Auto-clear</th>
                  <th className="py-2 pr-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.products.map((p) => (
                  <tr key={p.id} className="border-b border-(--ui-border)">
                    <td className="py-2 pr-4 font-medium">{p.name}</td>
                    <td className="py-2 pr-4 text-(--ui-text-muted)">{p.sold_out_reason || "—"}</td>
                    <td className="py-2 pr-4 text-(--ui-text-muted)">{fmtUtcDateTime(p.sold_out_since)}</td>
                    <td className="py-2 pr-4 text-(--ui-text-muted)">{p.sold_out_until ? fmtUtcDateTime(p.sold_out_until) : "—"}</td>
                    <td className="py-2 pr-4 text-right">
                      <Button
                        tone="default"
                        onClick={() => un86(p.id, p.name)}
                        disabled={busyId === p.id}
                      >
                        <RotateCcw size={14} className="mr-1" />
                        {busyId === p.id ? "Clearing…" : "Un-86"}
                      </Button>
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
