// Pure display helpers for BusinessModulesRedesign's per-outlet UI (PLAN-V2
// Step 10). Extracted so the "enabled at N of M locations" logic is unit-
// testable without mounting the whole API-driven page (same pattern as
// pos/cartMath.js). No React, no imports.

// The backend adds outlets[]/outlet_count/enabled_outlet_count/
// default_outlet_enabled to a card only for scope:'outlet' cards on a
// tenant with >1 active outlet. A single-outlet tenant never receives these
// fields, so the location UI is invisible there by construction.
//
// We show the per-outlet controls only when the module is company-enabled
// ("On at 2 of 5 locations" is meaningless while the capability itself is
// off) and never on a platform-locked card (locked keeps its v1 treatment).
export function showOutletControls(m) {
  return (
    Array.isArray(m.outlets) &&
    !m.locked &&
    (m.state === "on" || m.state === "attention_required")
  );
}

// "On at 2 of 5 locations" — effective count (company AND per-outlet) over
// the active store-outlet count.
export function locationSummaryLabel(m) {
  const on = m.enabled_outlet_count ?? 0;
  const total = m.outlet_count ?? (m.outlets ? m.outlets.length : 0);
  return `On at ${on} of ${total} location${total === 1 ? "" : "s"}`;
}

// A per-outlet row is an "override" when it carries an explicit true/false;
// null means it inherits the card's default_outlet_enabled.
export function isOutletOverridden(outlet) {
  return outlet.override !== null && outlet.override !== undefined;
}

// ── Setup checklists (PLAN-V2 Step 11, D6) ──────────────────────────────────
// The backend attaches `checklist: [{ id, label, required, scope, route, done }]`
// only to ENABLED covered Bucket A cards. We surface a "Get started — N of M
// done" expander while any REQUIRED item is still un-done (that is exactly the
// attention_required state). Locked cards keep their v1 treatment.
export function showChecklist(m) {
  const items = m.checklist || [];
  if (!items.length || m.locked) return false;
  if (m.state !== "on" && m.state !== "attention_required") return false;
  return items.some((i) => i.required && !i.done);
}

// "N of M done" over ALL checklist items (required + optional).
export function checklistProgress(m) {
  const items = m.checklist || [];
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length };
}

