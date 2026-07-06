/**
 * pg-v06-ticket-spine-baseline.test.js — V06 pre-flight.
 *
 * Proves the existing repair/service ticket SPINE connects end-to-end before
 * V06 depth extends it (device intake, parts-on-ticket, itemized invoice).
 * Mirrors the completion 05-workflow-tickets.md verification checklist, backend
 * rows only (POS settle + portal rows are covered by the full execution walk).
 *
 * It also DOCUMENTS the known P0 "the invoice drops the money": today
 * generateInvoiceFromTicket bills a single opaque line at the deposit amount
 * (services/service-tickets.js:186-214). The assertions below lock that current
 * behavior in so the parts-P0 rewrite has an explicit before/after and this test
 * is updated in lockstep with it.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;
let customerId;

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = $2`,
    [key, enabled]
  );
  const { invalidateFeatureFlagCache } = require("../../middleware/feature-flags");
  if (invalidateFeatureFlagCache) invalidateFeatureFlagCache(null);
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../middleware/feature-flags").init({ db });

  app.use((r, _res, next) => {
    const eid = r.headers["x-employee-id"];
    if (eid) r.employee = { id: Number(eid) };
    r.tenantSlug = "testco";
    r.company = { company_name: "Fixit Shop", timezone: "UTC" };
    next();
  });

  require("../../routes/service-tickets")(app, deps);
  req = makeRequest(app, ADMIN_ID);

  await setFlag("phase4_workflow_tickets", true);
  // customer_notifications OFF — keep this test about the spine, not F05 dispatch.
  await setFlag("customer_notifications", false);

  const { rows } = await db.query(
    "INSERT INTO customers (name, mobile) VALUES ('Spine Test', '03009998877') RETURNING id"
  );
  customerId = rows[0].id;
}, 180000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("V06 pre-flight — ticket create + numbering", () => {
  it("creates a ticket with a generated number and intake status", async () => {
    const res = await req.post("/api/service-tickets").send({
      title: "Cracked screen — iPhone 12",
      description: "Front glass shattered, LCD intact",
      customer_id: customerId,
      outlet_id: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.ticket_number).toMatch(/^TKT-\d{6}$/);
    expect(res.body.status).toBe("intake");
    expect(res.body.customer_id).toBe(customerId);
  });
});

describe("V06 pre-flight — status workflow + activity log", () => {
  let ticketId;
  beforeAll(async () => {
    const res = await req.post("/api/service-tickets").send({ title: "Battery replacement", customer_id: customerId });
    ticketId = res.body.id;
  });

  it("hops intake → approved → in_progress → completed, logging each transition", async () => {
    for (const status of ["approved", "in_progress", "completed"]) {
      const res = await req.put(`/api/service-tickets/${ticketId}`).send({ status });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }
    const full = await req.get(`/api/service-tickets/${ticketId}`);
    const statusChanges = full.body.activities.filter((a) => a.activity_type === "status_change");
    // created + 3 transitions
    expect(statusChanges.length).toBeGreaterThanOrEqual(4);
    // completing stamps actual_completion
    expect(full.body.actual_completion).toBeTruthy();
  });

  it("rejects an unknown status via Zod (strict update schema)", async () => {
    const res = await req.put(`/api/service-tickets/${ticketId}`).send({ status: "teleported" });
    expect(res.status).toBe(400);
  });
});

describe("V06 pre-flight — deposit at intake", () => {
  it("records a deposit amount + timestamp + activity", async () => {
    const res = await req.post("/api/service-tickets").send({
      title: "Water damage diagnosis",
      customer_id: customerId,
      deposit_amount: 1000,
      deposit_method: "cash",
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.deposit_amount)).toBe(1000);
    expect(res.body.deposit_paid_at).toBeTruthy();

    const full = await req.get(`/api/service-tickets/${res.body.id}`);
    const depositLog = full.body.activities.find((a) => a.activity_type === "deposit_recorded");
    expect(depositLog).toBeTruthy();
  });
});

describe("V06 pre-flight — resolve → invoice (documents the money-drop P0)", () => {
  let ticketId;
  beforeAll(async () => {
    const res = await req.post("/api/service-tickets").send({
      title: "Screen replacement",
      customer_id: customerId,
      deposit_amount: 1000,
      deposit_method: "cash",
    });
    ticketId = res.body.id;
    await req.put(`/api/service-tickets/${ticketId}`).send({ status: "approved" });
    await req.put(`/api/service-tickets/${ticketId}`).send({ status: "in_progress" });
    await req.put(`/api/service-tickets/${ticketId}`).send({ status: "completed" });
  });

  it("refuses to invoice a non-completed ticket", async () => {
    const fresh = await req.post("/api/service-tickets").send({ title: "Not done yet", customer_id: customerId });
    const res = await req.post(`/api/service-tickets/${fresh.body.id}/generate-invoice`);
    expect(res.status).toBe(400);
  });

  it("generates an invoice and flips the ticket to invoiced", async () => {
    const res = await req.post(`/api/service-tickets/${ticketId}/generate-invoice`);
    expect(res.status).toBe(201);
    expect(res.body.invoice).toBeTruthy();
    expect(res.body.invoice.invoice_number).toMatch(/^INV-\d{6}$/);

    const full = await req.get(`/api/service-tickets/${ticketId}`);
    expect(full.body.status).toBe("invoiced");
    expect(full.body.final_invoice_id).toBe(res.body.invoice.id);

    // ── BASELINE of the known P0 (services/service-tickets.js:186-214) ──
    // The current invoice has NO parts/labor breakdown — it bills a single
    // line at the deposit amount, so a Rs 4,500 repair with a Rs 1,000 deposit
    // invoices as Rs 1,000. The V06 parts-P0 rewrite REPLACES this: itemized
    // parts+labor lines minus the deposit, tax-snapshotted. Update these two
    // assertions in the same commit as that rewrite.
    expect(Number(res.body.invoice.total_amount)).toBe(1000); // == deposit, not the real repair total
    const lines = await db.query(
      "SELECT count(*)::int c FROM customer_invoice_items WHERE invoice_id = $1",
      [res.body.invoice.id]
    );
    expect(lines.rows[0].c).toBe(1); // one opaque line today; parts-P0 makes this N
  });
});
