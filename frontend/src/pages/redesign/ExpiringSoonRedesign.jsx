import { useEffect, useMemo, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, EmptyState, ConfirmDialog } from "../../ui/primitives";
import { fmtUtcDate } from "../../utils/dates";

function urgencyTone(days) {
  if (days == null) return "default";
  if (days < 0) return "danger";     // already expired
  if (days <= 3) return "danger";
  if (days <= 14) return "warning";
  return "default";
}

function daysLabel(days) {
  if (days == null) return "—";
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  return `${days}d`;
}

export default function ExpiringSoonRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();
  const navigate = useNavigate();

  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [windowDays, setWindowDays] = useState(30);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useMemo(
    () => (days) => {
      setLoading(true);
      api.get("/api/batches/expiring", { days })
        .then((data) => setBatches(data.batches || []))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    },
    []
  );

  useEffect(() => {
    if (flagsLoading || !flags.batch_expiry_tracking) return;
    load(windowDays);
  }, [flagsLoading, flags.batch_expiry_tracking, windowDays, load]);

  if (flagsLoading) return null;
  if (!flags.batch_expiry_tracking) return <Navigate to="/" replace />;

  async function handleWriteOff() {
    if (!confirmTarget) return;
    setBusy(true);
    try {
      await api.post(`/api/batches/${confirmTarget.id}/write-off`, { reason: "expired stock" });
      toast.success(`Wrote off ${confirmTarget.remaining_qty} of ${confirmTarget.product_name} (${confirmTarget.batch_number})`);
      setConfirmTarget(null);
      load(windowDays);
    } catch (err) {
      toast.error(err.message || "Write-off failed");
    } finally {
      setBusy(false);
    }
  }

  const expiredCount = batches.filter((b) => b.expired).length;

  return (
    <PageShell
      title="Expiring Soon"
      subtitle="Batches sorted by expiry (soonest first). Mark down or write off stale stock."
      right={
        <select
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value))}
          className="rounded-lg border border-(--ui-border) bg-white px-3 py-1.5 text-sm"
        >
          <option value={7}>Next 7 days</option>
          <option value={14}>Next 14 days</option>
          <option value={30}>Next 30 days</option>
          <option value={60}>Next 60 days</option>
        </select>
      }
    >
      <SectionCard>
        {loading && <p className="p-4 text-sm text-(--ui-text-muted)">Loading...</p>}
        {error && <p className="p-4 text-sm text-(--ui-danger-fg)">{error}</p>}
        {!loading && !error && batches.length === 0 && (
          <EmptyState title="Nothing expiring" body={`No tracked batches expire within the next ${windowDays} days.`} />
        )}
        {!loading && !error && batches.length > 0 && (
          <>
            {expiredCount > 0 && (
              <div className="border-b border-(--ui-border) bg-(--ui-danger-bg) px-4 py-2 text-sm text-(--ui-danger-fg)">
                {expiredCount} batch(es) have already expired — write them off to keep stock accurate.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) text-left text-xs font-semibold uppercase text-(--ui-text-muted)">
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Batch / Lot</th>
                    <th className="px-4 py-3">Outlet</th>
                    <th className="px-4 py-3">Expiry</th>
                    <th className="px-4 py-3 text-right">Remaining</th>
                    <th className="px-4 py-3 text-right">Value</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-b border-(--ui-border) last:border-0">
                      <td className="px-4 py-3 font-medium text-(--ui-text)">{b.product_name}</td>
                      <td className="px-4 py-3 text-(--ui-text-muted)">
                        {b.batch_number}
                        {b.lot_type === "roll" && <span className="ml-1 text-xs">(roll)</span>}
                      </td>
                      <td className="px-4 py-3 text-(--ui-text-muted)">{b.outlet_name || "—"}</td>
                      <td className="px-4 py-3">
                        <span className="mr-2">{b.expiry_date ? fmtUtcDate(b.expiry_date) : "—"}</span>
                        <Badge tone={urgencyTone(b.days_to_expiry)}>{daysLabel(b.days_to_expiry)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">{b.remaining_qty}</td>
                      <td className="px-4 py-3 text-right">
                        {b.unit_cost != null ? fmt(b.remaining_qty * b.unit_cost) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            tone="plain"
                            size="sm"
                            onClick={() =>
                              navigate("/scheduled-changes", {
                                state: { prefill_product_id: b.product_id },
                              })
                            }
                          >
                            Mark down
                          </Button>
                          <Button tone="danger" size="sm" onClick={() => setConfirmTarget(b)}>
                            Write off
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={!!confirmTarget}
        title="Write off batch?"
        body={
          confirmTarget
            ? `Write off ${confirmTarget.remaining_qty} unit(s) of ${confirmTarget.product_name} (batch ${confirmTarget.batch_number}). This removes the stock and logs an adjustment.`
            : ""
        }
        confirmLabel="Write off"
        destructive
        busy={busy}
        onConfirm={handleWriteOff}
        onCancel={() => setConfirmTarget(null)}
      />
    </PageShell>
  );
}
