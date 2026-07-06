/**
 * pg-v09-rentals-depth.test.js — V09 rentals depth
 *
 * Covers the "can a car legally leave the lot" path + the coordinated
 * folio-tax slice + the deposit-as-payment / damage-as-line invoice math:
 *   - folio-tax: taxed rental item → per-line snapshot → invoice tax_total
 *   - car-legal: driver record (expired licence rejected), e-sign agreement
 *     generate + sign, checkout/return odometer+fuel readings
 *   - inspections: checkout + return inspection; return damage → invoice line
 *   - deposit: authorized hold → damage capture (partial) → no double-charge
 *   - maintenance: log resets the service clock; a due asset is parked into
 *     'maintenance' and refused for a new contract
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("V09 Rentals depth", () => {
  let app, db, deps, cleanup;
  const rentals = require("../../services/rental-service");

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    const ff = require("../../middleware/feature-flags");
    ff.init({ db });
    // Enable the rental mode flag + the V09 inspections flag for this schema.
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_rentals', true), ('rental_inspections', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    ff.invalidateFeatureFlagCache();
    require("../../middleware/permissions");
    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });
    require("../../routes/rentals")(app, deps);
  }, 180000);

  afterAll(async () => { if (cleanup) await cleanup(); });

  const H = { "x-employee-id": "1" };
  const day = 24 * 60 * 60 * 1000;

  // ── Folio-tax (exclusive) ────────────────────────────────────────
  describe("folio-tax", () => {
    let itemId, contractId;

    it("stamps per-line tax at booking and totals it on the invoice", async () => {
      await db.query("UPDATE company_profile SET tax_mode = 'exclusive' WHERE id = 1");
      const { rows: [tax] } = await db.query(
        "INSERT INTO taxes (name, rate) VALUES ('GST10', 10) RETURNING id"
      );
      const item = await request(app).post("/api/rental-items").set(H).send({
        name: "Taxed Van", total_quantity: 2, daily_rate: 100, deposit_amount: 50,
      });
      itemId = item.body.id;
      await db.query("UPDATE rental_items SET tax_id = $1 WHERE id = $2", [tax.id, itemId]);

      const now = new Date();
      const end = new Date(now.getTime() + 2 * day);
      const create = await request(app).post("/api/rental-contracts").set(H).send({
        customer_id: 1, rental_start: now.toISOString(), expected_return: end.toISOString(),
        deposit_collected: 50, deposit_method: "cash",
        lines: [{ rental_item_id: itemId, quantity: 1, rate_type: "daily", duration_value: 2 }],
      });
      expect(create.status).toBe(201);
      contractId = create.body.id;

      // line_total = 100 × 2 = 200; tax 10% exclusive → snapshot 20
      const { rows: [line] } = await db.query(
        "SELECT tax_rate_at_charge, tax_amount_at_charge FROM rental_contract_lines WHERE contract_id = $1",
        [contractId]
      );
      expect(Number(line.tax_rate_at_charge)).toBe(10);
      expect(Number(line.tax_amount_at_charge)).toBe(20);

      // Drive to invoice: confirm → checkout → return → complete → invoice
      await request(app).post(`/api/rental-contracts/${contractId}/confirm`).set(H).send({});
      await request(app).post(`/api/rental-contracts/${contractId}/checkout`).set(H).send({});
      await request(app).post(`/api/rental-contracts/${contractId}/return`).set(H).send({});
      await request(app).post(`/api/rental-contracts/${contractId}/complete`).set(H).send({});
      const gen = await request(app).post(`/api/rental-contracts/${contractId}/invoice`).set(H).send({});
      expect(gen.status).toBe(201);

      const inv = gen.body.invoice;
      expect(Number(inv.subtotal)).toBe(200);   // exclusive: pre-tax base
      expect(Number(inv.tax_total)).toBe(20);
      expect(Number(inv.total_amount)).toBe(220); // 200 + 20 tax
      expect(Number(inv.balance_due)).toBe(170);  // 220 − 50 deposit
    });
  });

  // ── Car-legal agreement ──────────────────────────────────────────
  describe("car-legal agreement", () => {
    let itemId, assetId, contractId;

    beforeAll(async () => {
      await db.query("UPDATE company_profile SET tax_mode = 'none' WHERE id = 1");
      const item = await request(app).post("/api/rental-items").set(H).send({
        name: "Corolla", total_quantity: 1, daily_rate: 100, deposit_amount: 200,
      });
      itemId = item.body.id;
      const asset = await request(app).post(`/api/rental-items/${itemId}/assets`).set(H)
        .send({ serial_number: "CAR-1", label: "White Corolla" });
      assetId = asset.body.id;
      await db.query("UPDATE rental_assets SET attributes = '{\"plate\":\"ABC-123\"}' WHERE id = $1", [assetId]);
    });

    it("creates a contract naming the vehicle asset", async () => {
      const now = new Date();
      const end = new Date(now.getTime() + 2 * day);
      const create = await request(app).post("/api/rental-contracts").set(H).send({
        customer_id: 1, rental_start: now.toISOString(), expected_return: end.toISOString(),
        deposit_collected: 200, deposit_method: "cash",
        lines: [{ rental_item_id: itemId, rental_asset_id: assetId, quantity: 1, rate_type: "daily", duration_value: 2 }],
      });
      expect(create.status).toBe(201);
      contractId = create.body.id;
    });

    it("rejects an expired driver licence", async () => {
      const res = await request(app).post(`/api/rental-contracts/${contractId}/drivers`).set(H).send({
        name: "Ali", cnic: "35202-1", license_number: "LIC-9", license_expiry: "2000-01-01",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/expired/i);
    });

    it("records a valid driver", async () => {
      const res = await request(app).post(`/api/rental-contracts/${contractId}/drivers`).set(H).send({
        name: "Ali Raza", cnic: "35202-1234567-1", license_number: "LIC-9",
        license_expiry: "2099-01-01", document_photos: ["r2/license-front.jpg"],
      });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Ali Raza");
    });

    it("generates and signs the e-sign agreement", async () => {
      const gen = await request(app).post(`/api/rental-contracts/${contractId}/agreement`).set(H).send({});
      expect(gen.status).toBe(201);
      expect(gen.body.document_id).toBeTruthy();
      expect(gen.body.signer_id).toBeTruthy();

      const sign = await request(app).post(`/api/rental-contracts/${contractId}/agreement/sign`).set(H)
        .send({ signature_data: "data:image/png;base64,iVBOR" });
      expect(sign.status).toBe(200);

      const { rows: [doc] } = await db.query(
        "SELECT status FROM contracts WHERE id = $1", [gen.body.document_id]
      );
      expect(doc.status).toBe("signed");
    });

    it("captures odometer/fuel readings at checkout and return", async () => {
      const { rows: [line] } = await db.query(
        "SELECT id FROM rental_contract_lines WHERE contract_id = $1", [contractId]
      );
      await request(app).post(`/api/rental-contracts/${contractId}/confirm`).set(H).send({});
      const co = await request(app).post(`/api/rental-contracts/${contractId}/checkout`).set(H).send({
        checkout_readings: [{ line_id: line.id, odometer: 50000, fuel_pct: 100 }],
      });
      expect(co.status).toBe(200);
      let { rows: [l] } = await db.query("SELECT checkout_reading, return_reading FROM rental_contract_lines WHERE id = $1", [line.id]);
      expect(l.checkout_reading.odometer).toBe(50000);

      const ret = await request(app).post(`/api/rental-contracts/${contractId}/return`).set(H).send({
        return_readings: [{ line_id: line.id, odometer: 50350, fuel_pct: 40 }],
      });
      expect(ret.status).toBe(200);
      ({ rows: [l] } = await db.query("SELECT return_reading FROM rental_contract_lines WHERE id = $1", [line.id]));
      expect(l.return_reading.odometer).toBe(50350);
    });

    it("frees the vehicle asset back to available on return", async () => {
      const { rows: [a] } = await db.query("SELECT status FROM rental_assets WHERE id = $1", [assetId]);
      expect(a.status).toBe("available");
    });
  });

  // ── Inspections + deposit capture (no double-charge) ─────────────
  describe("return damage → deposit-as-payment, damage-as-line", () => {
    let itemId, contractId;

    it("captures damage from an authorized hold without double-charging", async () => {
      await db.query("UPDATE company_profile SET tax_mode = 'none' WHERE id = 1");
      const item = await request(app).post("/api/rental-items").set(H).send({
        name: "Trailer", total_quantity: 1, daily_rate: 100, deposit_amount: 500,
      });
      itemId = item.body.id;
      const now = new Date();
      const end = new Date(now.getTime() + 1 * day);
      const create = await request(app).post("/api/rental-contracts").set(H).send({
        customer_id: 1, rental_start: now.toISOString(), expected_return: end.toISOString(),
        lines: [{ rental_item_id: itemId, quantity: 1, rate_type: "daily", duration_value: 1 }],
      });
      contractId = create.body.id;

      // Simulate an authorized gateway deposit hold of 500.
      await db.query(
        `UPDATE rental_contracts
            SET deposit_status = 'authorized', deposit_payment_intent_id = 'pi_test',
                deposit_authorized_amount = 500
          WHERE id = $1`,
        [contractId]
      );

      await request(app).post(`/api/rental-contracts/${contractId}/confirm`).set(H).send({});
      await request(app).post(`/api/rental-contracts/${contractId}/checkout`).set(H).send({});
      await request(app).post(`/api/rental-contracts/${contractId}/return`).set(H).send({});

      // Checkout inspection (clean) then return inspection with 150 damage.
      await request(app).post(`/api/rental-contracts/${contractId}/inspections`).set(H)
        .send({ phase: "checkout", photos: ["r2/co.jpg"], checklist: { body: "ok" } });
      const dmg = await request(app).post(`/api/rental-contracts/${contractId}/inspections`).set(H)
        .send({ phase: "return", damage_notes: "Scratched panel", damage_charge: 150, photos: ["r2/ret.jpg"] });
      expect(dmg.status).toBe(201);
      // Partial capture: 150 of the 500 hold.
      expect(dmg.body.deposit?.deposit_status).toBe("partially_captured");
      expect(Number(dmg.body.deposit?.captured_amount)).toBe(150);

      await request(app).post(`/api/rental-contracts/${contractId}/complete`).set(H).send({});
      const gen = await request(app).post(`/api/rental-contracts/${contractId}/invoice`).set(H).send({});
      expect(gen.status).toBe(201);
      const inv = gen.body.invoice;

      // rental 100 + damage 150 = 250 total. Deposit captured 150 is a PAYMENT.
      // No double-charge: balance = 250 − 150 = 100 (the rental fee), NOT 250.
      expect(Number(inv.total_amount)).toBe(250);
      expect(Number(inv.balance_due)).toBe(100);

      const { rows: items } = await db.query(
        "SELECT description, line_total FROM customer_invoice_items WHERE invoice_id = $1 ORDER BY id", [inv.id]
      );
      const damageLine = items.find((i) => /damage/i.test(i.description));
      expect(damageLine).toBeTruthy();
      expect(Number(damageLine.line_total)).toBe(150);
    });
  });

  // ── Maintenance scheduling ───────────────────────────────────────
  describe("maintenance", () => {
    let itemId, assetId;

    it("logs service, resets the clock, then parks a due asset and blocks booking", async () => {
      const item = await request(app).post("/api/rental-items").set(H).send({
        name: "Generator", total_quantity: 1, daily_rate: 100, deposit_amount: 0,
      });
      itemId = item.body.id;
      const asset = await request(app).post(`/api/rental-items/${itemId}/assets`).set(H)
        .send({ serial_number: "GEN-1" });
      assetId = asset.body.id;
      await db.query("UPDATE rental_assets SET service_interval_days = 30 WHERE id = $1", [assetId]);

      const log = await request(app).post(`/api/rental-items/${itemId}/assets/${assetId}/maintenance`).set(H)
        .send({ odometer: 1000, cost: 50, notes: "Oil change" });
      expect(log.status).toBe(201);
      const { rows: [a1] } = await db.query("SELECT service_due_at, last_serviced_at FROM rental_assets WHERE id = $1", [assetId]);
      expect(a1.service_due_at).toBeTruthy();
      expect(a1.last_serviced_at).toBeTruthy();

      // Force the asset overdue and run the worker's flagging helper.
      await db.query("UPDATE rental_assets SET service_due_at = NOW() - INTERVAL '1 day' WHERE id = $1", [assetId]);
      const flagged = await rentals.flagDueAssetsForMaintenance(deps.db);
      expect(flagged).toBeGreaterThanOrEqual(1);
      const { rows: [a2] } = await db.query("SELECT status FROM rental_assets WHERE id = $1", [assetId]);
      expect(a2.status).toBe("maintenance");

      // Booking that names the maintenance asset is refused.
      const now = new Date();
      const end = new Date(now.getTime() + 1 * day);
      const create = await request(app).post("/api/rental-contracts").set(H).send({
        customer_id: 1, rental_start: now.toISOString(), expected_return: end.toISOString(),
        lines: [{ rental_item_id: itemId, rental_asset_id: assetId, quantity: 1, rate_type: "daily", duration_value: 1 }],
      });
      expect(create.status).toBe(409);
      expect(create.body.error).toMatch(/maintenance/i);
    });

    it("lists maintenance-due assets", async () => {
      // Re-service resets it off the due list.
      await db.query("UPDATE rental_assets SET service_due_at = NOW() + INTERVAL '10 days', status = 'available' WHERE id = $1", [assetId]);
      const res = await request(app).get("/api/rental-assets/maintenance-due").set(H);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.assets)).toBe(true);
      expect(res.body.assets.find((a) => a.id === assetId)).toBeFalsy();
    });
  });

  // ── Delivery scheduling ──────────────────────────────────────────
  describe("delivery scheduling", () => {
    it("sets delivery details and lists them in the day-view", async () => {
      const item = await request(app).post("/api/rental-items").set(H).send({
        name: "Marquee", total_quantity: 5, daily_rate: 500, deposit_amount: 0,
      });
      const deliverAt = new Date(Date.now() + 3 * day);
      const create = await request(app).post("/api/rental-contracts").set(H).send({
        customer_id: 1,
        rental_start: new Date(Date.now() + 3 * day).toISOString(),
        expected_return: new Date(Date.now() + 4 * day).toISOString(),
        lines: [{ rental_item_id: item.body.id, quantity: 1, rate_type: "daily", duration_value: 1 }],
      });
      const cid = create.body.id;

      const upd = await request(app).put(`/api/rental-contracts/${cid}/delivery`).set(H).send({
        delivery_required: true, delivery_at: deliverAt.toISOString(),
        setup_notes: "Back garden", delivery_status: "scheduled", delivery_crew: [1, 2],
      });
      expect(upd.status).toBe(200);
      expect(upd.body.delivery_required).toBe(true);

      const from = new Date(deliverAt.getTime() - day).toISOString();
      const to = new Date(deliverAt.getTime() + day).toISOString();
      const list = await request(app).get("/api/rental-deliveries").query({ from, to }).set(H);
      expect(list.status).toBe(200);
      expect(list.body.deliveries.find((d) => d.id === cid)).toBeTruthy();
    });
  });
});
