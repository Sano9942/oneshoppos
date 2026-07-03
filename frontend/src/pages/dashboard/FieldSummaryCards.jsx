import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Users, AlertCircle, MapPin, ChevronRight } from "lucide-react";
import { SectionCard } from "../../ui/primitives";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";

function relativeTime(isoString) {
  if (!isoString) return "never";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  return `${Math.floor(diffMin / 1440)}d ago`;
}

/**
 * Tier 1.1 wholesale: per-rep summary cards rendered on the owner's dashboard.
 * Renders nothing when the wholesale_field_sales flag is off OR when there are
 * no field-rep employees on the tenant — keeps the dashboard clean for non-
 * wholesale tenants.
 */
export function FieldSummaryCards() {
  const { authHeaders, hasPerm } = useAuth();
  const authHeadersMemo = useMemo(() => authHeaders, [authHeaders]);
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeadersMemo);

  const [reps, setReps] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (flagsLoading || !flags.wholesale_field_sales) return;
    if (!hasPerm("manage_field_sales")) return;
    api
      .get("/api/field/summary")
      .then((d) => {
        setReps(d.reps || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [flagsLoading, flags.wholesale_field_sales, hasPerm]);

  if (flagsLoading || !flags.wholesale_field_sales) return null;
  if (!hasPerm("manage_field_sales")) return null;
  if (!loaded) return null;
  if (reps.length === 0) return null;

  return (
    <SectionCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-(--ui-primary)" />
          <div className="font-semibold text-(--ui-text)">Field Sales Today</div>
        </div>
        <Link
          to="/field/visits"
          className="text-xs text-(--ui-primary) hover:underline inline-flex items-center gap-0.5"
        >
          View all visits <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {reps.map((r) => {
          const pct =
            r.planned_count > 0 ? Math.min(100, Math.round((r.checked_in_count / r.planned_count) * 100)) : 0;
          const noVisitsYet = r.checked_in_count === 0;
          return (
            <div
              key={r.employee_id}
              className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-(--ui-text) truncate">{r.employee_name}</div>
                  <div className="text-xs text-(--ui-text-muted) inline-flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" /> Last seen {relativeTime(r.last_seen_at)}
                  </div>
                </div>
                {r.flagged_count > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-(--ui-warning-bg) px-1.5 py-0.5 text-xs text-(--ui-warning-fg)">
                    <AlertCircle className="h-3 w-3" /> {r.flagged_count}
                  </span>
                )}
              </div>

              <div className="mt-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold text-(--ui-text)">
                    {r.checked_in_count} / {r.planned_count}
                  </span>
                  <span className="text-xs text-(--ui-text-muted)">visited</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-(--ui-muted-surface) overflow-hidden">
                  <div
                    className="h-full bg-(--ui-primary) transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                <div>
                  <div className="font-semibold text-(--ui-success-fg)">{r.ordered_count}</div>
                  <div className="text-(--ui-text-muted)">orders</div>
                </div>
                <div>
                  <div className="font-semibold text-(--ui-text)">{r.no_stock_count}</div>
                  <div className="text-(--ui-text-muted)">no stock</div>
                </div>
                <div>
                  <div className="font-semibold text-(--ui-text)">{r.closed_count}</div>
                  <div className="text-(--ui-text-muted)">closed</div>
                </div>
                <div>
                  <div className="font-semibold text-(--ui-text)">{r.away_count}</div>
                  <div className="text-(--ui-text-muted)">away</div>
                </div>
              </div>

              {noVisitsYet && r.planned_count > 0 && (
                <div className="mt-2 text-xs text-(--ui-text-muted) italic">
                  Hasn't started yet
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

export default FieldSummaryCards;
