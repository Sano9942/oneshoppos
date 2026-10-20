/**
 * ots-pin-unique.test.js — One Toy Store clock-in (owner 2026-10-20): the
 * kiosk finds the person by PIN alone (POST /api/attendance/pin-checkin), so
 * two staff with the same PIN would clock in (with a photo) as each other.
 *
 *   - adding or editing an employee, and "change my PIN", refuse a PIN another
 *     (not deleted) employee already has: 409 PIN_TAKEN, who has it not said
 *   - keeping your own PIN is fine
 *   - a deleted employee's PIN no longer clocks in, and can be given to someone else
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup, outletId;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
// PINs no seeded employee uses.
const P1 = "730541";
const P2 = "730542";
const P3 = "730543";

const add = (name, pin_code) => admin().post("/api/employees").send({ name: `${name} ${S}`, role_id: 3, pin_code });
const clockIn = (pin_code) => makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code, outlet_id: outletId });

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets WHERE is_active = true ORDER BY id LIMIT 1")).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("a PIN can belong to only one person", () => {
  let a, b;

  it("adding a second employee with the same PIN is refused, and nobody is added", async () => {
    const r1 = await add("Aslam", P1);
    expect(r1.status).toBe(200);
    a = r1.body.id;
    const before = Number((await one("SELECT COUNT(*) AS n FROM employees")).n);
    const r2 = await add("Basharat", P1);
    expect(r2.status).toBe(409);
    expect(r2.body).toMatchObject({ code: "PIN_TAKEN", error: "This PIN is already used by another staff member." });
    expect(r2.body.error).not.toMatch(/Aslam/);
    expect(Number((await one("SELECT COUNT(*) AS n FROM employees")).n)).toBe(before);
  });

  it("editing an employee to someone else's PIN is refused; their old PIN stays", async () => {
    b = (await add("Basharat", P2)).body.id;
    const r = await admin().put(`/api/employees/${b}`).send({ pin_code: P1 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("PIN_TAKEN");
    expect((await clockIn(P2)).status).toBeLessThan(300);
    expect((await one("SELECT employee_id FROM attendance_sessions ORDER BY id DESC LIMIT 1")).employee_id).toBe(b);
  });

  it("saving your own PIN again is fine", async () => {
    const r = await admin().put(`/api/employees/${a}`).send({ pin_code: P1, name: `Aslam ${S}` });
    expect(r.status).toBe(200);
  });

  it("'change my PIN' to someone else's PIN is refused", async () => {
    const r = await makeRequest(app, b).put(`/api/employees/${b}/change-pin`).send({ current_pin: P2, new_pin: P1 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("PIN_TAKEN");
    const ok = await makeRequest(app, b).put(`/api/employees/${b}/change-pin`).send({ current_pin: P2, new_pin: P3 });
    expect(ok.status).toBe(200);
  });
});

describe("a deleted employee's PIN", () => {
  it("no longer clocks in, and can be given to someone else", async () => {
    const gone = (await add("Leaver", "730549")).body.id;
    expect((await admin().delete(`/api/employees/${gone}`)).status).toBeLessThan(300);
    expect((await clockIn("730549")).status).toBe(401);
    const r = await add("Newcomer", "730549");
    expect(r.status).toBe(200);
    const sess = await clockIn("730549");
    expect(sess.status).toBeLessThan(300);
    const last = await one("SELECT employee_id FROM attendance_sessions ORDER BY id DESC LIMIT 1");
    expect(last.employee_id).toBe(r.body.id);
  });
});
