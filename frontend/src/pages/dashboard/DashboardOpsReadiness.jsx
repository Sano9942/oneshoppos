import { useNavigate } from "react-router-dom";
import { SectionCard } from "../../ui/primitives";
import { RelativeTime } from "./DashboardShared";

function OutletCard({ outlet, compact = false }) {
  const navigate = useNavigate();
  const isReady = outlet.shift_open;
  return (
    <div className="rounded-(--ui-radius-sm) border border-(--ui-border) bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-(--ui-text)">{outlet.outlet_name}</p>
          {outlet.shift_open ? (
            <p className="text-xs text-(--ui-text-muted)">
              Shift: {outlet.shift_employee || "—"} · {outlet.staff_clocked_in} clocked in
              {outlet.staff_on_break > 0 ? `, ${outlet.staff_on_break} on break` : ""}
            </p>
          ) : (
            <p className="text-xs text-(--ui-warning-fg)">No open shift</p>
          )}
        </div>
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${isReady ? "bg-(--ui-success-fg)" : "bg-(--ui-warning-fg)"}`} />
      </div>
      {!compact && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-(--ui-text-muted)">
            Last sale: <RelativeTime ts={outlet.last_sale_at} />
          </span>
          {!outlet.shift_open && (
            <button
              onClick={() => navigate("/cash-management")}
              className="cursor-pointer text-xs font-semibold text-(--ui-warning-fg) underline underline-offset-2"
            >
              Open shift →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DashboardOpsReadiness({ data, isSingleBranch }) {
  const navigate = useNavigate();
  const outlets = data?.operationalReadiness || [];

  if (isSingleBranch) {
    const outlet = outlets[0];
    if (!outlet) return null;
    const isReady = outlet.shift_open;
    return (
      <SectionCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                isReady
                  ? "bg-(--ui-success-bg) text-(--ui-success-fg)"
                  : "bg-(--ui-warning-bg) text-(--ui-warning-fg)"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isReady ? "bg-(--ui-success-fg)" : "bg-(--ui-warning-fg)"}`} />
              {isReady ? "Ready to sell" : "Shift required"}
            </span>
            <div>
              {isReady ? (
                <p className="text-xs text-(--ui-text-muted)">
                  {outlet.shift_employee && `Shift opened by ${outlet.shift_employee} · `}
                  {outlet.staff_clocked_in} clocked in
                  {outlet.staff_on_break > 0 ? `, ${outlet.staff_on_break} on break` : ""}
                  {" · "}Last sale: <RelativeTime ts={outlet.last_sale_at} />
                </p>
              ) : (
                <p className="text-xs text-(--ui-text-muted)">Checkout is blocked until a shift is opened</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {!isReady && (
              <button
                onClick={() => navigate("/cash-management")}
                className="cursor-pointer rounded-full bg-(--ui-primary) px-3.5 py-1.5 text-xs font-semibold text-(--ui-on-primary) hover:bg-(--ui-primary-strong)"
              >
                Open Shift
              </button>
            )}
            <button
              onClick={() => navigate("/attendance")}
              className="cursor-pointer rounded-full bg-(--ui-muted-surface) px-3.5 py-1.5 text-xs font-semibold text-(--ui-text) hover:bg-(--ui-border-strong)"
            >
              Attendance
            </button>
          </div>
        </div>
      </SectionCard>
    );
  }

  // All-branches: grid of outlet cards
  const hasProblems = outlets.some((o) => !o.shift_open);
  return (
    <SectionCard className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-(--ui-text)">Outlet Status</h3>
        {hasProblems && (
          <span className="rounded-full bg-(--ui-warning-bg) px-2 py-0.5 text-xs font-semibold text-(--ui-warning-fg)">
            Attention needed
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {outlets.map((outlet) => (
          <OutletCard key={outlet.outlet_id} outlet={outlet} />
        ))}
        {outlets.length === 0 && (
          <p className="text-sm text-(--ui-text-muted)">No outlet data available.</p>
        )}
      </div>
    </SectionCard>
  );
}
