# Reports Page Redesign Plan

## Context

The Reports page currently has 26 tabs across 6 groups, all displayed in a single horizontally-scrollable tab bar. This creates cognitive overload — users see a wall of tiny buttons before any content, and the overview cards lack visual hierarchy.

---

## Problems Identified

### 1. Tab Navigation — Too Dense
All 6 group labels and 26 tab buttons are visible simultaneously in a horizontal scroll strip. The eye has nowhere to rest.

### 2. Overview Cards — Equal Visual Weight
All 3 KPI cards (Revenue, Profit, Inventory) are identical in size and weight. No visual hierarchy guides the eye.

### 3. Missing Context Between Sections
Report content starts immediately with no breathing room or section context. Users lose track of where they are.

---

## Proposed Solution

### Layout Change: Flat → Two-Panel

**Current layout:**
```
[Header]
[26 tabs in scrollable row]
[Content]
```

**Proposed layout:**
```
[Header]
[Left sidebar: 6 group icons] | [Sub-tab pills + Content]
```

### Navigation: Two-Level Sidebar
- Left sidebar with 6 group icons: Sales, Customers, Inventory, Operations, Procurement, HR
- Clicking a group reveals only that group's sub-tabs (max 6 at a time)
- Reduces visible choices from 26 → ~6 at any moment
- Adds persistent visual orientation (which group am I in?)

### Overview Cards: Hero + Supporting
- Revenue card spans full width (or 2/3), larger number treatment
- Profit + Inventory split the remaining space below/beside
- Creates clear visual hierarchy — eye goes to revenue first

### Section Context: Breadcrumb Banner
- Thin banner above content showing: `Group → Tab` (e.g., `Sales → Item Wise`)
- Helps users orient themselves after switching tabs

---

## Implementation Stages

### Stage 1 — Navigation Restructure (Quick Win)
Redesign the `Reports()` component tab bar into a vertical left sidebar with group icons and collapsible sub-tabs.

- Files: `frontend/src/pages/Reports.jsx` (bottom ~80 lines — the `Reports()` component)
- Change: Replace horizontal `GROUPS.map()` tab bar with a two-column flex layout
- Effort: ~30–50 lines changed, no data/logic changes

### Stage 2 — Overview Dashboard Hierarchy
Redesign the `OverviewTab` cards to give Revenue a hero treatment.

- Files: `frontend/src/pages/Reports.jsx` (lines ~265–332)
- Change: Revenue card full-width with larger number, Profit + Inventory side-by-side below
- Effort: ~20 lines changed, no API changes

### Stage 3 — Section Headers & Breadcrumbs
Add consistent breadcrumb-style section headers to each tab.

- Files: `frontend/src/pages/Reports.jsx` — `TabContent` and individual tab components
- Change: Wrap each tab content with a header showing group + tab name
- Effort: Moderate — touches each tab component or adds a wrapper in `TabContent`

---

## Design Principles to Follow

- **Reduce simultaneous choices** — show only what's relevant at each level
- **Visual hierarchy** — most important metric gets most visual weight
- **Orientation** — always show users where they are in the navigation tree
- **Breathing room** — spacing between sections, not everything crammed together

---

## Files to Touch

| File | Section | What Changes |
|------|---------|--------------|
| `frontend/src/pages/Reports.jsx` | `Reports()` component (line ~2909) | Tab bar → sidebar layout |
| `frontend/src/pages/Reports.jsx` | `OverviewTab()` (line ~220) | KPI card hierarchy |
| `frontend/src/pages/Reports.jsx` | `TabContent()` (line ~2844) | Optional breadcrumb wrapper |

---

*Created: 2026-02-28 | Status: Planned*
