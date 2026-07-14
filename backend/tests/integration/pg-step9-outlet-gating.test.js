/**
 * PLAN-V2 Step 9 (D1c) — shared outlet resolver + outlet-aware enforcement.
 *
 * Covers the owner-approved design matrix:
 *  - resolver precedence (validated x-outlet-id header → JWT oid → none)
 *  - validation failures: malformed (400), foreign/inactive (403),
 *    unassigned for non-all_access (403 OUTLET_NOT_ASSIGNED)
 *  - outlet-scoped gating: disabled outlet → 403 outlet_scoped:true;
 *    enabled outlet → 200; oid resolution (not company fallback)
 *  - fail-closed: no outlet resolved → non-admin 403 OUTLET_CONTEXT_REQUIRED,
 *    all_access company-level fallback (Ruling 1)
 *  - companyLevel allowlist marker (Ruling 2)
 *  - tenant-scoped flags never outlet-gated
 *  - Step 8 both toggle shapes take effect through the middleware cache
 *  - outlet-assignment enforcement behavior preserved (query/body ids)
 *  - worker per-outlet filtering: getDisabledOutletIds + four representative
 *    workers (hold-expiry, reservation-reminder, booking-reminders,
 *    rental-overdue); the remaining filtered workers share the exact same
 *    helper + deny-list mechanics.
 *
 * Harness note: employee auth is header-based (x-employee-id); the JWT oid
 * path is simulated via a req.jwtOid shim mounted before the resolver —
 * exactly the field loadTenantAndPerms now sets in production.
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, MANAGER_ID } = require("../helpers/request");

const featureFlags = require("../../middleware/feature-flags");
const outletContext = require("../../middleware/outlet-context");
const bm = require("../../services/business-modules");

let app, db, deps, cleanup;
let currentJwtOid = null;

const noopLogger = { info() {}, warn() {}, error() {}, child() { return this; } };

function invalidateAll() {
  featureFlags.invalidateFeatureFlagCache();
  featureFlags.invalidateModeCache();
  outletContext.invalidateOutletCache();
}

beforeAll(async () => {
  ({ app, db, deps, cleanup } = await createTestApp());

  // The rentals route file (and the custom routes below) import the REAL
  // middleware/feature-flags + the resolver — wire both to the test schema.
  featureFlags.init({ db, IS_MULTI_TENANT: false });
  outletContext.init({ db, IS_MULTI_TENANT: false });

  // JWT oid shim — production sets req.jwtOid in loadTenantAndPerms.
  app.use((req, _res, next) => {
    req.jwtOid = currentJwtOid;
    next();
  });
  app.use(outletContext.resolveOutletContext());
  app.use(outletContext.enforceOutletAssignment());

  require("../../routes/rentals")(app, deps);

  // Custom probes for cases the rentals gate can't express.
  const { requireFeature } = featureFlags;
  app.get("/api/_test/tenant-flag", requireFeature("crm_quotations"), (req, res) =>
    res.json({ ok: true })
  );
  app.get(
    "/api/_test/company-level",
    requireFeature("phase4_rentals", { companyLevel: true }),
    (req, res) => res.json({ ok: true })
  );
  app.get("/api/_test/plain", (req, res) => res.json({ ok: true }));

  // The harness Manager role doesn't carry the vertical perms — grant
  // manage_rentals so the non-admin gating paths exercise the outlet layer,
  // not requirePerm.
  await db.query(
    `INSERT INTO role_permissions (role_id, permission) VALUES (2, 'manage_rentals')`
  );

  // Company-level state: Rentals ON (flag + mode row so requireMode is in
  // its normal enforcing posture, not the empty-map fall-through).
  await db.query(`
    INSERT INTO feature_flags (key, enabled) VALUES
      ('phase4_rentals', true),
      ('phase4_restaurant_reservations', true),
      ('phase4_appointments', true),
      ('phase2g_holds', true)
    ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled
  `);
  await db.query(`
    INSERT INTO tenant_modes (mode, enabled) VALUES ('rentals', true)
    ON CONFLICT (mode) DO UPDATE SET enabled = EXCLUDED.enabled
  `);

  // Per-outlet state: Rentals OFF at outlet 2 (explicit override), outlet 1
  // inherits the sparse-row TRUE default.
  await db.query(
    `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled)
     VALUES (2, 'rentals', false)`
  );
  invalidateAll();
});

afterAll(async () => {
  invalidateAll();
  if (cleanup) await cleanup();
});

afterEach(() => {
  currentJwtOid = null;
});

describe("resolver precedence + validation", () => {
  it("valid assigned header outlet resolves and passes the gate (200)", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "1");
    expect(res.status).toBe(200);
  });

  it("malformed header ('abc') → 400 INVALID_OUTLET_CONTEXT, never silent fallback", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "abc");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_OUTLET_CONTEXT");
  });

  it("malformed header ('-1') → 400 INVALID_OUTLET_CONTEXT", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "-1");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_OUTLET_CONTEXT");
  });

  it("foreign outlet id → 403 INVALID_OUTLET_CONTEXT (no existence leak)", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "9999");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INVALID_OUTLET_CONTEXT");
  });

  it("unassigned outlet header for non-all_access staff → 403 OUTLET_NOT_ASSIGNED", async () => {
    // Manager (id 2) is assigned outlet 1 only.
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "2");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OUTLET_NOT_ASSIGNED");
  });

  it("no header + JWT oid resolves via oid — NOT company fallback (403 at disabled outlet)", async () => {
    currentJwtOid = 2;
    const res = await makeRequest(app, ADMIN_ID).get("/api/rental-contracts");
    expect(res.status).toBe(403);
    expect(res.body.outlet_scoped).toBe(true);
    expect(res.body.outlet_id).toBe(2);
  });

  it("stale JWT oid (deleted outlet) degrades to none — all_access gets company level", async () => {
    currentJwtOid = 9999;
    const res = await makeRequest(app, ADMIN_ID).get("/api/rental-contracts");
    expect(res.status).toBe(200);
  });
});

describe("outlet-scoped gating (requireMode + requireFeature layer)", () => {
  it("disabled outlet → 403 with outlet_scoped:true + outlet_id", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "2");
    expect(res.status).toBe(403);
    expect(res.body.outlet_scoped).toBe(true);
    expect(res.body.outlet_id).toBe(2);
    // The rentals gate leads with requireMode — the refusal names the mode.
    expect(res.body.mode).toBe("rentals");
  });

  it("enabled outlet (sparse-row default TRUE) → 200", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "1");
    expect(res.status).toBe(200);
  });

  it("fail-closed: no outlet resolved, non-all_access → 403 OUTLET_CONTEXT_REQUIRED", async () => {
    const res = await makeRequest(app, MANAGER_ID).get("/api/rental-contracts");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OUTLET_CONTEXT_REQUIRED");
  });

  it("Ruling 1: no outlet resolved, all_access → company-level fallback (200)", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/rental-contracts");
    expect(res.status).toBe(200);
  });

  it("tenant-scoped flags are never outlet-gated", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/_test/tenant-flag")
      .set("x-outlet-id", "2");
    expect(res.status).toBe(200);
  });

  it("Ruling 2: companyLevel call sites evaluate company state even at a disabled outlet", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/_test/company-level")
      .set("x-outlet-id", "2");
    expect(res.status).toBe(200);
  });
});

describe("Step 8 toggle shapes flow through the middleware cache", () => {
  it("default_outlet_enabled=false gates unlisted outlets; an explicit override wins; clear re-inherits", async () => {
    // Shape 2: default false — outlet 1 (no override) goes dark.
    const r1 = await bm.setOutletModuleState(db, {
      key: "rentals",
      defaultOutletEnabled: false,
      actor: "step9-test",
    });
    expect(r1.status).toBe(200);
    let res = await makeRequest(app, ADMIN_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "1");
    expect(res.status).toBe(403);
    expect(res.body.outlet_scoped).toBe(true);

    // Shape 1: explicit override true at outlet 1 beats the false default.
    const r2 = await bm.setOutletModuleState(db, {
      key: "rentals",
      outletId: 1,
      enabled: true,
      actor: "step9-test",
    });
    expect(r2.status).toBe(200);
    res = await makeRequest(app, ADMIN_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "1");
    expect(res.status).toBe(200);

    // Clear (enabled:null) re-inherits the (false) default.
    const r3 = await bm.setOutletModuleState(db, {
      key: "rentals",
      outletId: 1,
      enabled: null,
      actor: "step9-test",
    });
    expect(r3.status).toBe(200);
    res = await makeRequest(app, ADMIN_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "1");
    expect(res.status).toBe(403);

    // Restore: default back to true.
    const r4 = await bm.setOutletModuleState(db, {
      key: "rentals",
      defaultOutletEnabled: true,
      actor: "step9-test",
    });
    expect(r4.status).toBe(200);
    res = await makeRequest(app, ADMIN_ID)
      .get("/api/rental-contracts")
      .set("x-outlet-id", "1");
    expect(res.status).toBe(200);
  });
});

describe("outlet-assignment enforcement (behavior-preserving refactor)", () => {
  it("non-admin with an unassigned explicit ?outlet_id= param → 403 (legacy message kept)", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/_test/plain")
      .query({ outlet_id: 2 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not assigned to this employee account/);
  });

  it("non-admin with an assigned ?outlet_id= param → 200", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/_test/plain")
      .query({ outlet_id: 1 });
    expect(res.status).toBe(200);
  });

  it("all_access bypasses enforcement exactly as before", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/_test/plain")
      .query({ outlet_id: 2 });
    expect(res.status).toBe(200);
  });
});

describe("worker per-outlet filtering", () => {
  it("getDisabledOutletIds: override + default matrix", async () => {
    // rentals: outlet 2 override false (seeded) → [2]
    expect(await bm.getDisabledOutletIds(db, "rentals")).toEqual([2]);
    // holds_layaway: nothing set → []
    expect(await bm.getDisabledOutletIds(db, "holds_layaway")).toEqual([]);
    // default false with no overrides → every store outlet disabled
    await db.query(
      `INSERT INTO tenant_business_modules (module_key, enabled, default_outlet_enabled)
       VALUES ('holds_layaway', true, false)
       ON CONFLICT (module_key) DO UPDATE SET default_outlet_enabled = EXCLUDED.default_outlet_enabled`
    );
    expect(await bm.getDisabledOutletIds(db, "holds_layaway")).toEqual([1, 2]);
    // an explicit true override re-enables one outlet
    await db.query(
      `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled)
       VALUES (1, 'holds_layaway', true)`
    );
    expect(await bm.getDisabledOutletIds(db, "holds_layaway")).toEqual([2]);
    // tenant-scoped card is never filtered
    expect(await bm.getDisabledOutletIds(db, "gift_cards")).toEqual([]);
    // reset for the hold-expiry test below (it seeds its own override)
    await db.query(`DELETE FROM outlet_business_modules WHERE module_key = 'holds_layaway'`);
    await db.query(`DELETE FROM tenant_business_modules WHERE module_key = 'holds_layaway'`);
  });

  it("hold-expiry: holds at a disabled outlet freeze in place", async () => {
    const { sweepTenant } = require("../../workers/hold-expiry-worker-boss");
    await db.query(`
      INSERT INTO holds (hold_number, outlet_id, status, total_amount, balance_due, hold_until)
      VALUES ('S9-H1', 1, 'active', 100, 100, NOW() - INTERVAL '1 hour'),
             ('S9-H2', 2, 'active', 100, 100, NOW() - INTERVAL '1 hour')
    `);
    await db.query(
      `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled)
       VALUES (2, 'holds_layaway', false)`
    );
    const flipped = await sweepTenant(db, noopLogger, "step9");
    expect(flipped).toBe(1);
    const { rows } = await db.query(
      `SELECT hold_number, status FROM holds WHERE hold_number IN ('S9-H1','S9-H2') ORDER BY hold_number`
    );
    expect(rows[0].status).toBe("forfeit"); // outlet 1 — processed
    expect(rows[1].status).toBe("active");  // outlet 2 — frozen
  });

  it("reservation-reminder: reservations at a disabled outlet are not considered", async () => {
    const { runOnce } = require("../../workers/reservation-reminder-worker-boss");
    await db.query(`
      INSERT INTO reservations (customer_name, phone, party_size, reservation_start, outlet_id, status)
      VALUES ('S9-A', '+920000000001', 2, NOW() + INTERVAL '2 hours', 1, 'confirmed'),
             ('S9-B', '+920000000002', 2, NOW() + INTERVAL '2 hours', 2, 'confirmed')
    `);
    await db.query(
      `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled)
       VALUES (2, 'restaurant', false)`
    );
    const result = await runOnce(db);
    expect(result.considered).toBe(1);
  });

  it("booking-reminders: reminders for a disabled outlet stay pending", async () => {
    const { processPendingReminders } = require("../../services/booking-reminders");
    const { rows: [svc] } = await db.query(
      `INSERT INTO booking_services (name) VALUES ('S9 Service') RETURNING id`
    );
    const { rows: [a1] } = await db.query(
      `INSERT INTO appointments (service_id, outlet_id, status, start_at, end_at, customer_name, customer_email)
       VALUES ($1, 1, 'confirmed', NOW() + INTERVAL '1 day', NOW() + INTERVAL '25 hours', 'S9 One', 'one@s9.test')
       RETURNING id`,
      [svc.id]
    );
    const { rows: [a2] } = await db.query(
      `INSERT INTO appointments (service_id, outlet_id, status, start_at, end_at, customer_name, customer_email)
       VALUES ($1, 2, 'confirmed', NOW() + INTERVAL '1 day', NOW() + INTERVAL '25 hours', 'S9 Two', 'two@s9.test')
       RETURNING id`,
      [svc.id]
    );
    await db.query(
      `INSERT INTO appointment_reminders (appointment_id, channel, status, scheduled_for)
       VALUES ($1, 'email', 'pending', NOW() - INTERVAL '1 minute'),
              ($2, 'email', 'pending', NOW() - INTERVAL '1 minute')`,
      [a1.id, a2.id]
    );
    await db.query(
      `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled)
       VALUES (2, 'appointments', false)`
    );
    const boss = { send: async () => {} };
    const processed = await processPendingReminders(db, boss, "step9");
    expect(processed).toBe(1);
    const { rows } = await db.query(
      `SELECT appointment_id, status FROM appointment_reminders WHERE appointment_id IN ($1, $2) ORDER BY appointment_id`,
      [a1.id, a2.id]
    );
    expect(rows.find((r) => r.appointment_id === a1.id).status).toBe("sent");
    expect(rows.find((r) => r.appointment_id === a2.id).status).toBe("pending");
  });

  it("rental-overdue: contracts at a disabled outlet are skipped", async () => {
    const { checkOverdueForTenant } = require("../../workers/rental-overdue-worker-boss");
    const rentals = require("../../services/rental-service");
    await db.query(`
      INSERT INTO rental_contracts (contract_number, created_by, status, rental_start, expected_return, outlet_id)
      VALUES ('S9-RC1', 1, 'checked_out', NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days', 1),
             ('S9-RC2', 1, 'checked_out', NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days', 2)
    `);
    // rentals is already OFF at outlet 2 via the beforeAll override.
    const count = await checkOverdueForTenant(
      db, noopLogger, "step9", "Step9", async () => {}, rentals
    );
    expect(count).toBe(1);
    const { rows } = await db.query(
      `SELECT contract_number, overdue_email_sent_at FROM rental_contracts
       WHERE contract_number IN ('S9-RC1','S9-RC2') ORDER BY contract_number`
    );
    expect(rows[0].overdue_email_sent_at).not.toBeNull(); // outlet 1 — processed
    expect(rows[1].overdue_email_sent_at).toBeNull();     // outlet 2 — skipped
  });
});
