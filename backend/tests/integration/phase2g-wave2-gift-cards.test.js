/**
 * Phase 2-G Wave 2 — 2-G.2 gift-cards behavior tests.
 *
 * Covers routes/gift-cards.js + routes/gift-cards-public.js. Does
 * NOT cover sales.js integration (that's the next commit's job —
 * the issue-on-sale hook and tender debit). Once that ships a
 * follow-up file will exercise the full flow end-to-end.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../middleware/feature-flags").init({
    db,
    IS_MULTI_TENANT: false,
    tenantDbManager: null,
    dbProxy: db,
  });
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();

  // gift-cards-public captures MULTI_TENANT at route-registration time
  // (closure over IS_MULTI_TENANT). For this test we want the
  // single-tenant branch so the route uses deps.db directly. Delete the
  // env var AFTER createTestApp (which has already finished any
  // module-level reads that care) but BEFORE registering the module.
  // Restored in afterAll so parallel test files still see MT.
  global.__saved_multi_tenant = process.env.MULTI_TENANT;
  delete process.env.MULTI_TENANT;
  require("../../routes/gift-cards-public")(app, deps);
  require("../../routes/gift-cards")(app, deps);

  req = makeRequest(app, ADMIN_ID);

  // Admin role seed only gives all_access — add manage_gift_cards
  // explicitly so the guard order is exercised.
  await db.query(
    `INSERT INTO role_permissions (role_id, permission) VALUES (1, 'manage_gift_cards')
     ON CONFLICT DO NOTHING`,
  );
}, 120000);

afterAll(async () => {
  if (cleanup) await cleanup();
  if (global.__saved_multi_tenant !== undefined) {
    process.env.MULTI_TENANT = global.__saved_multi_tenant;
    delete global.__saved_multi_tenant;
  }
}, 30000);

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [key, enabled],
  );
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();
}

async function resetFixtures() {
  await db.query(`DELETE FROM gift_card_transactions`);
  await db.query(`DELETE FROM gift_cards`);
  await db.query(`DELETE FROM gift_card_ranges`);
}

describe("Phase 2-G Wave 2 — gift-cards route (authenticated)", () => {
  beforeEach(async () => {
    await setFlag("phase2g_gift_cards", true);
    await resetFixtures();
  });

  test("flag OFF → 503 on all admin/POS endpoints", async () => {
    await setFlag("phase2g_gift_cards", false);
    const list = await req.get("/api/gift-cards");
    expect(list.status).toBe(503);
    const create = await req.post("/api/gift-cards").send({ initial_value: 500 });
    expect(create.status).toBe(503);
  });

  test("POST /api/gift-cards creates a digital card + credit ledger row", async () => {
    const res = await req.post("/api/gift-cards").send({
      card_type: "digital",
      initial_value: 500,
      issued_to_email: "test@example.com",
    });
    expect(res.status).toBe(200);
    expect(res.body.card_type).toBe("digital");
    expect(res.body.activation_status).toBe("active");
    expect(res.body.initial_value).toBe(500);
    expect(res.body.remaining_value).toBe(500);
    expect(typeof res.body.code).toBe("string");
    expect(res.body.code.length).toBeGreaterThan(6);

    const { rows } = await db.query(
      `SELECT type, amount::numeric AS amount, reference_type
         FROM gift_card_transactions WHERE gift_card_id = $1`,
      [res.body.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "credit", reference_type: "issue" });
    expect(Number(rows[0].amount)).toBe(500);
  });

  test("POST /api/gift-cards accepts optional custom code for physical cards (M14)", async () => {
    const res = await req.post("/api/gift-cards").send({
      card_type: "physical",
      initial_value: 250,
      code: "GC-2026-XMAS-001",
    });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe("GC-2026-XMAS-001");
    expect(res.body.card_type).toBe("physical");
  });

  test("POST /api/gift-cards normalizes custom code to uppercase + rejects empty after trim (M14)", async () => {
    const upper = await req.post("/api/gift-cards").send({
      card_type: "physical",
      initial_value: 100,
      code: "  gc-lower-case  ",
    });
    expect(upper.status).toBe(200);
    expect(upper.body.code).toBe("GC-LOWER-CASE");

    const empty = await req.post("/api/gift-cards").send({
      card_type: "physical",
      initial_value: 100,
      code: "   ",
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/code/i);
  });

  test("POST /api/gift-cards rejects duplicate custom code (M14)", async () => {
    const first = await req.post("/api/gift-cards").send({
      card_type: "physical",
      initial_value: 100,
      code: "DUP-CODE-1",
    });
    expect(first.status).toBe(200);

    const dup = await req.post("/api/gift-cards").send({
      card_type: "physical",
      initial_value: 100,
      code: "DUP-CODE-1",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already.*exists|duplicate/i);
  });

  test("POST /api/gift-cards ignores custom code on digital type (auto-generates) (M14)", async () => {
    // Digital codes are meant to be auto-generated and distributed via
    // email/SMS — accepting a custom code here would let admins pick
    // weak/predictable codes. Force auto-generation for digital.
    const res = await req.post("/api/gift-cards").send({
      card_type: "digital",
      initial_value: 100,
      code: "MY-WEAK-CODE",
    });
    expect(res.status).toBe(200);
    expect(res.body.code).not.toBe("MY-WEAK-CODE");
    expect(res.body.code.length).toBeGreaterThan(6);
  });

  test("POST /api/gift-cards rejects invalid card_type + invalid value", async () => {
    const bad1 = await req.post("/api/gift-cards").send({
      card_type: "virtual",
      initial_value: 100,
    });
    expect(bad1.status).toBe(400);
    const bad2 = await req.post("/api/gift-cards").send({
      card_type: "digital",
      initial_value: 0,
    });
    expect(bad2.status).toBe(400);
  });

  test("GET /api/gift-cards lists cards + filters by card_type + activation_status", async () => {
    await req.post("/api/gift-cards").send({ card_type: "digital", initial_value: 100 });
    await req.post("/api/gift-cards").send({ card_type: "digital", initial_value: 200 });
    await req.post("/api/gift-cards").send({ card_type: "physical", initial_value: 300 });

    const all = await req.get("/api/gift-cards");
    expect(all.status).toBe(200);
    expect(all.body.gift_cards).toHaveLength(3);

    const digitalOnly = await req.get("/api/gift-cards?card_type=digital");
    expect(digitalOnly.body.gift_cards).toHaveLength(2);
    expect(digitalOnly.body.gift_cards.every((c) => c.card_type === "digital")).toBe(true);
  });

  test("POST /api/gift-cards/ranges registers a physical card range", async () => {
    const res = await req.post("/api/gift-cards/ranges").send({
      prefix: "GC",
      range_start: 1000,
      range_end: 1099,
      face_value: 500,
      notes: "First batch",
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(100);

    const list = await req.get("/api/gift-cards/ranges");
    expect(list.body.ranges).toHaveLength(1);
    expect(list.body.ranges[0].face_value).toBe(500);
  });

  test("POST /api/gift-cards/ranges rejects inverted + non-integer ranges", async () => {
    const bad1 = await req.post("/api/gift-cards/ranges").send({
      prefix: "GC",
      range_start: 200,
      range_end: 100,
      face_value: 500,
    });
    expect(bad1.status).toBe(400);
    const bad2 = await req.post("/api/gift-cards/ranges").send({
      prefix: "GC",
      range_start: "abc",
      range_end: 100,
      face_value: 500,
    });
    expect(bad2.status).toBe(400);
  });

  test("activate: unknown card with matching range bootstraps + credits", async () => {
    await req.post("/api/gift-cards/ranges").send({
      prefix: "GC",
      range_start: 1000,
      range_end: 1099,
      face_value: 500,
    });
    const act = await req.post("/api/gift-cards/GC1050/activate");
    expect(act.status).toBe(200);
    expect(act.body.activation_status).toBe("active");
    expect(act.body.initial_value).toBe(500);

    // Ledger: one 'credit' row with reference_type='activate'.
    const { rows } = await db.query(
      `SELECT type, reference_type FROM gift_card_transactions`,
    );
    expect(rows).toEqual([
      { type: "credit", reference_type: "activate" },
    ]);
  });

  test("activate: unknown code with no matching range → 404", async () => {
    const act = await req.post("/api/gift-cards/GC9999/activate");
    expect(act.status).toBe(404);
  });

  test("activate: existing depleted card cannot be re-activated", async () => {
    // Seed a depleted card directly.
    await db.query(
      `INSERT INTO gift_cards (code, initial_value, remaining_value, card_type, activation_status)
       VALUES ('DEAD1', 100, 0, 'digital', 'depleted')`,
    );
    const res = await req.post("/api/gift-cards/DEAD1/activate");
    expect(res.status).toBe(400);
  });

  test("activate: already-active card is idempotent (no new ledger row)", async () => {
    const created = await req.post("/api/gift-cards").send({
      card_type: "digital",
      initial_value: 100,
    });
    const res = await req.post(`/api/gift-cards/${created.body.code}/activate`);
    expect(res.status).toBe(200);
    expect(res.body.already).toBe(true);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM gift_card_transactions WHERE gift_card_id = $1`,
      [created.body.id],
    );
    // Only the initial 'issue' credit; no duplicate.
    expect(rows[0].n).toBe(1);
  });

  test("GET /:code/balance returns remaining for authenticated user", async () => {
    const created = await req.post("/api/gift-cards").send({
      card_type: "digital",
      initial_value: 400,
    });
    const res = await req.get(`/api/gift-cards/${created.body.code}/balance`);
    expect(res.status).toBe(200);
    expect(res.body.remaining_value).toBe(400);
    expect(res.body.activation_status).toBe("active");
  });

  test("POST /:code/redeem: partial debit keeps card active", async () => {
    const created = await req.post("/api/gift-cards").send({
      card_type: "digital",
      initial_value: 500,
    });
    const res = await req.post(`/api/gift-cards/${created.body.code}/redeem`).send({
      amount: 200,
      reference_type: "sale",
      reference_id: 42,
    });
    expect(res.status).toBe(200);
    expect(res.body.deducted).toBe(200);
    expect(res.body.remaining_value).toBe(300);
    expect(res.body.activation_status).toBe("active");

    const { rows } = await db.query(
      `SELECT type, amount::numeric AS amount, reference_type, reference_id
         FROM gift_card_transactions WHERE gift_card_id = $1 ORDER BY id`,
      [created.body.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      type: "debit",
      reference_type: "sale",
      reference_id: 42,
    });
    expect(Number(rows[1].amount)).toBe(200);
  });

  test("POST /:code/redeem: full debit flips to depleted + stamps redeemed_at", async () => {
    const created = await req.post("/api/gift-cards").send({
      card_type: "digital",
      initial_value: 100,
    });
    const res = await req.post(`/api/gift-cards/${created.body.code}/redeem`).send({
      amount: 100,
    });
    expect(res.body.remaining_value).toBe(0);
    expect(res.body.activation_status).toBe("depleted");

    const { rows } = await db.query(
      `SELECT redeemed_at FROM gift_cards WHERE id = $1`,
      [created.body.id],
    );
    expect(rows[0].redeemed_at).not.toBeNull();
  });

  test("POST /:code/redeem: overdraft rejected, state unchanged", async () => {
    const created = await req.post("/api/gift-cards").send({
      card_type: "digital",
      initial_value: 50,
    });
    const res = await req.post(`/api/gift-cards/${created.body.code}/redeem`).send({
      amount: 100,
    });
    expect(res.status).toBe(400);
    const bal = await req.get(`/api/gift-cards/${created.body.code}/balance`);
    expect(bal.body.remaining_value).toBe(50);
    expect(bal.body.activation_status).toBe("active");
  });

  test("POST /:code/redeem: already-depleted card rejects further redemption", async () => {
    const created = await req.post("/api/gift-cards").send({
      card_type: "digital",
      initial_value: 50,
    });
    await req.post(`/api/gift-cards/${created.body.code}/redeem`).send({ amount: 50 });
    const second = await req.post(`/api/gift-cards/${created.body.code}/redeem`).send({
      amount: 10,
    });
    expect(second.status).toBe(400);
  });

  test("orphaned /api/gift-cards/:code route from barcode-expenses.js is gone", async () => {
    // The old GET /api/gift-cards/:code returned a raw row publicly; the
    // new route is /:code/balance + authenticated. Hitting /:code hits
    // 404 because there's no matching Express route on the admin side.
    const res = await req.get("/api/gift-cards/NONSENSE");
    // Either 404 (no route) or 400 (parameter validation) — we accept
    // anything that's NOT a 200+body-with-row.
    expect(res.status).not.toBe(200);
  });
});

describe("Phase 2-G Wave 2 — public /api/gift-cards/public/:code (no auth)", () => {
  const anonReq = () => request(app);

  beforeEach(async () => {
    await setFlag("phase2g_gift_cards", true);
    await resetFixtures();
  });

  test("anonymous request (no x-employee-id) returns balance", async () => {
    // Seed directly so we don't depend on the flag-guarded admin route.
    const { rows: [card] } = await db.query(
      `INSERT INTO gift_cards (code, initial_value, remaining_value, card_type)
       VALUES ('PUBCHK1', 250, 180, 'digital') RETURNING id`,
    );
    const res = await anonReq().get("/api/gift-cards/public/PUBCHK1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      code: "PUBCHK1",
      initial_value: 250,
      remaining_value: 180,
      activation_status: "active",
      card_type: "digital",
    });
    // Public payload must NOT leak issued_to_* or ledger data.
    expect(res.body.issued_to_email).toBeUndefined();
    expect(res.body.issued_from_sale_id).toBeUndefined();
    // Assert we got the row we seeded (id is not exposed but let's
    // confirm via separate query for paranoia).
    expect(card.id).toBeGreaterThan(0);
  });

  test("unknown code returns 404 (no oracle)", async () => {
    const res = await anonReq().get("/api/gift-cards/public/NEVER_EXISTED");
    expect(res.status).toBe(404);
  });

  test("public endpoint is NOT feature-flag gated (kept reachable even when flag off)", async () => {
    await setFlag("phase2g_gift_cards", false);
    await db.query(
      `INSERT INTO gift_cards (code, initial_value, remaining_value, card_type)
       VALUES ('PUBCHK2', 100, 100, 'digital')`,
    );
    const res = await anonReq().get("/api/gift-cards/public/PUBCHK2");
    expect(res.status).toBe(200);
  });

  test("response includes currency_symbol from company_profile (M13 regression)", async () => {
    // The public balance page displays the bare number — without a currency
    // symbol it's ambiguous whether "500" is PKR, USD, or something else.
    // Set the company profile currency and assert the public response
    // surfaces it.
    await db.query(
      `UPDATE company_profile SET currency_symbol = 'Rs' WHERE id = 1`,
    );
    await db.query(
      `INSERT INTO gift_cards (code, initial_value, remaining_value, card_type)
       VALUES ('PUBCHK_CURR', 500, 500, 'digital')`,
    );
    const res = await anonReq().get("/api/gift-cards/public/PUBCHK_CURR");
    expect(res.status).toBe(200);
    expect(res.body.currency_symbol).toBe("Rs");
  });
});
