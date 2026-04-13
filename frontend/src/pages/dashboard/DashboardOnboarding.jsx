import { useState, useEffect } from "react";
import { CheckCircle2, Circle, X, PartyPopper } from "lucide-react";
import { SectionCard } from "../../ui/primitives";
import { api } from "../../api";
import { usePreset } from "../../contexts/PresetContext";

const STORAGE_KEY = "onboarding_dismissed";

function buildSteps(data, onNavigate, presetSteps, labelFn) {
  const hasShiftOpen = Array.isArray(data?.operationalReadiness)
    && data.operationalReadiness.some((o) => o.shift_open);
  const hasSales = (data?.saleCount ?? 0) > 0 || (data?.totalRevenueToday ?? 0) > 0;
  const hasProducts = (data?.inventory?.total_products ?? 0) > 0;

  const ALL_STEPS = {
    store: {
      id: "store",
      label: "Set up your store",
      done: !!data,
      navigate: () => onNavigate("/company-settings"),
    },
    product: {
      id: "product",
      label: `Add your first ${labelFn("product").toLowerCase()}`,
      done: hasProducts,
      navigate: () => onNavigate("/products/new"),
    },
    menu_item: {
      id: "menu_item",
      label: `Add your first ${labelFn("product").toLowerCase()}`,
      done: hasProducts,
      navigate: () => onNavigate("/products/new"),
    },
    service: {
      id: "service",
      label: `Add your first ${labelFn("product").toLowerCase()}`,
      done: hasProducts,
      navigate: () => onNavigate("/products/new"),
    },
    employees: {
      id: "employees",
      label: "Add employees",
      done: (data?.attendanceSummary?.total_employees ?? 0) > 1,
      navigate: () => onNavigate("/employees"),
    },
    shift: {
      id: "shift",
      label: "Open a shift",
      done: hasShiftOpen,
      navigate: () => window.open("/pos", "_blank"),
    },
    sale: {
      id: "sale",
      label: `Make your first ${labelFn("sale").toLowerCase()}`,
      done: hasSales,
      navigate: () => window.open("/pos", "_blank"),
    },
    order: {
      id: "order",
      label: `Make your first ${labelFn("order").toLowerCase()}`,
      done: hasSales,
      navigate: () => window.open("/pos", "_blank"),
    },
    floor_plan: {
      id: "floor_plan",
      label: "Set up your floor plan",
      done: false,
      navigate: () => onNavigate("/restaurant/floor"),
    },
    calendar: {
      id: "calendar",
      label: "Set up your calendar",
      done: false,
      navigate: () => onNavigate("/appointments/calendar"),
    },
    booking: {
      id: "booking",
      label: "Create your first booking",
      done: false,
      navigate: () => onNavigate("/appointments/bookings"),
    },
    ticket: {
      id: "ticket",
      label: "Create your first job ticket",
      done: false,
      navigate: () => onNavigate("/service-tickets"),
    },
    membership: {
      id: "membership",
      label: "Set up your first membership plan",
      done: false,
      navigate: () => onNavigate("/subscriptions"),
    },
  };

  return presetSteps.map((key) => ALL_STEPS[key]).filter(Boolean);
}

export function DashboardOnboarding({ data, onNavigate }) {
  const { onboarding_steps, label: labelFn } = usePreset();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "1"
  );
  const [serverChecked, setServerChecked] = useState(false);
  const [autoDismissed, setAutoDismissed] = useState(false);

  // Check server-side dismissal status on mount
  useEffect(() => {
    if (dismissed) { setServerChecked(true); return; }
    api.get("/api/company-profile")
      .then((d) => {
        if (d.profile?.onboarding_dismissed) {
          localStorage.setItem(STORAGE_KEY, "1");
          setDismissed(true);
        }
        setServerChecked(true);
      })
      .catch(() => setServerChecked(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = buildSteps(data, onNavigate, onboarding_steps, labelFn);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  // Auto-dismiss after 3 seconds when all steps complete
  useEffect(() => {
    if (!allDone || autoDismissed) return;
    const timer = setTimeout(() => {
      setAutoDismissed(true);
      persistDismiss();
    }, 3000);
    return () => clearTimeout(timer);
  }, [allDone, autoDismissed]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    api.raw("/api/company-profile/onboarding-dismiss", {
      method: "PUT",
    }).catch(() => {});
  };

  if (dismissed || autoDismissed || !serverChecked) return null;

  const dismiss = () => {
    setDismissed(true);
    persistDismiss();
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
