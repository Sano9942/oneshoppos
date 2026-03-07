import { SectionCard } from "../../ui/primitives";
import { Badge } from "../../ui/primitives";

const STATUS_TONE = {
  clocked_in: "success",
  on_break: "warning",
  clocked_out: "default",
  not_started: "default",
};
const STATUS_LABEL = {
  clocked_in: "In",
  on_break: "Break",
  clocked_out: "Out",
  not_started: "—",
};

export function DashboardAttendance({ data, isCashier, currentEmployeeId }) {
  const summary = data?.attendanceSummary || {};
  const details = summary.details || [];

  const visible = isCashier
    ? details.filter((e) => e.id === currentEmployeeId)
    : details;

  if (!visible.length) return null;

  return (
    <SectionCard className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-(--ui-text)">Staff Today</h3>
        {!isCashier && (
          <span className="text-xs text-(--ui-text-muted)">
            {summary.clocked_in} in · {summary.on_break} break · {summary.clocked_out} out
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((emp) => (
          <div
            key={emp.id}
            className="flex flex-col gap-1 rounded-lg border border-(--ui-border) bg-(--ui-surface) p-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-(--ui-text) truncate">{emp.name}</span>
              <Badge tone={STATUS_TONE[emp.status]}>{STATUS_LABEL[emp.status]}</Badge>
            </div>
            {emp.net_work_hours > 0 && (
              <span className="text-xs text-(--ui-text-muted)">
                {emp.net_work_hours.toFixed(1)}h worked
              </span>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
