import { useNavigate } from "react-router-dom";
import { SectionCard } from "../../ui/primitives";
import { RelativeTime } from "./DashboardShared";

function OutletCard({ outlet, compact = false }) {
  const navigate = useNavigate();
  const isReady = outlet.shift_open;
  return (
    <div className={`rounded-lg border p-3 ${isReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-(--ui-text)">{outlet.outlet_name}</p>
          {outlet.shift_open ? (
            <p className="text-xs text-(--ui-text-muted)">
              Shift: {outlet.shift_employee || "—"} · {outlet.staff_clocked_in} clocked in
              {outlet.staff_on_break > 0 ? `, ${outlet.staff_on_break} on break` : ""}
            </p>
          ) : (
            <p className="text-xs text-amber-700">No open shift</p>
          )}
        </div>
        <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${isReady ? "bg-emerald-500" : "bg-amber-400"}`} />
      </div>
      {!compact && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-(--ui-text-muted)">
            Last sale: <RelativeTime ts={outlet.last_sale_at} />
          </span>
          {!outlet.shift_open && (
            <button
              onClick={() => navigate("/cash-management")}
              className="text-xs font-medium text-amber-700 underline underline-offset-2"
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
      <SectionCard className={`p-4 ${isReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${isReady ? "bg-emerald-500" : "bg-amber-400"}`} />
            <div>
              <p className={`text-sm font-bold ${isReady ? "text-emerald-700" : "text-amber-700"}`}>
                {isReady ? "READY TO SELL" : "SHIFT REQUIRED"}
              </p>
              {isReady ? (
                <p className="text-xs text-(--ui-text-muted)">
                  {outlet.shift_employee && `Shift opened by ${outlet.shift_employee} · `}
                  {outlet.staff_clocked_in} clocked in
                  {outlet.staff_on_break > 0 ? `, ${outlet.staff_on_break} on break` : ""}
                  {" · "}Last sale: <RelativeTime ts={outlet.last_sale_at} />
                </p>
              ) : (
                <p className="text-xs text-amber-700">Checkout is blocked until a shift is opened</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {!isReady && (
              <button
                onClick={() => navigate("/cash-management")}
                className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
              >
                Open Shift
              </button>
            )}
            <button
              onClick={() => navigate("/attendance")}
              className="rounded-md border border-(--ui-border) bg-white px-3 py-1.5 text-xs font-medium text-(--ui-text) hover:bg-(--ui-muted-surface)"
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
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
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
