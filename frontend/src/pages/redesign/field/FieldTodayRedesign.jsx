import { useState, useEffect, useMemo } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { MapPin, CheckCircle2, AlertCircle, Phone, LogOut } from "lucide-react";
import { api } from "../../../api";
import { useAuth } from "../../../auth/AuthProvider";
import { useToast } from "../../../contexts/ToastContext";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { getCheckInsQueue } from "../../../utils/offlineQueue";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const OUTCOME_LABELS = {
  ordered: { label: "Took Order", tone: "good" },
  no_stock_needed: { label: "No Stock Needed", tone: "neutral" },
  shop_closed: { label: "Shop Closed", tone: "warn" },
  owner_away: { label: "Owner Away", tone: "warn" },
  checked_in: { label: "Checked in", tone: "neutral" },
};

/**
 * Tier 1.1 wholesale: field rep's daily home screen. Mobile-first list of
 * today's planned customers. Tapping a card opens the check-in flow.
 *
 * Auth: requires manage_field_sales permission. Field Rep role gets this by
 * default; Manager + Administrator also see it for testing.
 */
export default function FieldTodayRedesign() {
  const navigate = useNavigate();
  const { employee, authHeaders, logout, hasPerm } = useAuth();
  const { success: toastOk, error: toastErr } = useToast();
  const authHeadersMemo = useMemo(() => authHeaders, [authHeaders]);
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeadersMemo);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [route, setRoute] = useState({ customers: [], day_of_week: 0, geofence_meters: 500 });
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  useEffect(() => {
    if (flagsLoading) return;
    if (!flags.wholesale_field_sales) return;
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const data = await api.get("/api/field/route/today");
        if (!cancelled) {
          setRoute(data);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load route");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [flagsLoading, flags.wholesale_field_sales]);

  // Surface offline queue size so the rep knows if anything is pending sync.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (!employee?.id) return;
      try {
        const queued = await getCheckInsQueue(employee.id);
        if (!cancelled) setPendingSyncCount(queued.length);
      } catch {
        /* ignore */
      }
    }
    refresh();
    const id = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [employee?.id]);

  if (flagsLoading || loading) {
    return (
      <div className="min-h-screen bg-(--ui-bg) p-4">
        <div className="animate-pulse h-32 bg-(--ui-muted-surface) rounded-xl" />
      </div>
    );
  }
  if (!flags.wholesale_field_sales) return <Navigate to="/" replace />;
  if (!hasPerm("manage_field_sales")) return <Navigate to="/" replace />;

  const dayName = DAY_NAMES[route.day_of_week] || "Today";
  const total = route.customers.length;
  const checkedInCount = route.customers.filter((c) => c.checked_in_at).length;

  return (
    <div className="min-h-screen bg-(--ui-bg) pb-12">
      <header className="sticky top-0 z-10 bg-(--ui-surface) border-b border-(--ui-border) px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-(--ui-text-muted)">
            {dayName}'s route
          </div>
          <div className="text-lg font-semibold text-(--ui-text)">
            {employee?.name || "Field Rep"}
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="text-(--ui-text-muted) hover:text-(--ui-text) p-2"
          title="Log out"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      <div className="px-4 pt-4">
        <div className="flex items-center gap-3 text-sm">
          <div className="rounded-full bg-(--ui-muted-surface) px-3 py-1 font-medium text-(--ui-text)">
            {checkedInCount} / {total} visited
          </div>
          {pendingSyncCount > 0 && (
            <div className="rounded-full bg-amber-100 text-amber-900 px-3 py-1 text-xs font-medium">
              {pendingSyncCount} pending sync
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="px-4 mt-4 space-y-3">
        {route.customers.length === 0 && (
          <div className="rounded-xl border border-dashed border-(--ui-border) p-6 text-center text-(--ui-text-muted)">
            No customers planned for {dayName}.
            <div className="text-xs mt-1">Ask your manager to set up your route.</div>
          </div>
        )}

        {route.customers.map((c) => {
          const visited = !!c.checked_in_at;
          const outcome = c.visit_status && OUTCOME_LABELS[c.visit_status];
          const flagged = c.visit_flagged;
          return (
            <button
              key={c.customer_id}
              type="button"
              onClick={() => navigate(`/field/check-in/${c.customer_id}`)}
              className="w-full text-left rounded-xl border border-(--ui-border) bg-(--ui-surface) p-4 flex items-start gap-3 hover:border-(--ui-primary) transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-(--ui-muted-surface) text-(--ui-text-muted) text-xs font-medium">
                    {c.visit_order}
                  </span>
                  <span className="font-semibold text-(--ui-text) truncate">{c.name}</span>
                </div>
                {c.address && (
                  <div className="flex items-start gap-1 text-xs text-(--ui-text-muted) mb-1">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{c.address}</span>
                  </div>
                )}
                {c.mobile && (
                  <div className="flex items-center gap-1 text-xs text-(--ui-text-muted)">
                    <Phone className="h-3.5 w-3.5" />
                    <span>{c.mobile}</span>
                  </div>
                )}
                {visited && outcome && (
                  <div className="mt-2 inline-flex items-center gap-1 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-(--ui-text)">{outcome.label}</span>
                    {flagged && (
                      <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-xs">
                        <AlertCircle className="h-3 w-3" /> GPS flagged
                      </span>
                    )}
                  </div>
                )}
                {c.lat == null && (
                  <div className="mt-1 text-xs text-(--ui-text-muted)">
                    Shop not geo-tagged yet — your first check-in will record its location.
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
