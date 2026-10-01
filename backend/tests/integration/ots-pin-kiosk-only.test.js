/**
 * ots-pin-kiosk-only.test.js — One Toy Store pilot F3b part 3a (a staff PIN works only at the kiosk).
 *
 * Found 2026-09-30, owner decided 2026-10-01 (PHASE-F-PLAN F3b Q3b.6):
 *  - Sign-in accepted name + PIN for anyone without a password, and handed out
 *    a full login. A no-permission staff member could then ring sales
 *    (POST /api/sales had no permission check). The owner chose: sign-in needs
 *    a password for EVERYONE; a PIN is for the kiosk clock-in (and the till's
 *    lock screen / manager approvals, which already check who it is).
 *  - Ringing a sale needs a selling permission.
 *  - The PIN check at the till (validate-pin) skips deleted employees.
 */

const bcrypt = require("bcryptjs");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
// Required lazily so the rest of the file still runs before the helper exists.
const checkLoginCredentials = (...a) => require("../../services/login-credentials").checkLoginCredentials(...a);

let app, db, cleanup;
const ADMIN_PIN = "2580";
const STAFF_PIN = "4711";
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
let STAFF; // role with 0 permissions, PIN only (like the 11 on prod)
let STAFF_ROLE;
let REP; // Field Rep: execute_field_sales only
let GONE; // deleted employee with a PIN

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("UPDATE employees SET password_hash = $1 WHERE id = $2", [await bcrypt.hash("owner-pass-1", 4), ADMIN_ID]);
  STAFF_ROLE = (await one("INSERT INTO roles (name, description) VALUES ('Staff', 'no permissions') RETURNING id")).id;
  STAFF = (await one(
    "INSERT INTO employees (name, role, role_id, pin_hash) VALUES ('Tahir', 'Staff', $1, $2) RETURNING id",
    [STAFF_ROLE, await bcrypt.hash(STAFF_PIN, 4)],
  )).id;
  await db.query("INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES ($1, 1, true)", [STAFF]);
  const repRole = (await one("INSERT INTO roles (name, description) VALUES ('Field Rep', 'rep') RETURNING id")).id;
  await db.query("INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'execute_field_sales')", [repRole]);
  REP = (await one(
    "INSERT INTO employees (name, role, role_id) VALUES ('Rep', 'Field Rep', $1) RETURNING id", [repRole],
  )).id;
  await db.query("INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES ($1, 1, true)", [REP]);
  GONE = (await one(
    "INSERT INTO employees (name, role, role_id, pin_hash, deleted_at) VALUES ('Left', 'Staff', $1, $2, NOW()) RETURNING id",
    [STAFF_ROLE, await bcrypt.hash("8642", 4)],
  )).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("sign-in needs a password (everyone)", () => {
  it("staff with only a PIN: name + PIN is refused and told to use the kiosk", async () => {
    const res = await makeRequest(app).post("/api/auth/login").send({ username: "Tahir", pin: STAFF_PIN });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/kiosk/i);
  });

  it("staff with only a PIN: the PIN typed in the password box is refused too", async () => {
    const res = await makeRequest(app).post("/api/auth/login").send({ username: "Tahir", password: STAFF_PIN });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/kiosk/i);
  });

  it("the owner signs in with the password", async () => {
    const res = await makeRequest(app).post("/api/auth/login").send({ username: "Hassan", password: "owner-pass-1" });
    expect(res.status).toBe(200);
    expect(res.body.employee.id).toBe(ADMIN_ID);
  });

  it("the owner's PIN alone does not sign in", async () => {
    const pin = await makeRequest(app).post("/api/auth/login").send({ username: "Hassan", pin: ADMIN_PIN });
    expect(pin.status).toBe(401);
    const inBox = await makeRequest(app).post("/api/auth/login").send({ username: "Hassan", password: ADMIN_PIN });
    expect(inBox.status).toBe(401);
  });
});

describe("the shared check (used by /api/auth/login and /api/auth/mt-login)", () => {
  const pinOnly = { password_hash: null, pin_hash: bcrypt.hashSync("1234", 4), pin_code: null };
  const plainPin = { password_hash: null, pin_hash: null, pin_code: "1234" };
  const withPw = { password_hash: bcrypt.hashSync("secret-99", 4), pin_hash: bcrypt.hashSync("1234", 4) };

  it("no password set → refused, whatever is sent", async () => {
    for (const emp of [pinOnly, plainPin]) {
      for (const body of [{ pin: "1234" }, { password: "1234" }]) {
        const r = await checkLoginCredentials(emp, body);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/kiosk/i);
      }
    }
  });

  it("password set → only the right password passes", async () => {
    expect((await checkLoginCredentials(withPw, { password: "secret-99" })).ok).toBe(true);
    expect((await checkLoginCredentials(withPw, { password: "wrong" })).ok).toBe(false);
    expect((await checkLoginCredentials(withPw, { pin: "1234" })).ok).toBe(false);
    expect((await checkLoginCredentials(withPw, { password: "1234" })).ok).toBe(false);
  });
});

describe("the PIN still works where it should", () => {
  it("kiosk clock-in with the staff PIN", async () => {
    const res = await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: STAFF_PIN, outlet_id: 1 });
    expect(res.status).toBe(200);
  });

  it("till lock screen check finds the staff member", async () => {
    const res = await makeRequest(app).post("/api/employees/validate-pin").send({ pin_code: STAFF_PIN });
    expect(res.status).toBe(200);
    expect(res.body.employee.id).toBe(STAFF);
  });

  it("a deleted employee's PIN is refused at the till", async () => {
    const res = await makeRequest(app).post("/api/employees/validate-pin").send({ pin_code: "8642" });
    expect(res.status).toBe(401);
    expect(GONE).toBeTruthy();
  });
});

describe("ringing a sale needs a selling permission", () => {
  const sale = (who) => makeRequest(app, who).post("/api/sales").send({
    outlet_id: 1, employee_id: who,
    cartItems: [{ id: 4, quantity: 1, price: 100 }],
    payments: [{ method: "Cash", amount: 100 }],
  });

  beforeAll(async () => {
    // index.js wires the outlet check for the real server; the test app
    // doesn't, and a non-admin request with an outlet_id needs it.
    require("../../middleware/outlet-context").init({ db, IS_MULTI_TENANT: false });
    const res = await makeRequest(app, ADMIN_ID).post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: 1000 });
    expect(res.status).toBe(200);
    await db.query("UPDATE outlet_stock SET quantity = 100 WHERE product_id = 4");
    await db.query("UPDATE products SET stock = 100 WHERE id = 4");
  });

  it("a 0-permission staff member is refused", async () => {
    const res = await sale(STAFF);
    expect(res.status).toBe(403);
  });

  it("the cashier and the field rep are not refused for permission", async () => {
    for (const who of [3, REP]) {
      const res = await sale(who);
      // They may still be stopped later (e.g. not clocked in): only the
      // permission gate is under test here.
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(500);
    }
  });
});
