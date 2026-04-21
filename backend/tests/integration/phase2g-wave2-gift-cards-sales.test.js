/**
 * Phase 2-G Wave 2 — 2-G.2 gift-card integration with POST /api/sales.
 *
 * Covers the two sales.js hooks wired in Track C:
 *   1. ISSUE — selling a product with is_gift_card_sku=true generates
 *      one `gift_cards` row per unit, writes a credit ledger, and
 *      (post-commit) tries to enqueue a recipient email.
 *   2. TENDER — a sale with a `gift_card` payment redeems the card
 *      inside the sale transaction. Insufficient balance / depleted /
 *      unknown code all roll back the whole sale.
 *
 * Flag-OFF regression: selling a gift-card SKU with flag off leaves
 * gift_cards empty — backward compat.
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

  await db.query("SET TIME ZONE 'UTC'");

  require("../../middleware/feature-flags").init({
    db,
    IS_MULTI_TENANT: false,
    tenantDbManager: null,
    dbProxy: db,
  });
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();

  require("../../routes/shifts")(app, deps);
  require("../../routes/attendance")(app, deps);
  require("../../routes/sales")(app, deps);
  require("../../routes/gift-cards")(app, deps);

  req = makeRequest(app, ADMIN_ID);

  await request(app)
    .post("/api/shifts/open")
    .set("x-employee-id", "1")
    .send({ outlet_id: 1, opening_float: 500, denominations: [] });
  await request(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: "2580", outlet_id: 1 });

  // Mark product id=2 (seeded PKR 200) as a gift-card SKU so selling
  // it triggers the issue hook.
  await db.query(
    `UPDATE products SET is_gift_card_sku = true WHERE id = 2`,
  );

  // Admin role needs manage_gift_cards to hit the admin create route
  // we use for fixture seeding.
  await db.query(
    `INSERT INTO role_permissions (role_id, permission) VALUES (1, 'manage_gift_cards')
     ON CONFLICT DO NOTHING`,
  );
}, 120000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [key, enabled],
  );
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();
}

async function clearGiftCards() {
  await db.query(`DELETE FROM gift_card_transactions`);
  await db.query(`DELETE FROM gift_cards`);
}

describe("Phase 2-G Wave 2 — gift-card ISSUE on sale", () => {
  beforeEach(async () => {
    await clearGiftCards();
    await setFlag("phase2g_gift_cards", false);
  });

  test("flag OFF: selling a gift-card SKU does NOT create any gift_cards rows", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 2, name: "Gift Card 200", price: 200, quantity: 1 }],
      payments: [{ method: "Cash", amount: 200 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.issuedGiftCards || []).toEqual([]);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM gift_cards`);
    expect(rows[0].n).toBe(0);
  });

  test("flag ON: selling 1 unit creates 1 gift_cards row + credit ledger + response field", async () => {
    await setFlag("phase2g_gift_cards", true);
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 2, name: "Gift Card 200", price: 200, quantity: 1 }],
      payments: [{ method: "Cash", amount: 200 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.issuedGiftCards).toHaveLength(1);
    const issued = res.body.issuedGiftCards[0];
    expect(issued.initial_value).toBe(200);
    expect(typeof issued.code).toBe("string");

    const { rows: cards } = await db.query(
      `SELECT card_type, activation_status,
              initial_value::numeric AS initial_value,
              remaining_value::numeric AS remaining_value,
              issued_from_sale_id
         FROM gift_cards`,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      card_type: "digital",
      activation_status: "active",
      issued_from_sale_id: res.body.saleId,
    });
    expect(Number(cards[0].initial_value)).toBe(200);
    expect(Number(cards[0].remaining_value)).toBe(200);

    const { rows: ledger } = await db.query(
      `SELECT type, amount::numeric AS amount, reference_type, reference_id
         FROM gift_card_transactions`,
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: "credit",
      reference_type: "sale",
      reference_id: res.body.saleId,
    });
  });

  test("flag ON: selling quantity=3 creates 3 distinct codes", async () => {
    await setFlag("phase2g_gift_cards", true);
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 2, name: "Gift Card 200", price: 200, quantity: 3 }],
      payments: [{ method: "Cash", amount: 600 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.issuedGiftCards).toHaveLength(3);
    const codes = res.body.issuedGiftCards.map((c) => c.code);
    expect(new Set(codes).size).toBe(3); // all distinct
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM gift_cards`);
    expect(rows[0].n).toBe(3);
  });

  test("flag ON: selling a non-gift-card SKU does NOT issue anything", async () => {
    await setFlag("phase2g_gift_cards", true);
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "Cash", amount: 100 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.issuedGiftCards || []).toEqual([]);
  });

  test("flag ON: mixed cart (gift-card SKU + regular) issues only for the gift-card line", async () => {
    await setFlag("phase2g_gift_cards", true);
    const res = await req.post("/api/sales").send({
      cartItems: [
        { id: 2, name: "Gift Card 200", price: 200, quantity: 1 },
        { id: 1, name: "Widget A", price: 100, quantity: 2 },
      ],
      payments: [{ method: "Cash", amount: 400 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.issuedGiftCards).toHaveLength(1);
    expect(res.body.issuedGiftCards[0].product_id).toBe(2);
  });
});

describe("Phase 2-G Wave 2 — gift-card TENDER redemption", () => {
  let card;
  beforeEach(async () => {
    await clearGiftCards();
    await setFlag("phase2g_gift_cards", true);
    // Seed a card with 500 remaining.
    const { rows: [row] } = await db.query(
      `INSERT INTO gift_cards (code, initial_value, remaining_value, card_type, activation_status)
       VALUES ('TENDER1', 500, 500, 'digital', 'active') RETURNING id, code`,
    );
    card = row;
  });

  test("full tender debits card + writes ledger debit + depletes if zeroed", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "gift_card", amount: 100, code: "TENDER1" }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(200);

    const { rows: [after] } = await db.query(
      `SELECT remaining_value::numeric AS remaining_value, activation_status
         FROM gift_cards WHERE id = $1`,
      [card.id],
    );
    expect(Number(after.remaining_value)).toBe(400);
    expect(after.activation_status).toBe("active");

    const { rows: ledger } = await db.query(
      `SELECT type, amount::numeric AS amount, reference_type, reference_id
         FROM gift_card_transactions WHERE gift_card_id = $1`,
      [card.id],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: "debit",
      reference_type: "sale",
      reference_id: res.body.saleId,
    });

    // sale_payments row has the gift-card ref stamped in gateway_ref.
    const { rows: [pay] } = await db.query(
      `SELECT payment_method, gateway_ref FROM sale_payments WHERE sale_id = $1`,
      [res.body.saleId],
    );
    expect(pay.payment_method).toBe("gift_card");
    expect(pay.gateway_ref).toBe("giftcard:TENDER1");
  });

  test("redeeming exactly the remaining balance flips to depleted", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 5 }],
      payments: [{ method: "gift_card", amount: 500, code: "TENDER1" }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(200);
    const { rows: [after] } = await db.query(
      `SELECT activation_status, redeemed_at
         FROM gift_cards WHERE id = $1`,
      [card.id],
    );
    expect(after.activation_status).toBe("depleted");
    expect(after.redeemed_at).not.toBeNull();
  });

  test("insufficient balance rolls back the sale + no partial debit", async () => {
    const { rows: [countBefore] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sales`,
    );
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 6 }],
      payments: [{ method: "gift_card", amount: 600, code: "TENDER1" }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(400);

    // Card balance unchanged.
    const { rows: [after] } = await db.query(
      `SELECT remaining_value::numeric AS remaining_value
         FROM gift_cards WHERE id = $1`,
      [card.id],
    );
    expect(Number(after.remaining_value)).toBe(500);

    // No ledger row written for THIS card.
    const { rows: ledger } = await db.query(
      `SELECT COUNT(*)::int AS n FROM gift_card_transactions WHERE gift_card_id = $1`,
      [card.id],
    );
    expect(ledger[0].n).toBe(0);

    // Sales count unchanged (the failed sale didn't persist).
    const { rows: [countAfter] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sales`,
    );
    expect(countAfter.n).toBe(countBefore.n);
  });

  test("depleted card rejects tender with 400", async () => {
    await db.query(
      `UPDATE gift_cards SET activation_status = 'depleted', remaining_value = 0 WHERE id = $1`,
      [card.id],
    );
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "gift_card", amount: 100, code: "TENDER1" }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(400);
  });

  test("unknown code rejects with 404 + no sale persisted", async () => {
    const { rows: [before] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sales`,
    );
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "gift_card", amount: 100, code: "DOES_NOT_EXIST" }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(404);
    const { rows: [after] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sales`,
    );
    expect(after.n).toBe(before.n);
  });

  test("missing code on gift_card tender rejects with 400", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "gift_card", amount: 100 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(400);
  });
});
