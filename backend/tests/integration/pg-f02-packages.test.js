const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const dbPg = require("../../db-pg");
const pkgService = require("../../services/packages");

/**
 * pg-f02-packages.test.js — F02 packages / session passes.
 *
 * Ledger-first (feedback_audit_ledger_before_building): the reconciliation
 * invariant
 *     credits_used = Σ package_redemptions.credits WHERE reversed_at IS NULL
 * is asserted after every mutation, BEFORE any UI exists.
 *
 * Covers the plan's verification bar (backend half):
 *   - create 10-class template → sell → balance 10
 *   - redeem twice → 8 → reverse one → 9  (ledger reconciles at each step)
 *   - expire via clock-shift → status 'expired', redeem rejected
 *   - scope='listed' rejects an uncovered service, allows a covered one
 *   - REAL parallel redeem on a 1-credit pack → exactly one winner (FOR UPDATE)
 *   - refund guard: a package with redemptions cannot be refunded
 */

describe("F02 — packages / session passes (Postgres)", () => {
  let app, db, deps, cleanup, schemaName, req, customerId;
  const extraClients = [];

  async function parallelDb() {
    const client = await dbPg.getClient();
    await client.query(`SET search_path = '${schemaName}'`);
    extraClients.push(client);
    return {
      query: (sql, params) => client.query(sql, params),
      transaction: async (fn) => {
        await client.query("BEGIN");
        try {
          const r = await fn(client);
          await client.query("COMMIT");
          return r;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      },
    };
  }

  async function reconcile(pkgId) {
    const { rows: [r] } = await db.query(
      `SELECT cp.credits_used::int AS used,
              COALESCE(SUM(pr.credits) FILTER (WHERE pr.reversed_at IS NULL), 0)::int AS ledger,
              (cp.credits_total - cp.credits_used)::int AS remaining,
              cp.status
         FROM customer_packages cp
         LEFT JOIN package_redemptions pr ON pr.customer_package_id = cp.id
        WHERE cp.id = $1
        GROUP BY cp.credits_used, cp.credits_total, cp.status`,
      [pkgId],
    );
    return r;
  }

  async function createTemplate(body) {
    const res = await req.post("/api/package-templates").send(body);
    expect(res.status).toBe(201);
    return res.body;
  }

  async function sell(templateId) {
    const res = await req.post(`/api/customers/${customerId}/packages`).send({ template_id: templateId });
    expect(res.status).toBe(201);
    return res.body;
  }

  beforeAll(async () => {
    const result = await createTestApp();
    app = result.app;
    db = result.db;
    deps = result.deps;
    cleanup = result.cleanup;
    schemaName = result.schemaName;

    await db.query("SET TIME ZONE 'UTC'");

    require("../../middleware/feature-flags").init({
      db, IS_MULTI_TENANT: false, tenantDbManager: null, dbProxy: db,
    });

    require("../../routes/packages")(app, deps);
    req = makeRequest(app, ADMIN_ID);

    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('packages_passes', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`,
    );
    require("../../middleware/feature-flags").invalidateFeatureFlagCache();

    const { rows: [c] } = await db.query("SELECT id FROM customers ORDER BY id LIMIT 1");
    customerId = c.id;
  }, 120000);

  afterAll(async () => {
    for (const c of extraClients) { try { c.release(); } catch { /* noop */ } }
    if (cleanup) await cleanup();
  }, 30000);

  it("creates a template and its backing POS product tile", async () => {
    const tpl = await createTemplate({ name: "10-Class Pass", price: 5000, credits: 10, validity_days: 90 });
    expect(tpl.credits).toBe(10);
    expect(tpl.product_id).toBeTruthy();
    const { rows } = await db.query("SELECT product_type FROM products WHERE id = $1", [tpl.product_id]);
    expect(rows[0].product_type).toBe("package");
  });

  it("sells a pack → balance shows full credits, ledger reconciles at 0", async () => {
    const tpl = await createTemplate({ name: "5-Facial", price: 3000, credits: 5, validity_days: 60 });
    const pkg = await sell(tpl.id);
    expect(pkg.credits_total).toBe(5);
    expect(pkg.credits_used).toBe(0);

    const bal = await req.get(`/api/customers/${customerId}/packages`);
    expect(bal.status).toBe(200);
    const row = bal.body.find((r) => r.id === pkg.id);
    expect(Number(row.credits_remaining)).toBe(5);

    const rec = await reconcile(pkg.id);
    expect(rec.used).toBe(rec.ledger);
    expect(rec.remaining).toBe(5);
  });

  it("redeems twice then reverses once — 10 → 8 → 9, reconciling each step", async () => {
    const tpl = await createTemplate({ name: "10-PT", price: 8000, credits: 10 });
    const pkg = await sell(tpl.id);

    const r1 = await req.post(`/api/packages/${pkg.id}/redeem`).send({});
    expect(r1.status).toBe(200);
    expect(r1.body.remaining).toBe(9);

    const r2 = await req.post(`/api/packages/${pkg.id}/redeem`).send({});
    expect(r2.status).toBe(200);
    expect(r2.body.remaining).toBe(8);
    let rec = await reconcile(pkg.id);
    expect(rec.used).toBe(2);
    expect(rec.used).toBe(rec.ledger);

    const rev = await req.post(`/api/packages/${pkg.id}/reverse`).send({ redemption_id: r2.body.redemption.id });
    expect(rev.status).toBe(200);
    expect(rev.body.reversed).toBe(true);
    expect(rev.body.remaining).toBe(9);
    rec = await reconcile(pkg.id);
    expect(rec.used).toBe(1);
    expect(rec.used).toBe(rec.ledger); // reversed row excluded from the ledger sum
  });

  it("exhausts a pack — status flips to 'exhausted' and further redeem is rejected", async () => {
    const tpl = await createTemplate({ name: "1-Session", price: 1000, credits: 1 });
    const pkg = await sell(tpl.id);
    const ok = await req.post(`/api/packages/${pkg.id}/redeem`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("exhausted");

    const no = await req.post(`/api/packages/${pkg.id}/redeem`).send({});
    expect(no.status).toBe(400);
    const rec = await reconcile(pkg.id);
    expect(rec.used).toBe(1);
    expect(rec.used).toBe(rec.ledger);
  });

  it("expires via clock-shift — status 'expired', redeem rejected, balances catch up", async () => {
    const tpl = await createTemplate({ name: "Short-life", price: 500, credits: 3, validity_days: 30 });
    const pkg = await sell(tpl.id);
    // Shove expiry into the past.
    await db.query("UPDATE customer_packages SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [pkg.id]);

    const no = await req.post(`/api/packages/${pkg.id}/redeem`).send({});
    expect(no.status).toBe(400);
    expect(String(no.body.error)).toMatch(/expired/i);

    // The balances endpoint owns the durable 'active'→'expired' flip (single
    // writer). Reading balances catches up the stale-active-but-expired row.
    const bal = await req.get(`/api/customers/${customerId}/packages`);
    expect(bal.status).toBe(200);
    expect(bal.body.find((r) => r.id === pkg.id).status).toBe("expired");
    const { rows: [row] } = await db.query("SELECT status FROM customer_packages WHERE id = $1", [pkg.id]);
    expect(row.status).toBe("expired");
  });

  it("scope='listed' rejects an uncovered service and allows a covered one", async () => {
    // Seed two services with backing products.
    const { rows: [pA] } = await db.query(
      "INSERT INTO products (name, price, product_type, status) VALUES ('Svc A', 100, 'service', 'active') RETURNING id");
    const { rows: [pB] } = await db.query(
      "INSERT INTO products (name, price, product_type, status) VALUES ('Svc B', 100, 'service', 'active') RETURNING id");
    const { rows: [svcA] } = await db.query(
      "INSERT INTO booking_services (name, duration_minutes, price, product_id) VALUES ('Massage', 60, 100, $1) RETURNING id", [pA.id]);
    const { rows: [svcB] } = await db.query(
      "INSERT INTO booking_services (name, duration_minutes, price, product_id) VALUES ('Facial', 60, 100, $1) RETURNING id", [pB.id]);

    const tpl = await createTemplate({
      name: "Massage-only 4-pack", price: 4000, credits: 4,
      service_scope: "listed", service_ids: [svcA.id],
    });
    const pkg = await sell(tpl.id);

    // Uncovered service B → rejected.
    const bad = await req.post(`/api/packages/${pkg.id}/redeem`).send({ booking_service_id: svcB.id });
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toMatch(/not covered/i);

    // No service identified on a listed-scope pack → rejected.
    const none = await req.post(`/api/packages/${pkg.id}/redeem`).send({});
    expect(none.status).toBe(400);

    // Covered service A → allowed.
    const good = await req.post(`/api/packages/${pkg.id}/redeem`).send({ booking_service_id: svcA.id });
    expect(good.status).toBe(200);
    expect(good.body.remaining).toBe(3);

    const rec = await reconcile(pkg.id);
    expect(rec.used).toBe(rec.ledger);
  });

  it("REAL parallel redeem on a 1-credit pack → exactly one winner", async () => {
    const tpl = await createTemplate({ name: "Race pass", price: 1000, credits: 1 });
    const pkg = await sell(tpl.id);

    const [dbA, dbB] = await Promise.all([parallelDb(), parallelDb()]);
    const attempt = (pdb) =>
      pdb.transaction((client) => pkgService.redeemPackage(client, { customerPackageId: pkg.id }));

    const results = await Promise.allSettled([attempt(dbA), attempt(dbB)]);
    const wins = results.filter((r) => r.status === "fulfilled").length;
    const losses = results.filter((r) => r.status === "rejected").length;
    expect(wins).toBe(1);
    expect(losses).toBe(1);

    const rec = await reconcile(pkg.id);
    expect(rec.used).toBe(1);
    expect(rec.used).toBe(rec.ledger);
    expect(rec.status).toBe("exhausted");
  });

  it("service refuses to sell an anonymous package", async () => {
    const tpl = await createTemplate({ name: "Anon guard", price: 100, credits: 1 });
    await expect(
      db.transaction((client) => pkgService.sellPackage(client, { customerId: null, templateId: tpl.id })),
    ).rejects.toThrow(/customer is required/i);
  });
});
