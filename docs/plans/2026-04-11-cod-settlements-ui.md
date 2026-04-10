# COD Settlements UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the frontend UI for the COD reconciliation flow (import courier CSV → auto-match to web orders → review/resolve → approve), plus the small backend additions needed to support manual matching and saved column mappings.

**Architecture:** Single-page React component `CODSettlementsRedesign` with three stateful views (list / import wizard / batch detail). Minimal backend additions: save CSV column mapping to `courier_integrations.config_json`, extend `/resolve` to accept `matched_order_id`, and add `GET /api/web-orders/search`. Approve permission moves to `all_access`. All design decisions are locked — see [2026-04-11-cod-settlements-ui-design.md](./2026-04-11-cod-settlements-ui-design.md).

**Tech Stack:** React 19, Vite 7, Tailwind v4, existing `xlsx` library (already installed — handles both CSV and Excel), Express 5, Postgres (`pg`), Zod validation, Jest (backend integration tests), Playwright (smoke).

**Codebase conventions to follow:**
- Backend routes: `backend/routes/<domain>.js` pattern, `requirePerm` / `requireFeature` middleware, `db.query($1, $2)` Postgres syntax, `res.json({...})` / `res.status(4xx).json({error: "..."})`
- Frontend pages: `pages/redesign/<Name>Redesign.jsx` + `pages/<Name>Route.jsx` 5-line wrapper + route in `routes/appRoutes.jsx` + nav entry in `ui/nav-config.js` + breadcrumb label in `ui/Breadcrumbs.jsx`
- All API calls via `import api from '../api'` → `api.get/post/put/patch/del`
- Currency: `const { fmt } = useCurrency()`
- Toast: `const toast = useToast()`
- Dark mode: use `(--css-var)` Tailwind syntax
- No raw `fetch()` calls, no manual auth headers

**Commit style:** One commit per task. Commit messages follow the existing `fix(domain):` / `feat(domain):` / `test(domain):` convention seen in recent commits.

---

## Task Ordering Rationale

Backend first (tasks 1–5), then frontend scaffold (task 6), then wizard (tasks 7–10), then detail view (tasks 11–14), then wiring and tests (tasks 15–17). Each task is independently committable and leaves the tree in a working state.

---

## Task 1: Backend — Extend `/resolve` endpoint to accept `matched_order_id`

**Files:**
- Modify: `backend/routes/fulfillment.js:1204-1221` (the existing `/resolve` handler)
- Test: `backend/tests/integration/cod-settlements.test.js` (new file)

**Step 1: Create the test file with a failing test**

Create `backend/tests/integration/cod-settlements.test.js`:

```javascript
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("COD settlements — /resolve extension", () => {
  let app, db, authHeaders;

  beforeEach(async () => {
    ({ app, db, authHeaders } = await createTestApp());

    // Enable the feature flag
    await db.query(
      "UPDATE feature_flags SET enabled = true WHERE flag_key = 'phase5_cod_reconciliation'"
    );

    // Seed a courier, a web_order, and a cod batch+line
    await db.query(
      `INSERT INTO courier_integrations (id, name, adapter_key, enabled)
       VALUES (1, 'Test Courier', 'generic', true)
       ON CONFLICT (id) DO NOTHING`
    );
    await db.query(
      `INSERT INTO web_orders (id, source, external_order_id, external_order_number, grand_total, payment_status)
       VALUES (100, 'manual', 'TEST-100', 'WEB-100', 500.00, 'pending')`
    );
    await db.query(
      `INSERT INTO cod_settlement_batches (id, courier_id, batch_ref, status, total_lines, total_amount)
       VALUES (1, 1, 'TEST-BATCH', 'review', 1, 500.00)`
    );
    await db.query(
      `INSERT INTO cod_settlement_lines (id, batch_id, courier_tracking_number, remitted_amount, match_status)
       VALUES (1, 1, 'UNKNOWN-TRK', 500.00, 'unmatched')`
    );
  });

  test("resolve with matched_order_id links the line and recomputes status", async () => {
    const res = await request(app)
      .post("/api/fulfillment/cod/settlements/1/resolve")
      .set(authHeaders)
      .send({ line_id: 1, matched_order_id: 100, resolution_note: "Manually matched" });

    expect(res.status).toBe(200);

    const { rows } = await db.query(
      "SELECT match_status, matched_order_id, expected_amount, difference, resolution_note FROM cod_settlement_lines WHERE id = 1"
    );
    expect(rows[0].match_status).toBe("matched");
    expect(rows[0].matched_order_id).toBe(100);
    expect(Number(rows[0].expected_amount)).toBe(500.00);
    expect(Number(rows[0].difference)).toBe(0);
    expect(rows[0].resolution_note).toBe("Manually matched");
  });

  test("resolve without matched_order_id still works (note only)", async () => {
    const res = await request(app)
      .post("/api/fulfillment/cod/settlements/1/resolve")
      .set(authHeaders)
      .send({ line_id: 1, resolution_note: "Investigating" });

    expect(res.status).toBe(200);

    const { rows } = await db.query(
      "SELECT match_status, resolution_note FROM cod_settlement_lines WHERE id = 1"
    );
    expect(rows[0].match_status).toBe("unmatched"); // unchanged
    expect(rows[0].resolution_note).toBe("Investigating");
  });
});
```

Also add `const request = require("supertest");` at the top.

**Step 2: Run the test to verify it fails**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js -t "matched_order_id"`
Expected: FAIL — the line will still have `match_status = 'unmatched'` because the handler currently only updates the note.

**Step 3: Modify the handler**

In `backend/routes/fulfillment.js`, replace the `/resolve` handler (currently ~lines 1204-1221) with:

```javascript
// ── POST /api/fulfillment/cod/settlements/:id/resolve ───────────────
app.post("/api/fulfillment/cod/settlements/:id/resolve", ...codPerm, async (req, res) => {
  try {
    const { line_id, resolution_note, matched_order_id } = req.body || {};
    if (!line_id) return res.status(400).json({ error: "line_id required" });

    await db.transaction(async (client) => {
      if (matched_order_id) {
        // Manual match — look up the web_order, recompute fields
        const { rows: [order] } = await client.query(
          "SELECT grand_total FROM web_orders WHERE id = $1",
          [matched_order_id]
        );
        if (!order) {
          throw Object.assign(new Error("web_order not found"), { statusCode: 404 });
        }

        const { rows: [line] } = await client.query(
          "SELECT remitted_amount FROM cod_settlement_lines WHERE id = $1 AND batch_id = $2",
          [line_id, req.params.id]
        );
        if (!line) {
          throw Object.assign(new Error("Line not found"), { statusCode: 404 });
        }

        const expected = Number(order.grand_total);
        const remitted = Number(line.remitted_amount);
        const diff = remitted - expected;
        let status = "matched";
        if (diff < -0.01) status = "short";
        else if (diff > 0.01) status = "over";

        await client.query(
          `UPDATE cod_settlement_lines SET
             matched_order_id = $1,
             expected_amount = $2,
             difference = $3,
             match_status = $4,
             resolution_note = $5,
             resolved_by = $6,
             resolved_at = NOW()
           WHERE id = $7 AND batch_id = $8`,
          [matched_order_id, expected, diff, status, resolution_note || "", req.employee?.id || null, line_id, req.params.id]
        );
      } else {
        // Note-only resolution (original behavior)
        await client.query(
          `UPDATE cod_settlement_lines SET
             resolution_note = $1, resolved_by = $2, resolved_at = NOW()
           WHERE id = $3 AND batch_id = $4`,
          [resolution_note || "", req.employee?.id || null, line_id, req.params.id]
        );
      }
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});
```

**Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js`
Expected: both tests PASS.

**Step 5: Commit**

```bash
git add backend/routes/fulfillment.js backend/tests/integration/cod-settlements.test.js
git commit -m "feat(cod): support manual order match via /resolve"
```

---

## Task 2: Backend — Add `GET /api/web-orders/search` endpoint

**Files:**
- Modify: `backend/routes/fulfillment.js` (add new endpoint after the cod routes, before the closing `};`)
- Test: `backend/tests/integration/cod-settlements.test.js` (append to existing file)

**Step 1: Write the failing test**

Append to the existing describe block:

```javascript
describe("GET /api/web-orders/search", () => {
  beforeEach(async () => {
    await db.query(
      `INSERT INTO web_orders (id, source, external_order_id, external_order_number, grand_total, payment_status, customer_name_snapshot, customer_phone_snapshot)
       VALUES
         (200, 'manual', 'T-200', 'ORD-200', 1500.00, 'paid', 'Ali Khan', '03001234567'),
         (201, 'manual', 'T-201', 'ORD-201', 750.50, 'pending', 'Sara Ahmed', '03009999999')
       ON CONFLICT DO NOTHING`
    );
  });

  test("searches by external_order_number", async () => {
    const res = await request(app)
      .get("/api/web-orders/search?q=ORD-200")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].id).toBe(200);
    expect(res.body.orders[0].is_already_matched).toBe(false);
  });

  test("searches by customer name (case-insensitive)", async () => {
    const res = await request(app)
      .get("/api/web-orders/search?q=ali")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.orders.some(o => o.id === 200)).toBe(true);
  });

  test("searches by phone", async () => {
    const res = await request(app)
      .get("/api/web-orders/search?q=03009999999")
      .set(authHeaders);
    expect(res.body.orders.some(o => o.id === 201)).toBe(true);
  });

  test("searches by exact grand_total", async () => {
    const res = await request(app)
      .get("/api/web-orders/search?q=750.50")
      .set(authHeaders);
    expect(res.body.orders.some(o => o.id === 201)).toBe(true);
  });

  test("returns empty array for no matches", async () => {
    const res = await request(app)
      .get("/api/web-orders/search?q=NONEXISTENT_QUERY_XYZ")
      .set(authHeaders);
    expect(res.body.orders).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js -t "web-orders/search"`
Expected: FAIL — 404 (route doesn't exist).

**Step 3: Add the endpoint**

In `backend/routes/fulfillment.js`, add this route inside the module.exports function (after the existing COD routes, before any closing brace of the function):

```javascript
// ── GET /api/web-orders/search — for manual COD match ───────────────
app.get(
  "/api/web-orders/search",
  requirePerm("manage_orders"),
  async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      if (!q) return res.json({ orders: [] });

      const isNumeric = /^\d+(\.\d+)?$/.test(q);
      const numericVal = isNumeric ? Number(q) : null;

      const { rows } = await db.query(
        `SELECT wo.id,
                wo.external_order_number,
                wo.grand_total,
                wo.payment_status,
                wo.ordered_at,
                wo.customer_name_snapshot,
                wo.customer_phone_snapshot,
                EXISTS (
                  SELECT 1 FROM cod_settlement_lines sl
                  WHERE sl.matched_order_id = wo.id
                ) AS is_already_matched
         FROM web_orders wo
         WHERE wo.external_order_number ILIKE $1
            OR wo.customer_name_snapshot ILIKE $1
            OR wo.customer_phone_snapshot LIKE $2
            OR ($3::boolean AND wo.grand_total = $4)
         ORDER BY wo.ordered_at DESC NULLS LAST
         LIMIT 20`,
        [`%${q}%`, `%${q}%`, isNumeric, numericVal]
      );

      res.json({
        orders: rows.map((r) => ({
          ...r,
          grand_total: Number(r.grand_total),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);
```

**Step 4: Run the tests**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js -t "web-orders/search"`
Expected: all 5 tests PASS.

**Step 5: Commit**

```bash
git add backend/routes/fulfillment.js backend/tests/integration/cod-settlements.test.js
git commit -m "feat(cod): add web-orders search endpoint for manual match"
```

---

## Task 3: Backend — Save CSV column mapping to courier_integrations

**Files:**
- Modify: `backend/routes/couriers.js` (add PATCH endpoint, extend GET to return config_json)
- Test: `backend/tests/integration/cod-settlements.test.js` (append)

**Step 1: Write the failing test**

Append a new describe block:

```javascript
describe("PATCH /api/couriers/:id/csv-mapping", () => {
  test("saves mapping to config_json", async () => {
    const res = await request(app)
      .patch("/api/couriers/1/csv-mapping")
      .set(authHeaders)
      .send({
        mapping: {
          courier_tracking_number: "Tracking No",
          remitted_amount: "COD Amount",
          courier_order_ref: "CN#",
          courier_fee: "Delivery Fee",
        },
      });

    expect(res.status).toBe(200);

    const { rows } = await db.query(
      "SELECT config_json FROM courier_integrations WHERE id = 1"
    );
    const cfg = rows[0].config_json || {};
    expect(cfg.cod_csv_mapping).toEqual({
      courier_tracking_number: "Tracking No",
      remitted_amount: "COD Amount",
      courier_order_ref: "CN#",
      courier_fee: "Delivery Fee",
    });
  });

  test("GET /api/couriers returns config_json", async () => {
    const res = await request(app).get("/api/couriers").set(authHeaders);
    const courier = res.body.couriers.find((c) => c.id === 1);
    expect(courier).toBeDefined();
    expect(courier.config_json).toBeDefined();
  });

  test("rejects missing required fields", async () => {
    const res = await request(app)
      .patch("/api/couriers/1/csv-mapping")
      .set(authHeaders)
      .send({ mapping: { courier_order_ref: "CN#" } }); // missing required fields

    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js -t "csv-mapping"`
Expected: FAIL — 404 on PATCH, or missing `config_json` in GET response.

**Step 3: Modify `backend/routes/couriers.js`**

3a. Update the GET handler (around line 37) to include `config_json`:

```javascript
app.get("/api/couriers", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, adapter_key, tracking_url_template, enabled, api_base_url,
              supports_booking, supports_tracking, supports_cancellation, supports_labels,
              provider_category, flat_shipping_rate, config_json,
              last_healthcheck_at, last_healthcheck_status
       FROM courier_integrations ORDER BY name`
    );
    res.json({
      couriers: rows.map((c) => ({
        ...c,
        flat_shipping_rate: c.flat_shipping_rate ? Number(c.flat_shipping_rate) : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

3b. Add a new PATCH handler after the POST `/api/couriers` handler (around line 93):

```javascript
// PATCH /api/couriers/:id/csv-mapping — save COD CSV column mapping
app.patch(
  "/api/couriers/:id/csv-mapping",
  requirePerm("manage_orders"),
  async (req, res) => {
    try {
      const { mapping } = req.body || {};
      if (!mapping || typeof mapping !== "object") {
        return res.status(400).json({ error: "mapping object required" });
      }
      if (!mapping.courier_tracking_number || !mapping.remitted_amount) {
        return res
          .status(400)
          .json({ error: "courier_tracking_number and remitted_amount are required in mapping" });
      }

      // Merge into existing config_json rather than overwrite
      await db.query(
        `UPDATE courier_integrations SET
           config_json = COALESCE(config_json, '{}'::jsonb) || jsonb_build_object('cod_csv_mapping', $1::jsonb)
         WHERE id = $2`,
        [JSON.stringify(mapping), req.params.id]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);
```

**Step 4: Verify `courier_integrations.config_json` exists**

Run: `DATABASE_URL=<test-url> psql -c "\\d courier_integrations" | grep config_json`
Expected: a `config_json` column of type `jsonb`.

If it doesn't exist, grep `schema-pg.sql` for `config_json` — the column should already be there from an earlier migration. If missing, add to schema-pg.sql and create a new migration. (Per our brainstorming notes, it's already there.)

**Step 5: Run tests**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js -t "csv-mapping"`
Expected: all 3 tests PASS.

**Step 6: Commit**

```bash
git add backend/routes/couriers.js backend/tests/integration/cod-settlements.test.js
git commit -m "feat(cod): persist CSV column mapping per courier"
```

---

## Task 4: Backend — Move approve permission to `all_access`

**Files:**
- Modify: `backend/routes/fulfillment.js:1223-1224` (the approve route)
- Test: `backend/tests/integration/cod-settlements.test.js` (append)

**Step 1: Write the failing test**

Append:

```javascript
describe("approve permission", () => {
  test("non-admin with manage_orders cannot approve", async () => {
    // Create a non-admin test context
    const { app: app2, authHeaders: nonAdminHeaders } = await createTestApp({
      employeeRole: "manager", // has manage_orders but not all_access
    });

    await db.query(
      `INSERT INTO cod_settlement_batches (id, courier_id, batch_ref, status)
       VALUES (99, 1, 'APPROVE-TEST', 'review')
       ON CONFLICT (id) DO UPDATE SET status = 'review'`
    );

    const res = await request(app2)
      .post("/api/fulfillment/cod/settlements/99/approve")
      .set(nonAdminHeaders)
      .send({});

    expect(res.status).toBe(403);
  });
});
```

Note: if `createTestApp` doesn't yet support `employeeRole`, check the helper at `backend/tests/helpers/createTestApp-pg.js` — adapt the test to whatever role-switching mechanism it provides. If there is no such mechanism, the test can verify the permission constant directly by reading the route middleware stack. The simpler version:

```javascript
test("approve route uses all_access permission", () => {
  const fulfillmentSource = require("fs").readFileSync(
    require("path").join(__dirname, "../../routes/fulfillment.js"),
    "utf8"
  );
  // Find the approve route and verify its permission
  const approveBlock = fulfillmentSource.match(
    /cod\/settlements\/:id\/approve[\s\S]{0,400}/
  )[0];
  expect(approveBlock).toMatch(/requirePerm\(["']all_access["']\)/);
});
```

Use whichever approach matches the existing test helper conventions. The source-match approach is the more portable fallback.

**Step 2: Run test to verify it fails**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js -t "approve"`
Expected: FAIL — current route uses `codPerm` which is `manage_orders`.

**Step 3: Modify the approve route**

Find the approve route (around line 1223) and change its permission:

```javascript
// ── POST /api/fulfillment/cod/settlements/:id/approve ───────────────
// NOTE: uses all_access instead of the shared codPerm because approval is admin-only (maker-checker)
app.post(
  "/api/fulfillment/cod/settlements/:id/approve",
  requirePerm("all_access"),
  requireFeature("phase5_cod_reconciliation"),
  async (req, res) => {
    // ... rest of the handler unchanged
```

**Step 4: Run all COD tests to verify they pass and nothing regressed**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js`
Expected: all tests PASS.

**Step 5: Commit**

```bash
git add backend/routes/fulfillment.js backend/tests/integration/cod-settlements.test.js
git commit -m "feat(cod): require admin to approve settlement batches"
```

---

## Task 5: Backend — Add approve race test + wrong-state test

**Files:**
- Modify: `backend/tests/integration/cod-settlements.test.js`

These already exist in the backend (SELECT FOR UPDATE + status check). This task just adds the coverage.

**Step 1: Write the tests**

Append:

```javascript
describe("approve concurrency", () => {
  beforeEach(async () => {
    await db.query(
      `INSERT INTO cod_settlement_batches (id, courier_id, batch_ref, status, total_lines, total_amount)
       VALUES (50, 1, 'RACE', 'review', 0, 0)
       ON CONFLICT (id) DO UPDATE SET status = 'review'`
    );
  });

  test("approving an already-approved batch returns 400", async () => {
    await db.query(
      "UPDATE cod_settlement_batches SET status = 'approved' WHERE id = 50"
    );

    // Need an admin-headers variant here — use all_access role
    const { authHeaders: adminHeaders } = await createTestApp({
      employeeRole: "administrator",
    });

    const res = await request(app)
      .post("/api/fulfillment/cod/settlements/50/approve")
      .set(adminHeaders)
      .send({});

    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run to verify**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js -t "concurrency"`
Expected: PASS (the backend already enforces this).

**Step 3: Commit**

```bash
git add backend/tests/integration/cod-settlements.test.js
git commit -m "test(cod): cover approve wrong-state case"
```

---

## Task 6: Frontend — Scaffold CODSettlementsRedesign page shell + wiring

**Files:**
- Create: `frontend/src/pages/redesign/CODSettlementsRedesign.jsx`
- Create: `frontend/src/pages/CODSettlementsRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

**Step 1: Create the route wrapper**

Create `frontend/src/pages/CODSettlementsRoute.jsx`:

```jsx
import CODSettlementsRedesign from "./redesign/CODSettlementsRedesign";

export default function CODSettlementsRoute() {
  return <CODSettlementsRedesign />;
}
```

**Step 2: Create the shell component**

Create `frontend/src/pages/redesign/CODSettlementsRedesign.jsx`:

```jsx
import { useState } from "react";
import { Wallet } from "lucide-react";
import { PageShell, SectionCard } from "../../ui/primitives";
import { useFeatureFlags } from "../../hooks/useFeatureFlags";
import { Navigate } from "react-router-dom";

export default function CODSettlementsRedesign() {
  const { flags, loading: flagsLoading } = useFeatureFlags();
  const [view, setView] = useState({ name: "list" }); // { name: "list" } | { name: "import" } | { name: "detail", batchId }

  if (flagsLoading) {
    return (
      <PageShell title="COD Settlements">
        <SectionCard>
          <div className="py-16 text-center text-(--text-muted) text-sm">Loading…</div>
        </SectionCard>
      </PageShell>
    );
  }

  if (!flags?.phase5_cod_reconciliation) {
    return <Navigate to="/" replace />;
  }

  return (
    <PageShell
      title="COD Settlements"
      subtitle="Reconcile cash-on-delivery remittances from couriers"
    >
      <SectionCard>
        <div className="px-4 py-16 text-center text-(--text-muted) text-sm">
          <Wallet size={32} className="mx-auto mb-3" />
          Coming soon — view: {view.name}
        </div>
      </SectionCard>
    </PageShell>
  );
}
```

**Step 3: Add the route**

Open `frontend/src/routes/appRoutes.jsx`. Find where similar lazy routes are declared and add:

```jsx
const CODSettlementsRoute = lazy(() => import("../pages/CODSettlementsRoute"));
```

Then in the `<Routes>` list, alongside similar entries:

```jsx
<Route
  path="/cod-settlements"
  element={
    <RequireAuth>
      <RequirePerm perm="manage_orders">
        <CODSettlementsRoute />
      </RequirePerm>
    </RequireAuth>
  }
/>
```

(Grep for an existing route like `/transfers` or `/expenses` and mirror its structure — do not guess at wrapper component names.)

**Step 4: Add the nav entry**

Open `frontend/src/ui/nav-config.js`. Add `Wallet` to the lucide imports at the top:

```jsx
import {
  ...
  Wallet,
} from "lucide-react";
```

Then add a nav entry in the appropriate group (find where "Expenses" or "Suppliers" is and add next to it):

```jsx
{ label: "COD Settlements", path: "/cod-settlements", icon: Wallet, perm: "manage_orders" },
```

Use whatever shape the existing entries use — mirror, don't invent.

**Step 5: Add the breadcrumb label**

Open `frontend/src/ui/Breadcrumbs.jsx`. Find the `LABELS` object and add:

```jsx
"cod-settlements": "COD Settlements",
```

**Step 6: Verify the page loads**

Run `cd frontend && npm run dev`, navigate to `/cod-settlements`, verify the page renders the "Coming soon — view: list" placeholder. Verify the nav entry appears in the sidebar. Verify the breadcrumb shows "COD Settlements".

If `phase5_cod_reconciliation` flag is off in dev, temporarily enable it via the admin panel or via:
`UPDATE feature_flags SET enabled = true WHERE flag_key = 'phase5_cod_reconciliation';`

**Step 7: Commit**

```bash
git add frontend/src/pages/redesign/CODSettlementsRedesign.jsx \
        frontend/src/pages/CODSettlementsRoute.jsx \
        frontend/src/routes/appRoutes.jsx \
        frontend/src/ui/nav-config.js \
        frontend/src/ui/Breadcrumbs.jsx
git commit -m "feat(cod): scaffold COD settlements page + nav entry"
```

---

## Task 7: Frontend — Build the list view (BatchList sub-component)

**Files:**
- Create: `frontend/src/pages/redesign/cod/BatchList.jsx`
- Modify: `frontend/src/pages/redesign/CODSettlementsRedesign.jsx` (wire it in)

**Step 1: Create BatchList.jsx**

```jsx
import { useEffect, useState } from "react";
import { Plus, Eye } from "lucide-react";
import api from "../../../api";
import { Button } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useToast } from "../../../contexts/ToastContext";
import { fmtLocalDateTime } from "../../../utils/dates";

const STATUS_META = {
  imported: { label: "Imported", color: "bg-blue-100 text-blue-700" },
  matching: { label: "Matching…", color: "bg-amber-100 text-amber-700" },
  review: { label: "Review", color: "bg-yellow-100 text-yellow-800" },
  approved: { label: "Approved", color: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
};

export default function BatchList({ onOpenImport, onOpenBatch }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ courier_id: "", status: "" });
  const [couriers, setCouriers] = useState([]);

  async function fetchBatches() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filter.courier_id) qs.set("courier_id", filter.courier_id);
      if (filter.status) qs.set("status", filter.status);
      const data = await api.get(`/api/fulfillment/cod/settlements?${qs}`);
      setBatches(data.batches || data || []);
    } catch (err) {
      toast.error(err.message || "Failed to load batches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.get("/api/couriers").then((d) => setCouriers(d.couriers || [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [filter.courier_id, filter.status]);

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-(--border)">
        <select
          value={filter.courier_id}
          onChange={(e) => setFilter((f) => ({ ...f, courier_id: e.target.value }))}
          className="rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
        >
          <option value="">All couriers</option>
          {couriers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
          className="rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <div className="grow" />
        <Button onClick={onOpenImport}>
          <Plus size={15} />
          Import new batch
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-(--text-muted) text-sm">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="py-16 text-center text-(--text-muted) text-sm">
          No settlement batches yet. Click "Import new batch" to get started.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-(--bg-subtle) text-(--text-muted) text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Batch Ref</th>
              <th className="text-left px-4 py-2 font-medium">Courier</th>
              <th className="text-right px-4 py-2 font-medium">Lines</th>
              <th className="text-right px-4 py-2 font-medium">Total Remitted</th>
              <th className="text-right px-4 py-2 font-medium">Matched</th>
              <th className="text-right px-4 py-2 font-medium">Unmatched</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Imported</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {batches.map((b) => {
              const meta = STATUS_META[b.status] || { label: b.status, color: "bg-gray-100 text-gray-700" };
              return (
                <tr key={b.id} className="hover:bg-(--bg-subtle)/50 cursor-pointer" onClick={() => onOpenBatch(b.id)}>
                  <td className="px-4 py-2 font-medium text-(--text-primary)">{b.batch_ref || `#${b.id}`}</td>
                  <td className="px-4 py-2 text-(--text-secondary)">{b.courier_name || "—"}</td>
                  <td className="px-4 py-2 text-right text-(--text-secondary)">{b.total_lines}</td>
                  <td className="px-4 py-2 text-right font-medium text-(--text-primary)">{fmt(Number(b.total_amount || 0))}</td>
                  <td className="px-4 py-2 text-right text-green-600 dark:text-green-400">{b.matched_count}</td>
                  <td className="px-4 py-2 text-right text-amber-600 dark:text-amber-400">{b.unmatched_count}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-(--text-muted) text-xs">
                    {b.imported_at ? fmtLocalDateTime(b.imported_at) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Eye size={14} className="text-(--text-muted)" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

**Step 2: Wire into CODSettlementsRedesign.jsx**

Replace the placeholder `<SectionCard>` body with:

```jsx
import BatchList from "./cod/BatchList";

// ... inside the component, replace the placeholder:
<SectionCard>
  {view.name === "list" && (
    <BatchList
      onOpenImport={() => setView({ name: "import" })}
      onOpenBatch={(batchId) => setView({ name: "detail", batchId })}
    />
  )}
  {view.name !== "list" && (
    <div className="p-8 text-center text-(--text-muted)">
      View "{view.name}" not yet implemented
      <button onClick={() => setView({ name: "list" })} className="ml-2 text-(--accent) underline">
        Back to list
      </button>
    </div>
  )}
</SectionCard>
```

**Step 3: Verify**

Open `/cod-settlements` in dev. Should see an empty state with filter controls and an "Import new batch" button. Clicking filters should not crash. (There will be no batches in the list until a manual insert — that's fine for this task.)

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/cod/BatchList.jsx \
        frontend/src/pages/redesign/CODSettlementsRedesign.jsx
git commit -m "feat(cod): list view with courier/status filters"
```

---

## Task 8: Frontend — Build ImportWizard shell + Step 1 (courier) + Step 2 (file upload)

**Files:**
- Create: `frontend/src/pages/redesign/cod/ImportWizard.jsx`
- Modify: `frontend/src/pages/redesign/CODSettlementsRedesign.jsx`

**Step 1: Create ImportWizard.jsx**

```jsx
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import api from "../../../api";
import { Button } from "../../../ui/primitives";
import { useToast } from "../../../contexts/ToastContext";

export default function ImportWizard({ onCancel, onComplete }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [couriers, setCouriers] = useState([]);
  const [courierId, setCourierId] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState({});
  const [saveMapping, setSaveMapping] = useState(true);
  const [batchRef, setBatchRef] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/couriers").then((d) => setCouriers((d.couriers || []).filter((c) => c.enabled))).catch(() => {});
  }, []);

  const selectedCourier = couriers.find((c) => String(c.id) === String(courierId));

  // When courier changes, pre-load any saved mapping
  useEffect(() => {
    if (selectedCourier?.config_json?.cod_csv_mapping) {
      setMapping(selectedCourier.config_json.cod_csv_mapping);
    } else {
      setMapping({});
    }
  }, [courierId]);

  async function handleFile(file) {
    setFileName(file.name);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (json.length < 2) {
        toast.error("File has no data rows");
        return;
      }
      setHeaders(json[0].map(String));
      setRows(json.slice(1).filter((r) => r.some((cell) => cell !== "")));
      setStep(3);
    } catch (err) {
      toast.error("Failed to parse file: " + err.message);
    }
  }

  // Step navigation guards
  const canNext1 = !!courierId;
  const canNext3 =
    !!mapping.courier_tracking_number &&
    !!mapping.remitted_amount &&
    headers.includes(mapping.courier_tracking_number) &&
    headers.includes(mapping.remitted_amount);

  // Step 4 preview — apply mapping to first 10 rows
  const mappedPreview = rows.slice(0, 10).map((row) => {
    const rec = {};
    for (const [target, sourceHeader] of Object.entries(mapping)) {
      if (sourceHeader) {
        const idx = headers.indexOf(sourceHeader);
        rec[target] = idx >= 0 ? row[idx] : "";
      }
    }
    return rec;
  });

  // Non-numeric amount check
  const amountIdx = headers.indexOf(mapping.remitted_amount);
  const hasBadAmounts =
    amountIdx >= 0 &&
    rows.slice(0, 50).some((r) => {
      const v = r[amountIdx];
      return v !== "" && v !== null && isNaN(Number(v));
    });

  const totalAmount = rows.reduce((sum, r) => {
    if (amountIdx < 0) return sum;
    const n = Number(r[amountIdx]);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  async function handleImport() {
    setBusy(true);
    try {
      // Save mapping first if requested
      if (saveMapping) {
        await api.patch(`/api/couriers/${courierId}/csv-mapping`, { mapping });
      }

      // Build lines array
      const lines = rows.map((row) => {
        const line = {};
        for (const [target, sourceHeader] of Object.entries(mapping)) {
          if (!sourceHeader) continue;
          const idx = headers.indexOf(sourceHeader);
          if (idx < 0) continue;
          let val = row[idx];
          if (target === "remitted_amount" || target === "courier_fee") {
            val = Number(val) || 0;
          }
          line[target] = val;
        }
        return line;
      });

      // Import
      const { batch } = await api.post("/api/fulfillment/cod/settlements/import", {
        courier_id: Number(courierId),
        batch_ref: batchRef || fileName,
        lines,
      });

      // Auto-run match
      await api.post(`/api/fulfillment/cod/settlements/${batch.id}/match`, {});

      toast.success("Batch imported and matched");
      onComplete(batch.id);
    } catch (err) {
      toast.error(err.message || "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-(--text-primary)">Import COD Batch</h2>
          <p className="text-xs text-(--text-muted)">Step {step} of 4</p>
        </div>
        <button onClick={onCancel} className="text-(--text-muted) hover:text-(--text-primary)">
          <X size={20} />
        </button>
      </div>

      {/* Step 1 — Courier */}
      {step === 1 && (
        <div className="space-y-4 max-w-md">
          <label className="block text-sm font-medium text-(--text-secondary)">
            Courier
          </label>
          <select
            value={courierId}
            onChange={(e) => setCourierId(e.target.value)}
            className="w-full rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
          >
            <option value="">Select a courier…</option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {selectedCourier?.config_json?.cod_csv_mapping && (
            <p className="text-xs text-green-600 dark:text-green-400">
              Saved column mapping available for this courier — step 3 will be skipped.
            </p>
          )}
        </div>
      )}

      {/* Step 2 — Upload */}
      {step === 2 && (
        <div className="space-y-4 max-w-md">
          <label className="block text-sm font-medium text-(--text-secondary)">
            Upload CSV or Excel file
          </label>
          <label className="block border-2 border-dashed border-(--border) rounded-lg p-8 text-center cursor-pointer hover:border-(--accent)">
            <Upload size={24} className="mx-auto mb-2 text-(--text-muted)" />
            <span className="text-sm text-(--text-secondary)">
              {fileName || "Click to choose a file (.csv, .xlsx)"}
            </span>
            <input
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        </div>
      )}

      {/* Step 3 — Mapping */}
      {step === 3 && (
        <div className="space-y-4 max-w-xl">
          <p className="text-sm text-(--text-secondary)">
            Map columns from your file to the required fields.
          </p>
          {[
            { key: "courier_tracking_number", label: "Tracking Number *" },
            { key: "remitted_amount", label: "Remitted Amount *" },
            { key: "courier_order_ref", label: "Courier Reference (optional)" },
            { key: "courier_fee", label: "Courier Fee (optional)" },
          ].map((f) => (
            <div key={f.key} className="flex items-center gap-3">
              <label className="w-52 text-sm text-(--text-secondary)">{f.label}</label>
              <select
                value={mapping[f.key] || ""}
                onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                className="grow rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
              >
                <option value="">— not mapped —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm text-(--text-secondary)">
            <input
              type="checkbox"
              checked={saveMapping}
              onChange={(e) => setSaveMapping(e.target.checked)}
              className="w-4 h-4"
            />
            Save this mapping for {selectedCourier?.name} (next import will skip this step)
          </label>
        </div>
      )}

      {/* Step 4 — Preview & confirm */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-(--border) p-4 bg-(--bg-subtle)/50">
            <div className="text-sm text-(--text-secondary)">
              <strong>{rows.length}</strong> lines from <strong>{fileName}</strong>
            </div>
            <div className="text-sm text-(--text-secondary)">
              Total remitted: <strong>{totalAmount.toFixed(2)}</strong>
            </div>
            {rows.length > 5000 && (
              <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Large batch — import may take a minute.
              </div>
            )}
            {hasBadAmounts && (
              <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                Warning: amount column contains non-numeric values. Fix the mapping or the file before continuing.
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-(--text-secondary) mb-1">
              Batch reference
            </label>
            <input
              type="text"
              placeholder={`e.g. ${selectedCourier?.name} — Week of ${new Date().toISOString().slice(0, 10)}`}
              value={batchRef}
              onChange={(e) => setBatchRef(e.target.value)}
              className="w-full max-w-md rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
            />
          </div>

          <div className="rounded-lg border border-(--border) overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-(--bg-subtle) text-(--text-muted) uppercase">
                  <th className="text-left px-3 py-2">Tracking</th>
                  <th className="text-left px-3 py-2">Courier Ref</th>
                  <th className="text-right px-3 py-2">Remitted</th>
                  <th className="text-right px-3 py-2">Fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {mappedPreview.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-(--text-primary)">{r.courier_tracking_number}</td>
                    <td className="px-3 py-1.5 text-(--text-secondary)">{r.courier_order_ref || "—"}</td>
                    <td className="px-3 py-1.5 text-right text-(--text-primary)">{r.remitted_amount}</td>
                    <td className="px-3 py-1.5 text-right text-(--text-muted)">{r.courier_fee || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 10 && (
              <div className="px-3 py-2 text-center text-xs text-(--text-muted) bg-(--bg-subtle)">
                …and {rows.length - 10} more rows
              </div>
            )}
          </div>
        </div>
      )}

      {/* Nav buttons */}
      <div className="flex items-center justify-between mt-8 pt-4 border-t border-(--border)">
        {step > 1 ? (
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
            <ArrowLeft size={14} /> Back
          </Button>
        ) : (
          <span />
        )}

        {step === 1 && (
          <Button disabled={!canNext1} onClick={() => setStep(2)}>
            Next <ArrowRight size={14} />
          </Button>
        )}
        {step === 3 && (
          <Button
            disabled={!canNext3}
            onClick={() => setStep(4)}
          >
            Next <ArrowRight size={14} />
          </Button>
        )}
        {step === 4 && (
          <Button disabled={busy || hasBadAmounts} onClick={handleImport}>
            {busy ? "Importing…" : "Import & Match"}
          </Button>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Wire into CODSettlementsRedesign**

Replace the placeholder for `view.name === "import"`:

```jsx
import ImportWizard from "./cod/ImportWizard";

// ...
{view.name === "import" && (
  <ImportWizard
    onCancel={() => setView({ name: "list" })}
    onComplete={(batchId) => setView({ name: "detail", batchId })}
  />
)}
```

**Step 3: Verify the first two wizard steps work**

In dev: click "Import new batch" → select a courier → click Next → upload a small CSV. Verify parsing works and you land on step 3. Do not complete step 4 yet (backend roundtrip tested in task 17).

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/cod/ImportWizard.jsx \
        frontend/src/pages/redesign/CODSettlementsRedesign.jsx
git commit -m "feat(cod): import wizard with CSV parsing and column mapping"
```

---

## Task 9: Frontend — Batch detail header card

**Files:**
- Create: `frontend/src/pages/redesign/cod/BatchDetail.jsx`
- Create: `frontend/src/pages/redesign/cod/BatchHeaderCard.jsx`
- Modify: `frontend/src/pages/redesign/CODSettlementsRedesign.jsx`

**Step 1: Create BatchHeaderCard.jsx**

```jsx
import { AlertTriangle } from "lucide-react";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { fmtLocalDateTime } from "../../../utils/dates";

const STATUS_META = {
  imported: { label: "Imported", color: "bg-blue-100 text-blue-700" },
  matching: { label: "Matching…", color: "bg-amber-100 text-amber-700" },
  review: { label: "Review", color: "bg-yellow-100 text-yellow-800" },
  approved: { label: "Approved", color: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
};

function KpiTile({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-(--border) bg-(--bg-subtle)/40 px-3 py-2">
      <div className="text-xs text-(--text-muted) uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-semibold ${tone === "green" ? "text-green-600 dark:text-green-400" : tone === "red" ? "text-red-600 dark:text-red-400" : "text-(--text-primary)"}`}>
        {value}
      </div>
    </div>
  );
}

export default function BatchHeaderCard({ batch, children }) {
  const { fmt } = useCurrency();
  const meta = STATUS_META[batch.status] || { label: batch.status, color: "bg-gray-100 text-gray-700" };

  const totalAmount = Number(batch.total_amount || 0);
  const matchedAmount = Number(batch.matched_amount || 0);
  const shortAmount = Number(batch.short_amount || 0);
  const variance = totalAmount - matchedAmount - shortAmount;

  return (
    <div className="p-5 border-b border-(--border)">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-(--text-primary)">
              {batch.batch_ref || `Batch #${batch.id}`}
            </h2>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
              {meta.label}
            </span>
          </div>
          <div className="text-xs text-(--text-muted) mt-0.5">
            {batch.courier_name} · imported {batch.imported_at ? fmtLocalDateTime(batch.imported_at) : "—"}
          </div>
        </div>
        <div className="flex items-center gap-2">{children}</div>
      </div>

      {Math.abs(variance) > 0.01 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle size={14} />
          Variance: remitted total ({fmt(totalAmount)}) does not equal matched + short ({fmt(matchedAmount + shortAmount)}). Gap: {fmt(variance)}.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiTile label="Lines" value={batch.total_lines || 0} />
        <KpiTile label="Total Remitted" value={fmt(totalAmount)} />
        <KpiTile label="Matched Count" value={batch.matched_count || 0} tone="green" />
        <KpiTile label="Matched Amount" value={fmt(matchedAmount)} tone="green" />
        <KpiTile label="Unmatched" value={batch.unmatched_count || 0} tone="red" />
        <KpiTile label="Short Amount" value={fmt(shortAmount)} tone="red" />
      </div>
    </div>
  );
}
```

**Step 2: Create BatchDetail.jsx shell**

```jsx
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import api from "../../../api";
import { Button } from "../../../ui/primitives";
import { useToast } from "../../../contexts/ToastContext";
import BatchHeaderCard from "./BatchHeaderCard";

export default function BatchDetail({ batchId, onBack }) {
  const toast = useToast();
  const [batch, setBatch] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/fulfillment/cod/settlements/${batchId}`);
      setBatch(data.batch);
      setLines(data.lines || []);
    } catch (err) {
      toast.error(err.message || "Failed to load batch");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="py-16 text-center text-(--text-muted) text-sm">Loading…</div>;
  }
  if (!batch) {
    return (
      <div className="py-16 text-center">
        <p className="text-(--text-muted) text-sm mb-3">Batch not found</p>
        <Button variant="ghost" onClick={onBack}><ArrowLeft size={14} /> Back to list</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="px-4 pt-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={14} /> Back to list
        </Button>
      </div>

      <BatchHeaderCard batch={batch}>
        {/* State-dependent action buttons — populated in task 13 */}
      </BatchHeaderCard>

      <div className="p-5 text-center text-(--text-muted) text-sm">
        Line table — {lines.length} lines (implemented in task 10)
      </div>
    </div>
  );
}
```

**Step 3: Wire into CODSettlementsRedesign**

```jsx
import BatchDetail from "./cod/BatchDetail";

// ...
{view.name === "detail" && (
  <BatchDetail
    batchId={view.batchId}
    onBack={() => setView({ name: "list" })}
  />
)}
```

**Step 4: Verify**

Manually seed a batch in the DB (or wait until task 17). Click a row in the list → detail view loads with header card. KPIs should render (zeros if no data).

**Step 5: Commit**

```bash
git add frontend/src/pages/redesign/cod/BatchDetail.jsx \
        frontend/src/pages/redesign/cod/BatchHeaderCard.jsx \
        frontend/src/pages/redesign/CODSettlementsRedesign.jsx
git commit -m "feat(cod): batch detail shell with KPI header card"
```

---

## Task 10: Frontend — Line table with tabs

**Files:**
- Create: `frontend/src/pages/redesign/cod/LineTable.jsx`
- Modify: `frontend/src/pages/redesign/cod/BatchDetail.jsx`

**Step 1: Create LineTable.jsx**

```jsx
import { useState } from "react";
import { useCurrency } from "../../../contexts/CurrencyContext";

const TAB_FILTERS = {
  all: null,
  matched: "matched",
  short: "short",
  over: "over",
  unmatched: "unmatched",
  duplicate: "duplicate",
};

const MATCH_PILL = {
  matched: "bg-green-100 text-green-700",
  short: "bg-red-100 text-red-700",
  over: "bg-blue-100 text-blue-700",
  unmatched: "bg-amber-100 text-amber-700",
  duplicate: "bg-purple-100 text-purple-700",
};

export default function LineTable({ lines, readOnly, onResolveNote, onManualMatch }) {
  const { fmt } = useCurrency();
  const [tab, setTab] = useState("all");
  const [editingNoteFor, setEditingNoteFor] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

  const counts = {
    all: lines.length,
    matched: lines.filter((l) => l.match_status === "matched").length,
    short: lines.filter((l) => l.match_status === "short").length,
    over: lines.filter((l) => l.match_status === "over").length,
    unmatched: lines.filter((l) => l.match_status === "unmatched").length,
    duplicate: lines.filter((l) => l.match_status === "duplicate").length,
  };

  const filter = TAB_FILTERS[tab];
  let visible = filter ? lines.filter((l) => l.match_status === filter) : [...lines];

  // Sort by tab
  if (tab === "short" || tab === "over") {
    visible.sort((a, b) => Math.abs(Number(b.difference || 0)) - Math.abs(Number(a.difference || 0)));
  } else if (tab === "unmatched") {
    visible.sort((a, b) => Number(b.remitted_amount || 0) - Number(a.remitted_amount || 0));
  }

  async function saveNote(line) {
    await onResolveNote(line.id, noteDraft);
    setEditingNoteFor(null);
    setNoteDraft("");
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-(--border)">
        {Object.keys(TAB_FILTERS).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-xs font-medium rounded-t-md transition-colors ${
              tab === k
                ? "bg-(--bg-subtle) text-(--text-primary) border-b-2 border-(--accent)"
                : "text-(--text-muted) hover:text-(--text-primary)"
            }`}
          >
            {k.charAt(0).toUpperCase() + k.slice(1)}
            <span className="ml-1 text-[10px] opacity-70">({counts[k]})</span>
          </button>
        ))}
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <div className="py-12 text-center text-(--text-muted) text-sm">No lines in this view.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-(--bg-subtle) text-(--text-muted) uppercase">
              <th className="text-left px-3 py-2">Tracking</th>
              <th className="text-left px-3 py-2">Courier Ref</th>
              <th className="text-left px-3 py-2">Matched Order</th>
              <th className="text-right px-3 py-2">Expected</th>
              <th className="text-right px-3 py-2">Remitted</th>
              <th className="text-right px-3 py-2">Fee</th>
              <th className="text-right px-3 py-2">Difference</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {visible.map((line) => {
              const diff = Number(line.difference || 0);
              const diffColor = diff < 0 ? "text-red-600" : diff > 0 ? "text-blue-600" : "text-(--text-muted)";
              return (
                <tr key={line.id} className="hover:bg-(--bg-subtle)/40">
                  <td className="px-3 py-2 text-(--text-primary) font-mono text-[11px]">{line.courier_tracking_number}</td>
                  <td className="px-3 py-2 text-(--text-muted)">{line.courier_order_ref || "—"}</td>
                  <td className="px-3 py-2 text-(--text-secondary)">{line.external_order_number || "—"}</td>
                  <td className="px-3 py-2 text-right text-(--text-secondary)">
                    {line.expected_amount != null ? fmt(Number(line.expected_amount)) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-(--text-primary)">
                    {fmt(Number(line.remitted_amount || 0))}
                  </td>
                  <td className="px-3 py-2 text-right text-(--text-muted)">
                    {line.courier_fee != null ? fmt(Number(line.courier_fee)) : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${diffColor}`}>
                    {line.expected_amount != null ? fmt(diff) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${MATCH_PILL[line.match_status] || ""}`}>
                      {line.match_status}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-[180px]">
                    {editingNoteFor === line.id ? (
                      <div className="flex gap-1">
                        <input
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          className="grow rounded border border-(--accent) bg-(--bg-input) px-2 py-1 text-xs"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveNote(line);
                            if (e.key === "Escape") setEditingNoteFor(null);
                          }}
                        />
                      </div>
                    ) : line.resolution_note ? (
                      <span title={line.resolution_note} className="text-(--text-secondary) truncate block">
                        {line.resolution_note}
                      </span>
                    ) : (
                      <span className="text-(--text-muted) italic">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!readOnly && (
                      <div className="flex gap-1 justify-end">
                        {line.match_status === "unmatched" && (
                          <button
                            onClick={() => onManualMatch(line)}
                            className="text-(--accent) hover:underline text-[11px]"
                          >
                            Match
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingNoteFor(line.id);
                            setNoteDraft(line.resolution_note || "");
                          }}
                          className="text-(--text-muted) hover:text-(--accent) text-[11px]"
                        >
                          Note
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

**Step 2: Wire into BatchDetail.jsx**

Replace the "Line table — N lines" placeholder with:

```jsx
import LineTable from "./LineTable";

// Add handlers inside BatchDetail:
async function handleResolveNote(lineId, note) {
  try {
    await api.post(`/api/fulfillment/cod/settlements/${batchId}/resolve`, {
      line_id: lineId,
      resolution_note: note,
    });
    toast.success("Note saved");
    load();
  } catch (err) {
    toast.error(err.message || "Failed to save note");
  }
}

function handleManualMatch(line) {
  // Opened in task 11
  toast.warning("Manual match modal pending (task 11)");
}

// Replace the placeholder:
<LineTable
  lines={lines}
  readOnly={batch.status === "approved" || batch.status === "rejected"}
  onResolveNote={handleResolveNote}
  onManualMatch={handleManualMatch}
/>
```

**Step 3: Verify**

Open an existing batch (or create one via task 17's smoke test). Tabs should render with counts, table should show lines, clicking "Note" should open an inline input. "Match" button should show a warning toast.

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/cod/LineTable.jsx \
        frontend/src/pages/redesign/cod/BatchDetail.jsx
git commit -m "feat(cod): tabbed line table with inline note editing"
```

---

## Task 11: Frontend — ManualMatchModal

**Files:**
- Create: `frontend/src/pages/redesign/cod/ManualMatchModal.jsx`
- Modify: `frontend/src/pages/redesign/cod/BatchDetail.jsx`

**Step 1: Create ManualMatchModal.jsx**

```jsx
import { useEffect, useState } from "react";
import { Search, X, AlertTriangle } from "lucide-react";
import api from "../../../api";
import { Button } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useToast } from "../../../contexts/ToastContext";
import { fmtLocalDate } from "../../../utils/dates";

export default function ManualMatchModal({ open, line, onClose, onMatched }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
    // Pre-fill with remitted amount — often the quickest way to find the order
    if (line?.remitted_amount) {
      setQuery(String(Number(line.remitted_amount)));
    }
  }, [open, line]);

  useEffect(() => {
    if (!open || !query) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.get(`/api/web-orders/search?q=${encodeURIComponent(query)}`);
        setResults(data.orders || []);
      } catch (err) {
        toast.error(err.message || "Search failed");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  async function pick(order) {
    setBusy(true);
    try {
      await onMatched(line.id, order.id);
      onClose();
    } catch (err) {
      toast.error(err.message || "Match failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-(--bg-card) border border-(--border) rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--border)">
          <div>
            <h2 className="text-base font-semibold text-(--text-primary)">Match to web order</h2>
            <p className="text-xs text-(--text-muted) mt-0.5">
              Tracking: <span className="font-mono">{line?.courier_tracking_number}</span> · Remitted: {fmt(Number(line?.remitted_amount || 0))}
            </p>
          </div>
          <button onClick={onClose} className="text-(--text-muted) hover:text-(--text-primary)"><X size={18} /></button>
        </div>

        <div className="p-5 border-b border-(--border)">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted)" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Order number, customer name, phone, or exact amount"
              className="w-full rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grow overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-(--text-muted) text-sm">Searching…</div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-(--text-muted) text-sm">
              {query ? "No matching orders" : "Start typing to search"}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-(--bg-subtle) text-(--text-muted) uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Order</th>
                  <th className="text-left px-4 py-2">Customer</th>
                  <th className="text-right px-4 py-2">Total</th>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {results.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2 text-(--text-primary) font-medium">
                      {o.external_order_number || `#${o.id}`}
                    </td>
                    <td className="px-4 py-2 text-(--text-secondary)">
                      {o.customer_name_snapshot || "—"}
                      {o.customer_phone_snapshot && <span className="text-(--text-muted) ml-1">· {o.customer_phone_snapshot}</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-(--text-primary)">{fmt(Number(o.grand_total))}</td>
                    <td className="px-4 py-2 text-(--text-muted)">{o.ordered_at ? fmtLocalDate(o.ordered_at) : "—"}</td>
                    <td className="px-4 py-2 text-(--text-muted)">{o.payment_status}</td>
                    <td className="px-4 py-2 text-right">
                      {o.is_already_matched ? (
                        <div className="flex items-center gap-1 text-amber-600 text-[11px]">
                          <AlertTriangle size={11} /> already matched
                        </div>
                      ) : null}
                      <Button size="sm" disabled={busy} onClick={() => pick(o)}>
                        Pick
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Wire into BatchDetail.jsx**

```jsx
import ManualMatchModal from "./ManualMatchModal";

// Inside BatchDetail:
const [matchingLine, setMatchingLine] = useState(null);

async function onMatched(lineId, webOrderId) {
  await api.post(`/api/fulfillment/cod/settlements/${batchId}/resolve`, {
    line_id: lineId,
    matched_order_id: webOrderId,
    resolution_note: `Manually matched`,
  });
  toast.success("Line matched");
  load();
}

// Replace handleManualMatch:
function handleManualMatch(line) {
  setMatchingLine(line);
}

// At the end of the JSX return:
<ManualMatchModal
  open={!!matchingLine}
  line={matchingLine}
  onClose={() => setMatchingLine(null)}
  onMatched={onMatched}
/>
```

**Step 3: Verify**

Open a batch with unmatched lines. Click "Match" → modal opens pre-filled with the remitted amount → search returns web orders → pick one → toast confirms → detail view reloads and the line is now in the "matched" tab.

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/cod/ManualMatchModal.jsx \
        frontend/src/pages/redesign/cod/BatchDetail.jsx
git commit -m "feat(cod): manual match modal with web order search"
```

---

## Task 12: Frontend — ApproveConfirmModal + wire header action buttons

**Files:**
- Create: `frontend/src/pages/redesign/cod/ApproveConfirmModal.jsx`
- Modify: `frontend/src/pages/redesign/cod/BatchDetail.jsx`

**Step 1: Create ApproveConfirmModal.jsx**

```jsx
import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { Button } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";

export default function ApproveConfirmModal({ open, batch, busy, onCancel, onConfirm }) {
  const { fmt } = useCurrency();
  const [typed, setTyped] = useState("");
  if (!open) return null;

  const enabled = typed.trim() === (batch.batch_ref || `#${batch.id}`);
  const shortCount = batch.unmatched_count || 0;
  const shortAmount = Number(batch.short_amount || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-(--bg-card) border border-(--border) rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--border)">
          <h2 className="text-base font-semibold text-(--text-primary)">Approve settlement batch</h2>
          <button onClick={onCancel} className="text-(--text-muted) hover:text-(--text-primary)"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {shortAmount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                This batch has <strong>{fmt(shortAmount)}</strong> in shortfall
                {shortCount > 0 && ` across ${shortCount} unmatched line(s)`}. Approval finalizes the reconciliation and cannot be undone.
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm text-(--text-secondary) mb-1">
              Type the batch reference to confirm:
            </label>
            <div className="text-xs text-(--text-muted) mb-1 font-mono">{batch.batch_ref || `#${batch.id}`}</div>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="ghost" className="flex-1" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button className="flex-1" onClick={onConfirm} disabled={!enabled || busy}>
              {busy ? "Approving…" : "Confirm approval"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Wire header action buttons in BatchDetail.jsx**

Add to BatchDetail:

```jsx
import { useAuth } from "../../../auth/AuthProvider";
import ApproveConfirmModal from "./ApproveConfirmModal";

// Inside BatchDetail:
const { hasPerm } = useAuth();
const [approveOpen, setApproveOpen] = useState(false);
const [approveBusy, setApproveBusy] = useState(false);
const [rematchBusy, setRematchBusy] = useState(false);

async function runMatch() {
  setRematchBusy(true);
  try {
    await api.post(`/api/fulfillment/cod/settlements/${batchId}/match`, {});
    toast.success("Match re-run");
    load();
  } catch (err) {
    toast.error(err.message || "Match failed");
  } finally {
    setRematchBusy(false);
  }
}

async function confirmApprove() {
  setApproveBusy(true);
  try {
    await api.post(`/api/fulfillment/cod/settlements/${batchId}/approve`, {});
    toast.success("Batch approved");
    setApproveOpen(false);
    load();
  } catch (err) {
    toast.error(err.message || "Approval failed");
  } finally {
    setApproveBusy(false);
  }
}

// Inside <BatchHeaderCard batch={batch}>:
{batch.status === "imported" && (
  <Button disabled={rematchBusy} onClick={runMatch}>
    {rematchBusy ? "Matching…" : "Run match"}
  </Button>
)}
{batch.status === "matching" && (
  <Button disabled>Matching in progress…</Button>
)}
{batch.status === "review" && (
  <>
    <Button variant="ghost" disabled={rematchBusy} onClick={runMatch}>
      Re-run match
    </Button>
    {hasPerm("all_access") ? (
      <Button onClick={() => setApproveOpen(true)}>Approve batch</Button>
    ) : (
      <Button disabled title="Admin only">Approve batch</Button>
    )}
  </>
)}

// Modal at the bottom of the return:
<ApproveConfirmModal
  open={approveOpen}
  batch={batch}
  busy={approveBusy}
  onCancel={() => setApproveOpen(false)}
  onConfirm={confirmApprove}
/>
```

**Step 3: Verify**

Create a batch in `review` state (via import+match or manual seed). As admin, click "Approve batch" → modal opens → type the batch ref → button enables → click confirm → success toast → batch flips to `approved` status and actions hide.

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/cod/ApproveConfirmModal.jsx \
        frontend/src/pages/redesign/cod/BatchDetail.jsx
git commit -m "feat(cod): approve batch flow with confirmation modal"
```

---

## Task 13: Frontend — Extend existing COD integration test suite in Playwright smoke

**Files:**
- Modify: `frontend/tests/smoke/phase5-pakistan.smoke.spec.js`

**Step 1: Extend the existing spec**

Grep `frontend/tests/smoke/phase5-pakistan.smoke.spec.js` for the COD settlements test and replace its assertion-only body with a full flow:

```javascript
test("COD settlements — full import/match/approve flow", async ({ page, request }) => {
  // Seed a courier + a matching web_order via API
  // (use existing helpers from frontend/tests/smoke/helpers/)

  // 1. Navigate to /cod-settlements
  await page.goto("/cod-settlements");
  await expect(page.getByRole("heading", { name: /COD Settlements/i })).toBeVisible();

  // 2. Click Import new batch
  await page.getByRole("button", { name: /Import new batch/i }).click();

  // 3. Pick a courier
  await page.getByRole("combobox").first().selectOption({ index: 1 });
  await page.getByRole("button", { name: /Next/i }).click();

  // 4. Upload a tiny CSV
  const csvContent = "Tracking,Amount\nTRK-001,500.00\nTRK-002,750.00";
  const buffer = Buffer.from(csvContent);
  await page.setInputFiles('input[type="file"]', {
    name: "test.csv",
    mimeType: "text/csv",
    buffer,
  });

  // 5. Map columns
  await page.getByRole("combobox").nth(1).selectOption("Tracking"); // first-row header
  await page.getByRole("combobox").nth(2).selectOption("Amount");
  await page.getByRole("button", { name: /Next/i }).click();

  // 6. Confirm
  await page.getByPlaceholder(/Week of/i).fill("Smoke test batch");
  await page.getByRole("button", { name: /Import & Match/i }).click();

  // 7. Should land on detail view
  await expect(page.getByText(/Smoke test batch/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/review/i)).toBeVisible();

  // Teardown: navigate back and delete via API if possible, otherwise leave the batch
  // (The test tenant is packagesmall — batches accumulate but are harmless)
});
```

If the existing spec already has a COD test, extend it rather than adding a new one. Match the existing file's helper usage and teardown patterns.

**Step 2: Run the smoke locally**

```bash
cd frontend && npx playwright test tests/smoke/phase5-pakistan.smoke.spec.js -g "COD settlements"
```

Expected: PASS.

**Step 3: Commit**

```bash
git add frontend/tests/smoke/phase5-pakistan.smoke.spec.js
git commit -m "test(cod): smoke cover full import/match flow"
```

---

## Task 14: Backend — Integration test for full import → match → approve flow

**Files:**
- Modify: `backend/tests/integration/cod-settlements.test.js`

**Step 1: Add the end-to-end test**

Append to the existing file:

```javascript
describe("full flow", () => {
  test("import → match → manual match unmatched → approve", async () => {
    // Seed a web order that will auto-match
    await db.query(
      `INSERT INTO web_orders (id, source, external_order_id, external_order_number, grand_total, payment_status, tracking_number)
       VALUES (900, 'manual', 'E2E-900', 'E2E-900', 500.00, 'pending', 'TRK-AUTO')
       ON CONFLICT (id) DO UPDATE SET tracking_number = 'TRK-AUTO', grand_total = 500.00`
    );

    // Seed another for manual match
    await db.query(
      `INSERT INTO web_orders (id, source, external_order_id, external_order_number, grand_total, payment_status)
       VALUES (901, 'manual', 'E2E-901', 'E2E-901', 300.00, 'pending')
       ON CONFLICT (id) DO UPDATE SET grand_total = 300.00`
    );

    // 1. Import
    const importRes = await request(app)
      .post("/api/fulfillment/cod/settlements/import")
      .set(authHeaders)
      .send({
        courier_id: 1,
        batch_ref: "E2E-BATCH",
        lines: [
          { courier_tracking_number: "TRK-AUTO", remitted_amount: 500, courier_fee: 25 },
          { courier_tracking_number: "TRK-UNKNOWN", remitted_amount: 300, courier_fee: 15 },
        ],
      });
    expect(importRes.status).toBe(200);
    const batchId = importRes.body.batch.id;

    // 2. Match
    const matchRes = await request(app)
      .post(`/api/fulfillment/cod/settlements/${batchId}/match`)
      .set(authHeaders)
      .send({});
    expect(matchRes.status).toBe(200);

    // Verify auto-match result
    const { rows: lines1 } = await db.query(
      "SELECT match_status, matched_order_id FROM cod_settlement_lines WHERE batch_id = $1 ORDER BY id",
      [batchId]
    );
    expect(lines1[0].match_status).toBe("matched");
    expect(lines1[0].matched_order_id).toBe(900);
    expect(lines1[1].match_status).toBe("unmatched");

    // 3. Manual match the unmatched line
    const resolveRes = await request(app)
      .post(`/api/fulfillment/cod/settlements/${batchId}/resolve`)
      .set(authHeaders)
      .send({
        line_id: lines1[1].id || (await db.query("SELECT id FROM cod_settlement_lines WHERE batch_id = $1 AND match_status = 'unmatched'", [batchId])).rows[0].id,
        matched_order_id: 901,
        resolution_note: "e2e manual",
      });
    expect(resolveRes.status).toBe(200);

    // 4. Approve — needs admin auth
    const { authHeaders: adminHeaders } = await createTestApp({
      employeeRole: "administrator",
    });
    const approveRes = await request(app)
      .post(`/api/fulfillment/cod/settlements/${batchId}/approve`)
      .set(adminHeaders)
      .send({});
    expect(approveRes.status).toBe(200);

    const { rows: [finalBatch] } = await db.query(
      "SELECT status, approved_by, approved_at FROM cod_settlement_batches WHERE id = $1",
      [batchId]
    );
    expect(finalBatch.status).toBe("approved");
    expect(finalBatch.approved_at).not.toBeNull();
  });
});
```

**Step 2: Run**

Run: `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js`
Expected: all tests PASS.

**Step 3: Commit**

```bash
git add backend/tests/integration/cod-settlements.test.js
git commit -m "test(cod): end-to-end import→match→resolve→approve flow"
```

---

## Task 15: Documentation — Update CLAUDE.md and DOMAIN-MAP.md

**Files:**
- Modify: `CLAUDE.md` (root) — add COD settlements to the Integrations section
- Modify: `DOMAIN-MAP.md` — add new domain row
- Modify: `backend/CLAUDE.md` — add fulfillment COD route reference to "Where to Look Instead"

**Step 1: Update `CLAUDE.md`**

Under the `## Integrations` section (search for "Courier dispatch"), add:

```markdown
- **COD Settlements**: `routes/fulfillment.js` has 6 endpoints for courier cash reconciliation (`/api/fulfillment/cod/settlements/*`). Flow: import CSV → auto-match against web_orders by tracking number → review shorts/overs/unmatched → admin approves. Manual match via `/resolve` with `matched_order_id`. CSV column mapping saved per courier via `PATCH /api/couriers/:id/csv-mapping`. Permission split: `manage_orders` for import/match/resolve, `all_access` for approve (maker-checker). Feature-flagged on `phase5_cod_reconciliation`. Frontend: `/cod-settlements` (`CODSettlementsRedesign.jsx`).
```

**Step 2: Update `DOMAIN-MAP.md`**

Find the domains table and add:

```markdown
| COD Settlements | `routes/fulfillment.js` (cod section) | `pages/redesign/CODSettlementsRedesign.jsx` | `cod_settlement_batches`, `cod_settlement_lines` |
```

Mirror whatever column structure the existing table uses.

**Step 3: Update `backend/CLAUDE.md`**

Under "Where to Look Instead", the fulfillment line already mentions couriers — add COD note:

```markdown
| Fulfillment (picklists, loadsheets, COD settlements) | `routes/fulfillment.js` |
```

**Step 4: Commit**

```bash
git add CLAUDE.md DOMAIN-MAP.md backend/CLAUDE.md
git commit -m "docs(cod): document COD settlements feature"
```

---

## Post-plan verification checklist

Before declaring done, verify all of the following:

1. `DATABASE_URL=<test-url> npx jest backend/tests/integration/cod-settlements.test.js` — all tests pass
2. `cd frontend && npx playwright test tests/smoke/phase5-pakistan.smoke.spec.js -g "COD"` — smoke passes
3. `cd frontend && npm run build` — production build succeeds (no TS/lint errors)
4. Manual UI walkthrough in dev:
   - `/cod-settlements` loads, shows empty list
   - Import wizard: pick courier → upload CSV → map → preview → import
   - Detail view: tabs render with counts, notes edit inline, manual match opens modal
   - As non-admin: approve button is disabled
   - As admin: approve button opens confirmation modal, type-ref unlocks confirm
   - After approve: all action buttons hide, batch is read-only
5. Feature flag off → `/cod-settlements` redirects to `/`
6. Nav entry appears for users with `manage_orders`, hidden otherwise

## Out of scope (do not implement)

- Ledger posting on approve
- Reject/reopen batch states
- Bulk line actions
- CSV export of a batch (one-line follow-up for later)
- Email notifications on batch state changes
- Hardcoded per-courier parsers

## Open questions for executing engineer

None. If something is unclear, check the design doc at [2026-04-11-cod-settlements-ui-design.md](./2026-04-11-cod-settlements-ui-design.md) first. If still unclear, stop and ask rather than guessing.
