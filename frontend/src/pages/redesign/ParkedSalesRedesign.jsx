import { useEffect, useState } from "react";
import { Download, PauseCircle, RefreshCw, Trash2, UserCheck } from "lucide-react";
import { api } from "../../api";
import { fmtLocalDateTime } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import {
  Badge,
  Button,
  EmptyState,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";
import { downloadCsv } from "../../utils/csvExport";

export default function ParkedSalesRedesign() {
  const { fmt } = useCurrency();
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  const useDrafts = !!flags.phase2_draft_orders;

  const [rows, setRows] = useState([]);
  const [draftRows, setDraftRows] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [outletFilter, setOutletFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/api/parked-sales");
      setRows(data.parkedSales || data.parked_sales || []);
      // Also fetch draft orders if enabled
      if (useDrafts) {
        try {
          const drafts = await api.get("/api/draft-orders?status=open,claimed");
          setDraftRows(drafts.draftOrders || []);
        } catch { setDraftRows([]); }
      }
    } catch (e) {
      setError(e.message || "Failed to load parked sales");
    } finally {
      setLoading(false);
    }
  };

  const loadOutlets = async () => {
    try {
      const data = await api.get("/api/outlets");
      setOutlets(data.outlets || []);
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    load();
    loadOutlets();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id) => {
    setBusy(true);
    setError("");
    try {
      await api.del(`/api/parked-sales/${id}`);
      setConfirmId(null);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e.message || "Failed to delete parked sale");
    } finally {
      setBusy(false);
    }
  };

  const filtered = outletFilter
    ? rows.filter((r) => String(r.outlet_id) === outletFilter)
    : rows;

  return (
    <PageShell
      title="Parked Sales"
      subtitle="View and manage sales parked mid-transaction."
      right={
        <div className="flex gap-2">
          <Button onClick={() => downloadCsv(["id","customer","items","total","parked_at","outlet"], filtered.map(r => [r.id, r.customer_name||"Walk-in", r.items?.length||0, r.total||0, r.parked_at||r.created_at||"", r.outlet_name||""]), "parked_sales")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Select
            value={outletFilter}
            onChange={(e) => setOutletFilter(e.target.value)}
          >
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={String(o.id)}>
                {o.name}
              </option>
            ))}
          </Select>
          <Button onClick={load}>
            <RefreshCw size={14} className="mr-1 inline" />
            Refresh
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <SectionCard>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Items</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-left">Parked At</th>
                <th className="px-3 py-2 text-left">Outlet</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                filtered.map((r) => (
                  <tr key={r.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 text-(--ui-text)">
                      {r.customer_name || r.customer_id ? (
                        <div>
                          <p className="font-medium">{r.customer_name || "Customer"}</p>
                          {r.customer_id && (
                            <p className="text-xs text-(--ui-text-muted)">#{r.customer_id}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-(--ui-text-muted)">Walk-in</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {(() => {
                        try {
                          const items =
                            typeof r.items === "string" ? JSON.parse(r.items) : r.items || [];
                          return items.length
                            ? `${items.length} item${items.length !== 1 ? "s" : ""}`
                            : "-";
                        } catch {
                          return "-";
                        }
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-(--ui-text)">
                      {fmt(r.total)}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {r.parked_at || r.created_at
                        ? fmtLocalDateTime(r.parked_at || r.created_at)
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {r.outlet_name ||
                        outlets.find((o) => o.id === r.outlet_id)?.name ||
                        r.outlet_id ||
                        "-"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {confirmId === r.id ? (
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            tone="danger"
                            disabled={busy}
                            onClick={() => handleDelete(r.id)}
                          >
                            Confirm
                          </Button>
                          <Button size="sm" onClick={() => setConfirmId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          tone="danger"
                          onClick={() => setConfirmId(r.id)}
                        >
                          <Trash2 size={13} className="mr-1 inline" />
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {loading && (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">
              Loading parked sales...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <EmptyState
              icon={PauseCircle}
              title="No parked sales"
              body={
                outletFilter
                  ? "No parked sales for the selected outlet."
                  : "No sales are currently parked."
              }
            />
          )}
        </div>
      </SectionCard>
    </PageShell>
  );
}
