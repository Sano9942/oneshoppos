/**
 * pg-batch-phase2-pos-hardening.test.js — Wave 3 Batch 3A regression coverage
 *
 * Covers three Phase 2 findings closed in review-fixes branch:
 *
 *   C1 — draft-orders /complete returned the draft object fetched BEFORE the
 *        status UPDATE, so callers saw status='claimed' despite the row
 *        already being 'completed'. Fix: UPDATE ... RETURNING *.
 *
 *   C2 — /api/approvals/pos-authorize had no requireFeature gate and the
 *        employee lookup SELECTed all employees (no deleted_at filter), so
 *        soft-deleted employees' PINs still authorized POS overrides AND
 *        tenants without the phase2_pos_approvals flag could use the
 *        endpoint. Fix: add requireFeature + WHERE e.deleted_at IS NULL.
 *
 *   H1 — smart_collections rule field='created_at' mapped to p.created_at,
 *        but the products table has no created_at column. Zod accepted it
 *        and buildRuleQuery produced invalid SQL at GET time. Fix: remove
 *        from Zod enum AND from buildRuleQuery switch.
 *
 * These tests fail-closed: each one hits a real DB and asserts response
 * shape or status, not mock return values.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

jest.setTimeout(60000);

describe("Wave 3 Batch 3A — Phase 2 POS hardening", () => {
  let app;
  let db;
  let cleanup;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Mount all three routes under test.
    require("../../routes/draft-orders")(app, ctx.deps);
    require("../../routes/approval-policies")(app, ctx.deps);
    require("../../routes/smart-collections")(app, ctx.deps);

    // Seed the three feature flags these routes gate on. The default
    // createTestApp feature flag set does not include any phase2_* flags.
    for (const key of [
      "phase2_draft_orders",
      "phase2_pos_approvals",
      "phase2_smart_collections",
    ]) {
      await db.query(
        "INSERT INTO feature_flags (key, enabled) VALUES ($1, true) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled",
        [key]
      );
    }
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ───────────────────────────────────────────────────────────────
  // C1 — draft-orders /complete returns fresh draft
  // ───────────────────────────────────────────────────────────────
  describe("C1 — POST /api/draft-orders/:id/complete returns fresh status", () => {
    it("returns draftOrder.status='completed', not the pre-update 'claimed' value", async () => {
      // Create a draft as admin (id=1), then claim it as the same admin.
      const req = makeRequest(app, ADMIN_ID);

      const createRes = await req
        .post("/api/draft-orders")
        .send({
          outlet_id: 1,
          notes: "C1 regression",
          items: [
            { product_id: 1, product_name: "Widget A", quantity: 1, price: 100 },
          ],
        });
      expect(createRes.status).toBe(201);
      const draftId = createRes.body.draftOrder.id;
      expect(createRes.body.draftOrder.status).toBe("open");

      const claimRes = await req.post(`/api/draft-orders/${draftId}/claim`);
      expect(claimRes.status).toBe(200);
      expect(claimRes.body.draftOrder.status).toBe("claimed");

      const completeRes = await req.post(`/api/draft-orders/${draftId}/complete`);
      expect(completeRes.status).toBe(200);

      // The critical assertion: response.draftOrder.status must reflect
      // the post-UPDATE state, not the pre-UPDATE 'claimed' value.
      expect(completeRes.body.completed).toBe(true);
      expect(completeRes.body.draftOrder).toBeDefined();
      expect(completeRes.body.draftOrder.status).toBe("completed");
      expect(completeRes.body.draftOrder.id).toBe(draftId);

      // And the DB row is genuinely completed too (defense in depth).
      const { rows } = await db.query(
        "SELECT status FROM draft_orders WHERE id = $1",
        [draftId]
      );
      expect(rows[0].status).toBe("completed");
    });
  });

  // ───────────────────────────────────────────────────────────────
  // C2 — pos-authorize security
  // ───────────────────────────────────────────────────────────────
  describe("C2 — POST /api/approvals/pos-authorize security", () => {
    it("returns 503 when phase2_pos_approvals feature flag is disabled", async () => {
      // Turn the flag off for this test, restore at end.
      await db.query(
        "UPDATE feature_flags SET enabled = false WHERE key = 'phase2_pos_approvals'"
      );

      try {
        const res = await makeRequest(app, ADMIN_ID)
          .post("/api/approvals/pos-authorize")
          .send({ action_type: "manual_discount", manager_pin: "2580" });

        expect(res.status).toBe(503);
        expect(res.body.flag).toBe("phase2_pos_approvals");
      } finally {
        await db.query(
          "UPDATE feature_flags SET enabled = true WHERE key = 'phase2_pos_approvals'"
        );
      }
    });

    it("rejects PINs of soft-deleted employees (security fix)", async () => {
      // Seed a second admin-role employee whose PIN we'll then soft-delete.
      const bcrypt = require("bcryptjs");
      const pinHash = await bcrypt.hash("9999", 4);

      const { rows: [terminated] } = await db.query(
        `INSERT INTO employees (name, role, pin_code, pin_hash, role_id, monthly_salary)
         VALUES ('Terminated Admin', 'Administrator', '9999', $1, 1, 50000)
         RETURNING id`,
        [pinHash]
      );

      // Confirm the PIN works BEFORE soft-delete (sanity check: without this,
      // a broken test setup could false-negative — "rejected" would be correct
      // by accident).
      const beforeRes = await makeRequest(app, ADMIN_ID)
        .post("/api/approvals/pos-authorize")
        .send({ action_type: "manual_discount", manager_pin: "9999" });
      expect(beforeRes.status).toBe(200);
      expect(beforeRes.body.authorized).toBe(true);
      expect(beforeRes.body.approver.id).toBe(terminated.id);

      // Now soft-delete and try again — must be rejected.
      await db.query(
        "UPDATE employees SET deleted_at = NOW() WHERE id = $1",
        [terminated.id]
      );

      const afterRes = await makeRequest(app, ADMIN_ID)
        .post("/api/approvals/pos-authorize")
        .send({ action_type: "manual_discount", manager_pin: "9999" });
      expect(afterRes.status).toBe(401);
      expect(afterRes.body.error).toMatch(/Invalid manager PIN/i);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // H1 — smart-collections created_at removed
  // ───────────────────────────────────────────────────────────────
  describe("H1 — smart-collections rule field='created_at' removed", () => {
    it("rejects POST with rule field='created_at' at Zod layer (400)", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/smart-collections")
        .send({
          name: "Should fail",
          disjunctive: false,
          sort_order: "manual",
          rules: [{ field: "created_at", operator: "greater_than", value: "2025-01-01" }],
        });

      // validate() middleware returns 400 for enum mismatch.
      expect(res.status).toBe(400);
    });

    it("silently drops legacy created_at rule rows in GET response (no SQL error)", async () => {
      // Insert a smart_collection with a VALID rule so the INSERT succeeds,
      // then directly insert a legacy created_at rule row bypassing Zod.
      // This simulates pre-fix data that made it into the DB before the
      // enum was tightened.
      const { rows: [collection] } = await db.query(
        `INSERT INTO smart_collections (name, disjunctive, sort_order)
         VALUES ('Legacy test', false, 'manual') RETURNING id`
      );

      await db.query(
        `INSERT INTO smart_collection_rules (collection_id, field, operator, value)
         VALUES ($1, 'status', 'equals', 'active')`,
        [collection.id]
      );
      await db.query(
        `INSERT INTO smart_collection_rules (collection_id, field, operator, value)
         VALUES ($1, 'created_at', 'greater_than', '2025-01-01')`,
        [collection.id]
      );

      // GET should return 200 (not 500 with "column p.created_at does not exist")
      // and the created_at rule should be silently dropped from the WHERE
      // clause by the `default: continue` branch in buildRuleQuery.
      const res = await makeRequest(app, ADMIN_ID).get(
        `/api/smart-collections/${collection.id}`
      );

      expect(res.status).toBe(200);
      expect(res.body.collection.rules).toHaveLength(2); // both rules still readable
      expect(Array.isArray(res.body.collection.products)).toBe(true);
      // The key assertion: products query did not throw.
    });
  });
});
