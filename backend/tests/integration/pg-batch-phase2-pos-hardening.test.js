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

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

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
  // H1 — smart-collections created_at rule field rejected; sort alias real
  // ───────────────────────────────────────────────────────────────
  //
  // Batch 3A's original H1 fix stripped `created_at` from both the Zod
  // rule enum and the buildRuleQuery switch, because the products table
  // didn't have a created_at column at all — the rule couldn't produce
  // valid SQL. The sort alias `created_at_desc` survived as a workaround
  // pointing at `p.id DESC`.
  //
  // DB-1 (migration v30) adds the real products.created_at column, so
  // the sort alias now references a real column. The rule *field* stays
  // rejected — filtering smart collections by creation date isn't a
  // product requirement, and ruleSchema.field purposefully excludes it
  // to avoid reopening the original SQL surface.
  //
  // Post-DB-1 semantics:
  //   (a) POST with rules[].field='created_at' → 400 (Zod enum)
  //   (b) Legacy DB row with field='created_at' → silently dropped by
  //       buildRuleQuery's `default: continue` (no SQL error)
  //   (c) POST with sort_order='created_at_desc' → ORDER BY the real
  //       column, with p.id DESC as tie-break for determinism
  describe("H1 — smart-collections rule field='created_at' rejected; sort alias backed by real column", () => {
    it("rejects POST with rule field='created_at' at Zod layer (400)", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/smart-collections")
        .send({
          name: "Should fail",
          disjunctive: false,
          sort_order: "manual",
          rules: [{ field: "created_at", operator: "greater_than", value: "2025-01-01" }],
        });

      // validate() middleware returns 400 for enum mismatch. The rule
      // field stays excluded even after v30 — see header comment.
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

    it("sort_order='created_at_desc' orders products by products.created_at DESC (DB-1 item 2)", async () => {
      // Post-v30 assertion: the sortMap alias in smart-collections.js:116
      // now references the real products.created_at column. Set two
      // seeded products to distinctive timestamps so the DESC ordering
      // is observable. The explicit tie-break on p.id DESC (also in the
      // sortMap) means ties fall back to id order — but here the
      // timestamps differ, so id tie-break isn't exercised.
      await db.query(
        "UPDATE products SET created_at = NOW() - INTERVAL '10 minutes' WHERE id = 1"
      );
      await db.query(
        "UPDATE products SET created_at = NOW() WHERE id = 2"
      );

      // Rule matches both products (all seeded rows have status='active').
      const createRes = await makeRequest(app, ADMIN_ID)
        .post("/api/smart-collections")
        .send({
          name: "created_at sort regression",
          disjunctive: false,
          sort_order: "created_at_desc",
          rules: [{ field: "status", operator: "equals", value: "active" }],
        });
      expect(createRes.status).toBe(201);
      const collectionId = createRes.body.collection.id;

      // GET the hydrated collection — the products array is sorted
      // server-side via the sortMap ORDER BY clause.
      const getRes = await makeRequest(app, ADMIN_ID).get(
        `/api/smart-collections/${collectionId}`
      );
      expect(getRes.status).toBe(200);
      const productIds = getRes.body.collection.products.map((p) => p.id);

      // Product 2 (NOW()) must appear before product 1 (NOW() - 10min).
      // Other seeded products (3, 4, 5) all tied on NOW() from seed time
      // and fall back to p.id DESC, so they sit between 2 and 1 in an
      // unspecified-but-deterministic order. The key assertion is that
      // 2 is strictly earlier in the list than 1.
      const idxTwo = productIds.indexOf(2);
      const idxOne = productIds.indexOf(1);
      expect(idxTwo).toBeGreaterThanOrEqual(0);
      expect(idxOne).toBeGreaterThanOrEqual(0);
      expect(idxTwo).toBeLessThan(idxOne);
    });
  });
});
