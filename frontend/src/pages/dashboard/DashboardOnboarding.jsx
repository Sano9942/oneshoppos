import { useState, useEffect } from "react";
import { CheckCircle2, Circle, X, PartyPopper } from "lucide-react";
import { SectionCard } from "../../ui/primitives";

const STORAGE_KEY = "onboarding_dismissed";

function buildSteps(data, onNavigate) {
  const hasShiftOpen = Array.isArray(data?.operationalReadiness)
    && data.operationalReadiness.some((o) => o.shift_open);

  return [
    {
      id: "store",
      label: "Set up your store",
      done: !!data,
      navigate: () => onNavigate("/company-settings"),
    },
    {
      id: "product",
      label: "Add your first product",
      done: (data?.inventory?.total_products ?? 0) > 0,
      navigate: () => onNavigate("/products/new"),
    },
    {
      id: "employees",
      label: "Add employees",
      done: (data?.attendanceSummary?.total_employees ?? 0) > 1,
      navigate: () => onNavigate("/employees"),
    },
    {
      id: "shift",
      label: "Open a shift",
      done: hasShiftOpen,
      navigate: () => window.open("/pos", "_blank"),
    },
    {
      id: "sale",
      label: "Make your first sale",
      done: (data?.saleCount ?? 0) > 0 || (data?.totalRevenueToday ?? 0) > 0,
      navigate: () => window.open("/pos", "_blank"),
    },
  ];
}

export function DashboardOnboarding({ data, onNavigate }) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "1"
  );
  const [autoDismissed, setAutoDismissed] = useState(false);

  const steps = buildSteps(data, onNavigate);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  // Auto-dismiss after 3 seconds when all steps complete
  useEffect(() => {
    if (!allDone || autoDismissed) return;
    const timer = setTimeout(() => {
      setAutoDismissed(true);
      localStorage.setItem(STORAGE_KEY, "1");
    }, 3000);
    return () => clearTimeout(timer);
  }, [allDone, autoDismissed]);

  if (dismissed || autoDismissed) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  };

  return (
    <SectionCard className="mb-4">
      <div className="p-4">
        {/* Header row */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-(--ui-text)">
              {allDone ? (
                <span className="flex items-center gap-1.5 text-emerald-600">
                  <PartyPopper size={16} />
                  You&apos;re all set! Great work.
                </span>
              ) : (
                "Get started with SanoPOS"
              )}
            </p>
            {!allDone && (
              <p className="mt-0.5 text-xs text-(--ui-text-muted)">
                {doneCount} of {steps.length} steps complete
              </p>
            )}
          </div>
          <button
            onClick={dismiss}
            className="shrink-0 rounded p-0.5 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text) transition-colors"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>

        {/* Progress bar */}
        {!allDone && (
          <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-(--ui-muted-surface)">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
        )}

        {/* Steps list */}
        <ul className="space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center gap-3">
              {step.done ? (
                <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
              ) : (
                <Circle size={18} className="shrink-0 text-(--ui-text-muted)" />
              )}
              <span
                className={`flex-1 text-sm ${
                  step.done
                    ? "text-(--ui-text-muted) line-through"
                    : "text-(--ui-text)"
                }`}
              >
                {step.label}
              </span>
              {!step.done && (
                <button
                  onClick={step.navigate}
                  className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  Go →
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}
