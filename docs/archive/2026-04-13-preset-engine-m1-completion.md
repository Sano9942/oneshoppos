# Preset Engine M1 Completion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the 4 remaining adaptation surfaces so the Tenant Preset Engine v1 is fully functional — labels, POS layout toggle, onboarding steps, and a settings page to change industry type.

**Architecture:** All 4 surfaces consume the existing `usePreset()` context (already populated from bootstrap). Labels replace hardcoded strings in 5 dashboard/page files. POS gets a grid/list view toggle defaulting from the preset. Onboarding reads `onboarding_steps` from preset config. Company settings gets an industry type dropdown that re-derives modes/flags on change.

**Tech Stack:** React 19 hooks (`usePreset`), existing `api.js` client, backend `PUT /api/company-profile` extension.

---

## Task 1: Wire Labels into Dashboard Widgets

**Files:**
- Modify: `frontend/src/pages/dashboard/DashboardTopProducts.jsx`
- Modify: `frontend/src/pages/dashboard/DashboardRecentSales.jsx`

### Step 1: DashboardTopProducts — replace hardcoded heading

In `DashboardTopProducts.jsx`, add the import and use `label()`:

```jsx
// Add import at top (after existing imports)
import { usePreset } from "../../contexts/PresetContext";

// Inside the component, before the return:
const { label } = usePreset();

// Line 15: Replace the hardcoded heading
// FROM: <h3 ...>Top Products Today</h3>
// TO:
<h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Top {label("products")} Today</h3>
```

### Step 2: DashboardRecentSales — replace hardcoded heading

In `DashboardRecentSales.jsx`, add the import and use `label()`:

```jsx
// Add import at top
import { usePreset } from "../../contexts/PresetContext";

// Inside the component, before the return:
const { label } = usePreset();

// Line 23: Replace heading
// FROM: <h3 ...>Recent Sales</h3>
// TO:
<h3 className="text-sm font-semibold text-(--ui-text)">Recent {label("sale")}s</h3>
```

### Step 3: Commit

```bash
git add frontend/src/pages/dashboard/DashboardTopProducts.jsx frontend/src/pages/dashboard/DashboardRecentSales.jsx
git commit -m "feat(preset-engine): wire preset labels into dashboard headings"
```

---

## Task 2: Wire Labels into Page Titles

**Files:**
- Modify: `frontend/src/pages/redesign/InventoryRedesign.jsx` (line ~420)
- Modify: `frontend/src/pages/redesign/CustomersRedesign.jsx` (line ~489)

### Step 1: InventoryRedesign — dynamic page title

```jsx
// Add import (near top with other imports)
import { usePreset } from "../../contexts/PresetContext";

// Inside the component function, early (before any return):
const { label } = usePreset();

// Line ~420: Replace PageShell title
// FROM: title="Products"
// TO:
title={label("products")}

// Line ~421: Replace subtitle
// FROM: subtitle="Manage products, pricing, stock levels, and variants."
// TO:
subtitle={`Manage ${label("products").toLowerCase()}, pricing, stock levels, and variants.`}
```

### Step 2: CustomersRedesign — dynamic page title

```jsx
// Add import
import { usePreset } from "../../contexts/PresetContext";

// Inside the component:
const { label } = usePreset();

// Line ~489: Replace PageShell title
// FROM: title="Customers"
// TO:
title={label("customers")}

// Line ~490: Replace subtitle
// FROM: subtitle="Manage customers, loyalty points, and wallet balances."
// TO:
subtitle={`Manage ${label("customers").toLowerCase()}, loyalty points, and wallet balances.`}
```

### Step 3: Commit

```bash
git add frontend/src/pages/redesign/InventoryRedesign.jsx frontend/src/pages/redesign/CustomersRedesign.jsx
git commit -m "feat(preset-engine): wire preset labels into Products and Customers page titles"
```

---

## Task 3: POS Search Results — Grid/List View Toggle

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSSearchArea.jsx`

The POS search results dropdown currently shows items in a compact card format. We'll add a grid/list toggle that defaults from the preset's `pos_layout_mode`. The toggle state lives in `localStorage` so it persists across sessions.

### Step 1: Add the toggle and list view to POSSearchArea

```jsx
// Add imports at top
import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { usePreset } from "../../../contexts/PresetContext";

// Inside the component, before return:
const { pos_layout_mode } = usePreset();
const [viewMode, setViewMode] = useState(
  () => localStorage.getItem("pos_view_mode") || pos_layout_mode || "grid"
);
const toggleView = () => {
  const next = viewMode === "grid" ? "list" : "grid";
  setViewMode(next);
  localStorage.setItem("pos_view_mode", next);
};
```

### Step 2: Add toggle button next to the unified search input

After the unified search `<input>` closing tag (line ~67), before the results dropdown, insert a toggle button row:

```jsx
{/* View toggle — between search and results */}
{showResults && results.length > 0 && (
  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-0.5 z-10">
    <button type="button" onClick={toggleView}
      className="p-1 rounded text-slate-400 hover:text-[#8066FF] transition"
      title={viewMode === "grid" ? "Switch to list" : "Switch to grid"}>
      {viewMode === "grid" ? <List size={14} /> : <LayoutGrid size={14} />}
    </button>
  </div>
)}
```

### Step 3: Render results in the chosen view mode

Replace the current results dropdown (lines 69-103) with view-mode-aware rendering:

```jsx
{showResults && results.length > 0 && (
  <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-100 rounded-xl shadow-xl max-h-64 overflow-y-auto">
    {viewMode === "list" ? (
      /* List view — compact single-line rows */
      results.map((p) => {
        const stock = Number(p.local_stock ?? p.stock ?? 0);
        return (
          <div key={p.id} onClick={() => addToCart(p)}
            className="flex items-center gap-3 px-3 py-1.5 hover:bg-[#8066FF]/5 cursor-pointer border-b border-slate-50 last:border-0 transition text-xs">
            <span className="flex-1 font-medium text-slate-800 truncate">{p.name}</span>
            <span className="text-slate-400 shrink-0">{p.barcode || p.sku || ""}</span>
            <span className="font-bold text-[#8066FF] shrink-0 w-16 text-right">{money(p.price)}</span>
            <span className={`shrink-0 w-12 text-right font-bold uppercase ${stock > 0 ? "text-emerald-500" : "text-red-400"}`}>
              {stock > 0 ? stock : "—"}
            </span>
          </div>
        );
      })
    ) : (
      /* Grid view — current card layout */
      results.map((p) => {
        const stock = Number(p.local_stock ?? p.stock ?? 0);
        return (
          <div key={p.id} onClick={() => addToCart(p)}
            className="flex justify-between items-center px-4 py-2.5 hover:bg-[#8066FF]/5 cursor-pointer border-b border-slate-50 last:border-0 transition">
            <div>
              <div className="font-bold text-slate-800 text-sm">{p.name}</div>
              <div className="text-[10px] text-slate-400">{p.barcode || p.sku || "—"}</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-[#8066FF] text-sm">{money(p.price)}</div>
              <div className={`text-[10px] font-bold uppercase ${stock > 0 ? "text-emerald-500" : "text-red-400"}`}>
                {stock > 0 ? `${stock} in stock` : "out of stock"}
              </div>
            </div>
          </div>
        );
      })
    )}
  </div>
)}
```

### Step 4: Commit

```bash
git add frontend/src/pages/redesign/pos/POSSearchArea.jsx
git commit -m "feat(preset-engine): POS grid/list view toggle, defaults from preset"
```

---

## Task 4: Onboarding Steps from Preset Config

**Files:**
- Modify: `frontend/src/pages/dashboard/DashboardOnboarding.jsx`

### Step 1: Add usePreset import and ALL_STEPS map

Replace the current `buildSteps` function (lines 8-43) with a preset-aware version:

```jsx
// Add import at top
import { usePreset } from "../../contexts/PresetContext";

// Replace buildSteps with this:
function buildSteps(data, onNavigate, presetSteps, labelFn) {
  const hasShiftOpen = Array.isArray(data?.operationalReadiness)
    && data.operationalReadiness.some((o) => o.shift_open);

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
      done: (data?.inventory?.total_products ?? 0) > 0,
      navigate: () => onNavigate("/products/new"),
    },
    menu_item: {
      id: "menu_item",
      label: `Add your first ${labelFn("product").toLowerCase()}`,
      done: (data?.inventory?.total_products ?? 0) > 0,
      navigate: () => onNavigate("/products/new"),
    },
    service: {
      id: "service",
      label: `Add your first ${labelFn("product").toLowerCase()}`,
      done: (data?.inventory?.total_products ?? 0) > 0,
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
      done: (data?.saleCount ?? 0) > 0 || (data?.totalRevenueToday ?? 0) > 0,
      navigate: () => window.open("/pos", "_blank"),
    },
    order: {
      id: "order",
      label: `Make your first ${labelFn("order").toLowerCase()}`,
      done: (data?.saleCount ?? 0) > 0 || (data?.totalRevenueToday ?? 0) > 0,
      navigate: () => window.open("/pos", "_blank"),
    },
    floor_plan: {
      id: "floor_plan",
      label: "Set up your floor plan",
      done: false, // No API data for this yet — always shows as TODO
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
  };

  return presetSteps.map((key) => ALL_STEPS[key]).filter(Boolean);
}
```

### Step 2: Update the component to use usePreset

Inside `DashboardOnboarding` component (line 46), add:

```jsx
const { onboarding_steps, label: labelFn } = usePreset();
```

Then update the `buildSteps` call (line 67):

```jsx
// FROM:
const steps = buildSteps(data, onNavigate);
// TO:
const steps = buildSteps(data, onNavigate, onboarding_steps, labelFn);
```

### Step 3: Commit

```bash
git add frontend/src/pages/dashboard/DashboardOnboarding.jsx
git commit -m "feat(preset-engine): onboarding steps driven by preset config"
```

---

## Task 5: Backend — PUT /api/company-profile Handles industry_type Change

**Files:**
- Modify: `backend/routes/tier4/company-profile.js` (line ~54-132)

### Step 1: Add imports at top of file

Find where the module function starts and add the imports:

```js
const { getPreset, VALID_INDUSTRY_TYPES } = require("../../config/industry-config");
const { getFeatureFlagsForModes } = require("../../config/mode-registry");
const { invalidateModeCache } = require("../../middleware/feature-flags");
```

### Step 2: Accept industry_type in the PUT handler

Add `industry_type` to the destructured body (around line 80, after `cash_denominations`):

```js
industry_type,
```

### Step 3: After the existing UPDATE query, add industry_type change logic

After the existing `await db.query(UPDATE company_profile ...)` block (line ~126), before `res.json(...)`:

```js
// If industry_type changed, re-derive modes and flags
if (industry_type && VALID_INDUSTRY_TYPES.includes(industry_type)) {
  const preset = getPreset(industry_type);
  
  await db.query(
    `UPDATE company_profile SET
       industry_type = $1,
       business_model = $2,
       industry_preset_version = 1
     WHERE id = 1`,
    [preset.industry_type, preset.business_model]
  );

  // Clear old modes and seed new ones
  await db.query("DELETE FROM tenant_modes");
  for (const mode of preset.modes) {
    await db.query(
      `INSERT INTO tenant_modes (mode, enabled, enabled_at) VALUES ($1, true, NOW()) ON CONFLICT (mode) DO NOTHING`,
      [mode]
    );
  }

  // Enable flags for new modes, disable flags for old modes
  const flagsToEnable = getFeatureFlagsForModes(preset.modes);
  // Disable all mode-related flags first
  const ALL_MODE_FLAGS = [
    "phase4_restaurant", "phase4_restaurant_kds",
    "phase4_appointments", "phase2_commissions",
    "phase4_service_projects", "phase4_service_contracts",
    "subscription_billing",
  ];
  for (const flagKey of ALL_MODE_FLAGS) {
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ($1, false) ON CONFLICT (key) DO UPDATE SET enabled = false`,
      [flagKey]
    );
  }
  // Then enable the ones for the new preset
  for (const flagKey of flagsToEnable) {
    await db.query(
      `UPDATE feature_flags SET enabled = true WHERE key = $1`,
      [flagKey]
    );
  }

  // Bust the mode cache so next request picks up changes
  invalidateModeCache();
}
```

### Step 4: Commit

```bash
git add backend/routes/tier4/company-profile.js
git commit -m "feat(preset-engine): PUT /api/company-profile re-derives modes when industry_type changes"
```

---

## Task 6: Frontend — Industry Type Selector in Company Settings

**Files:**
- Modify: `frontend/src/pages/redesign/CompanySettingsRedesign.jsx`

### Step 1: Add imports and preset data

```jsx
// Add import
import { usePreset } from "../../contexts/PresetContext";

// Inside component, near other hooks:
const { updatePreset } = usePreset();

// Add INDUSTRY_OPTIONS constant at module level (above DEFAULT_FORM):
const INDUSTRY_OPTIONS = [
  { value: "general_retail", label: "Retail Store" },
  { value: "restaurant", label: "Restaurant / Cafe" },
  { value: "salon", label: "Salon / Services" },
];
```

### Step 2: Add industry_type to DEFAULT_FORM

```js
// Add to DEFAULT_FORM:
industry_type: "general_retail",
```

### Step 3: After save, refresh the preset context

In the `save` function (line ~78), after `refresh()` call:

```js
// After: refresh();
// Add:
// Re-fetch bootstrap to update preset context with new industry labels/modes
api.get("/api/context/bootstrap")
  .then(data => { if (data?.preset) updatePreset(data.preset); })
  .catch(() => {});
```

### Step 4: Add the Industry Type dropdown to the Business Identity section

In the form JSX, at the top of the Business Identity grid (line ~137, inside the `grid grid-cols-1 gap-3 md:grid-cols-2` div), add as the first field:

```jsx
<FormField label="Business Type">
  <select
    className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)"
    value={form.industry_type || "general_retail"}
    onChange={(e) => upd("industry_type", e.target.value)}
  >
    {INDUSTRY_OPTIONS.map((opt) => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
</FormField>
```

### Step 5: Commit

```bash
git add frontend/src/pages/redesign/CompanySettingsRedesign.jsx
git commit -m "feat(preset-engine): industry type selector in Company Settings"
```

---

## Verification

After all tasks are complete:

1. **Labels** — Start dev servers. Log in as a restaurant tenant. Verify:
   - Dashboard shows "Top Menu Today" and "Recent Orders"
   - Products page title shows "Menu"
   - Customers page title shows "Guests"

2. **POS toggle** — Open POS. Search for a product. Verify:
   - Toggle button appears near search results
   - Clicking it switches between grid (card) and list (compact row) views
   - Preference persists after page reload

3. **Onboarding** — Create a new restaurant tenant via admin. Verify:
   - Onboarding shows "Add your first menu item" (not "product")
   - Shows "Set up your floor plan" step
   - Does NOT show generic "Make your first sale" (shows "Make your first order")

4. **Settings page** — Go to Company Settings. Verify:
   - "Business Type" dropdown appears at top of Business Identity
   - Changing from "Retail Store" to "Restaurant / Cafe" and saving:
     - Updates `industry_type` in DB
     - Re-derives tenant_modes (restaurant mode added)
     - Nav immediately shows Restaurant group
     - Page titles switch to restaurant labels

5. **Run unit tests:**
   ```
   cd backend && npx vitest run tests/unit/industry-config.test.js tests/unit/mode-registry.test.js tests/unit/feature-flags-modes.test.js
   ```
