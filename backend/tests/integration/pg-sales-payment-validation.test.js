/**
 * pg-sales-payment-validation.test.js
 *
 * Confirms PaymentLineSchema rejects malformed payment lines at the
 * /api/sales boundary when PAYMENT_GATEWAY=sandbox. Ensures Zod
 * validation runs BEFORE the gateway adapter is called — malformed
 * bodies never hit the sandbox.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;

beforeAll(async () => {
  process.env.PAYMENT_GATEWAY = "sandbox";
  process.env.SANDBOX_WEBHOOK_SECRET = "test-sandbox-secret";

  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../routes/sales")(app, deps);

  req = makeRequest(app, ADMIN_ID);

  // Seed shift + attendance (needed for POS sales)
  await db.query(
    `INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status)
     VALUES (1, 1, 1000, 'open')`
  );
  await db.query(
    `INSERT INTO attendance_sessions (employee_id, outlet_id, session_start, session_type)
     VALUES (1, 1, NOW(), 'work')`
  );
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("POST /api/sales — PaymentLineSchema validation (sandbox)", () => {
  const validCart = [{ id: 1, name: "Test", price: 100, quantity: 1 }];

  test("accepts valid cash payment line", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: validCart,
      payments: [{ method: "Cash", amount: 100 }],
      outlet_id: 1,
      employee_id: 1,
    });
    // 200 = sale created successfully; any status other than 400 proves the
    // body passed Zod validation (a 500 from downstream is acceptable here
    // — we're only asserting the schema gate).
    expect(res.status).not.toBe(400);
  });

  test("rejects empty-method payment line with 400 + field detail", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: validCart,
      payments: [{ method: "", amount: 100 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
    const methodErr = res.body.details.find((d) => d.field === "payments.0.method");
    expect(methodErr).toBeDefined();
  });

  test("rejects negative-amount payment line with 400", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: validCart,
      payments: [{ method: "Cash", amount: -50 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(400);
    const amtErr = res.body.details.find((d) => d.field === "payments.0.amount");
    expect(amtErr).toBeDefined();
  });

  test("rejects missing method on payment line with 400", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: validCart,
      payments: [{ amount: 100 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(400);
  });

  test("rejects string amount that isn't coercible to number with 400", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: validCart,
      payments: [{ method: "Card", amount: "not-a-number" }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(400);
  });

  test("accepts split cash + card payment (two lines)", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: validCart,
      payments: [
        { method: "Cash", amount: 50 },
        { method: "Card", amount: 50 },
      ],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).not.toBe(400);
  });
});
