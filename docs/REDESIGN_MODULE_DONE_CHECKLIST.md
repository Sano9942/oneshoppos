# Redesign Module Done Checklist Template

Use this checklist for each module during phased redesign rollout.

## 1) Visual Acceptance

- Shopify-style hierarchy and spacing consistency
- Shared primitives only (no one-off button/input/table patterns unless documented)
- Responsive behavior validated for desktop + tablet + mobile
- Focus ring and keyboard navigation validated

## 2) Workflow Pass List

- Read/list flow works
- Create/edit flow works (if applicable)
- Destructive actions require confirmation
- Bulk actions (if applicable) function end-to-end
- Export/import actions (if applicable) function end-to-end

## 3) Regression Tests

- Existing backend tests still pass
- Frontend build passes
- No route/path regressions introduced
- No permission bypass introduced

## 4) Permission and Role Checks

- Unauthorized users cannot access restricted actions
- `RequirePerm` and backend permission middleware behavior unchanged
- Feature-flag disabled behavior validated

## 5) Performance and Data Scale

- Large dataset list interactions remain responsive
- Sorting/filtering/pagination perform at expected speed
- No obvious render-loop or expensive re-fetch regressions

## 6) Failure Modes

- API 500 state shows actionable error
- API 403 state handled and surfaced correctly
- Offline/network failure state is non-destructive and recoverable

## 7) Rollback and Release Gate

- Module flag can disable redesigned surface instantly
- Legacy path still available during stabilization window
- UAT smoke signed off before enabling redesign by default
