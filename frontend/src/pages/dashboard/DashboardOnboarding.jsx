import { useState, useEffect } from "react";
import { CheckCircle2, Circle, X, PartyPopper } from "lucide-react";
import { SectionCard } from "../../ui/primitives";
import { api } from "../../api";
import { usePreset } from "../../contexts/PresetContext";

const STORAGE_KEY = "onboarding_dismissed";

// PLAN-V2 Step 11 (D6): the vertical setup steps below now read their done-ness
// from the authoritative Business Modules setup checklist (GET
// /api/business-modules → card.checklist), not from dashboard-data proxies.
// This REPLACES the old proxy heuristics — the room-count "rate" proxy, the
// any-contract-row rental "checkout" proxy, and the hardcoded `membership:false`
// (the latter two step definitions are deleted outright). Two parallel
// "is it set up" computations must not coexist (AUDIT §3).
const CHECKLIST_STEP_SOURCE = {
  floor_plan:  { module: "restaurant",    item: "floor_plan" },
  menu_item:   { module: "restaurant",    item: "menu_items" },
  room:        { module: "rooms_lodging", item: "rooms" },
  rate:        { module: "rooms_lodging", item: "rates" },
  rental_item: { module: "rentals",       item: "rental_items" },
};

function buildSteps(data, onNavigate, presetSteps, labelFn, checklistDone) {
  const hasShiftOpen = Array.isArray(data?.operationalReadiness)
    && data.operationalReadiness.some((o) => o.shift_open);
  const hasSales = (data?.lifetimeSaleCount ?? 0) > 0
    || (data?.saleCount ?? 0) > 0
    || (data?.totalRevenueToday ?? 0) > 0;
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
      // done sourced from the Business Modules checklist (restaurant.menu_items)
      done: false,
      navigate: () => onNavigate("/products/new"),
    },
    service: {
      id: "service",
      label: `Add your first ${labelFn("product").toLowerCase()}`,
      done: hasProducts,
      navigate: () => onNavigate("/products/new"),
    },
    customer: {
      id: "customer",
      label: `Add your first ${labelFn("customer").toLowerCase()}`,
      done: (data?.customerCount ?? 0) > 0,
      navigate: () => onNavigate("/customers"),
    },
    employees: {
      id: "employees",
      label: "Add employees",
      done: (data?.attendanceSummary?.total_employees ?? 0) > 1,
      navigate: () => onNavigate("/employees"),
    },
    receipt: {
      id: "receipt",
      label: "Print a test receipt",
      done: data?.testReceiptPrinted === true,
      navigate: () => onNavigate("/printer-settings"),
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
      // done sourced from the Business Modules checklist (restaurant.floor_plan)
      done: false,
      navigate: () => onNavigate("/restaurant/floor"),
    },
    calendar: {
      id: "calendar",
      label: "Set up your calendar",
      // No dedicated count yet — treat as done when tenant has any bookings
      done: (data?.bookingCount ?? 0) > 0,
      navigate: () => onNavigate("/appointments/calendar"),
    },
    booking: {
      id: "booking",
      label: "Create your first booking",
      done: (data?.bookingCount ?? 0) > 0,
      navigate: () => onNavigate("/appointments/bookings"),
    },
    ticket: {
      id: "ticket",
      label: "Create your first job ticket",
      done: (data?.ticketCount ?? 0) > 0,
      navigate: () => onNavigate("/service-tickets"),
    },
    // `membership` step removed (D6): it was a hardcoded `done:false` proxy that
    // could never complete. Memberships get a real checklist in v3 (E5).
    rental_item: {
      id: "rental_item",
      label: `Add your first ${labelFn("product").toLowerCase()}`,
      // done sourced from the Business Modules checklist (rentals.rental_items)
      done: false,
      navigate: () => onNavigate("/rentals/items"),
    },
    contract: {
      id: "contract",
      label: "Create your first rental contract",
      done: (data?.contractCount ?? 0) > 0,
      navigate: () => onNavigate("/rentals/contracts"),
    },
    // `checkout` step removed (D6): it was an "any contract row" proxy that
    // completed in lockstep with `contract`, so it was never independently
    // meaningful. Rental onboarding ends at rental_item + contract.
    // M9 — Room management
    room: {
      id: "room",
      label: "Add rooms and room types",
      // done sourced from the Business Modules checklist (rooms_lodging.rooms)
      done: false,
      navigate: () => onNavigate("/rooms"),
    },
    rate: {
      id: "rate",
      label: "Set your nightly rates",
      // done sourced from the Business Modules checklist (rooms_lodging.rates)
      done: false,
      navigate: () => onNavigate("/rooms/rates"),
    },
    checkin: {
      id: "checkin",
      label: "Check in your first guest",
      done: (data?.bookingCount ?? 0) > 0,
      navigate: () => onNavigate("/rooms/bookings"),
    },
    // M10 — Clinical (dental / veterinary / physiotherapy)
    chart: {
      id: "chart",
      label: "Chart your first patient",
      done: (data?.chartEntryCount ?? 0) > 0,
      navigate: () => onNavigate("/treatment-plans"),
    },
    plan: {
      id: "plan",
      label: "Create your first treatment plan",
      done: (data?.treatmentPlanCount ?? 0) > 0,
      navigate: () => onNavigate("/treatment-plans"),
    },
  };

  return presetSteps
    .map((key) => ALL_STEPS[key])
    .filter(Boolean)
    .map((step) => {
      // Vertical setup steps read done-ness from the Business Modules checklist
      // (single source of truth) — never a dashboard-data proxy.
      const src = CHECKLIST_STEP_SOURCE[step.id];
      return src
        ? { ...step, done: checklistDone[`${src.module}:${src.item}`] === true }
        : step;
    });
}

export function DashboardOnboarding({ data, onNavigate }) {
  const { onboarding_steps, label: labelFn } = usePreset();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "1"
  );
  const [serverChecked, setServerChecked] = useState(false);
  const [autoDismissed, setAutoDismissed] = useState(false);
  // Authoritative done-ness for the vertical setup steps, keyed
  // `${moduleKey}:${itemId}`, from the Business Modules checklist payload (D6).
  // This card only renders for admins (all_access), who can load that endpoint.
  const [checklistDone, setChecklistDone] = useState(null);

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

  // Load the setup-checklist done-ness once (source of truth for vertical steps).
  useEffect(() => {
    if (dismissed) { setChecklistDone({}); return; }
    api.get("/api/business-modules")
      .then((res) => {
        const map = {};
        for (const mod of res?.modules || []) {
          for (const item of mod.checklist || []) {
            map[`${mod.key}:${item.id}`] = item.done === true;
          }
        }
        setChecklistDone(map);
      })
      .catch(() => setChecklistDone({}));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = buildSteps(data, onNavigate, onboarding_steps, labelFn, checklistDone || {});
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

  if (dismissed || autoDismissed || !serverChecked || checklistDone === null) return null;

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
                <span className="flex items-center gap-1.5 text-(--ui-success-fg)">
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
              className="h-full rounded-full bg-(--ui-primary) transition-all duration-500"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
        )}

        {/* Steps list */}
        <ul className="space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center gap-3">
              {step.done ? (
                <CheckCircle2 size={18} className="shrink-0 text-(--ui-success-fg)" />
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
                  className="shrink-0 cursor-pointer text-xs font-medium text-(--ui-link) transition-colors hover:underline"
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
