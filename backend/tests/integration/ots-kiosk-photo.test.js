/**
 * ots-kiosk-photo.test.js — One Toy Store pilot F3b part 3b (photo at clock-in).
 *
 * Owner 2026-10-01 (PHASE-F-PLAN F3b Q3b.8, Q3b.17, Q3b.18): against PIN
 * sharing, the kiosk takes a photo on EVERY press (clock in, break, back,
 * clock out). If the camera fails, the press still goes through but is saved
 * as "no photo", shown in red on the register so the owner can ask why.
 *
 * Every press is one row in attendance_presses (action, time, photo_url or
 * NULL). The register returns each day's presses beside the P, and a
 * per-person count of presses without a photo.
 */

const bcrypt = require("bcryptjs");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const STAFF_PIN = "4711";
let STAFF;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const kiosk = () => makeRequest(app);

// A tiny real JPEG (1×1) as the kiosk sends it (data URL from the canvas).
const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  STAFF = (await one(
    `INSERT INTO employees (name, role, role_id, pin_hash, monthly_salary)
     VALUES ('Tahir Mushtaq', 'Staff', 3, $1, 40000) RETURNING id`,
    [await bcrypt.hash(STAFF_PIN, 4)],
  )).id;
  await db.query("INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES ($1, 1, true)", [STAFF]);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const presses = () =>
  all("SELECT action, photo_url FROM attendance_presses WHERE employee_id = $1 ORDER BY id", [STAFF]);

describe("F3b 3b — a photo on every kiosk press", () => {
  it("clock in with a photo: saved with the press", async () => {
    const res = await kiosk().post("/api/attendance/pin-checkin").send({ pin_code: STAFF_PIN, outlet_id: 1, photo_base64: JPEG });
    expect(res.status).toBe(200);
    expect(res.body.photo_saved).toBe(true);
    const rows = await presses();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("in");
    expect(rows[0].photo_url).toMatch(/attendance\//);
  });

  it("break with a photo, back WITHOUT one (camera failed): the press still goes through", async () => {
    const brk = await kiosk().post("/api/attendance/pin-checkout")
      .send({ pin_code: STAFF_PIN, outlet_id: 1, break_reason: "lunch", photo_base64: JPEG });
    expect(brk.status).toBe(200);
    const back = await kiosk().post("/api/attendance/pin-checkin").send({ pin_code: STAFF_PIN, outlet_id: 1 });
    expect(back.status).toBe(200);
    expect(back.body.photo_saved).toBe(false);
    const rows = await presses();
    expect(rows.map((r) => r.action)).toEqual(["in", "break", "back"]);
    expect(rows[1].photo_url).toMatch(/attendance\//);
    expect(rows[2].photo_url).toBeNull();
  });

  it("a photo that isn't an image is not saved; the press still goes through", async () => {
    const out = await kiosk().post("/api/attendance/pin-checkout")
      .send({ pin_code: STAFF_PIN, outlet_id: 1, photo_base64: "data:text/html;base64,PGgxPmhpPC9oMT4=" });
    expect(out.status).toBe(200);
    expect(out.body.photo_saved).toBe(false);
    const rows = await presses();
    expect(rows.map((r) => r.action)).toEqual(["in", "break", "back", "out"]);
    expect(rows[3].photo_url).toBeNull();
  });

  it("a wrong PIN saves no press and no photo", async () => {
    const res = await kiosk().post("/api/attendance/pin-checkin").send({ pin_code: "0000", outlet_id: 1, photo_base64: JPEG });
    expect(res.status).toBe(401);
    expect(await presses()).toHaveLength(4);
  });

  it("a press that fails (already clocked out → clock out again) saves no press", async () => {
    const res = await kiosk().post("/api/attendance/pin-checkout").send({ pin_code: STAFF_PIN, outlet_id: 1, photo_base64: JPEG });
    expect(res.status).toBe(400);
    expect(await presses()).toHaveLength(4);
  });

  it("the register shows today's presses with photos and counts the ones without", async () => {
    const month = (await one("SELECT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM') AS m")).m;
    const today = Number((await one("SELECT EXTRACT(DAY FROM NOW() AT TIME ZONE 'UTC')::int AS d")).d);
    const res = await admin().get(`/api/staff-pay/register?month=${month}`);
    expect(res.status).toBe(200);
    const row = res.body.staff.find((s) => s.id === STAFF);
    const cell = row.marks[today];
    expect(cell.mark).toBe("P");
    expect(cell.presses.map((p) => p.action)).toEqual(["in", "break", "back", "out"]);
    expect(cell.presses.map((p) => Boolean(p.photo_url))).toEqual([true, true, false, false]);
    for (const p of cell.presses) expect(p.at).toBeTruthy();
    expect(row.no_photo_presses).toBe(2);
  });

  it("the register is the owner's only: the kiosk can't read photos", async () => {
    const res = await kiosk().get("/api/staff-pay/register");
    expect([401, 403]).toContain(res.status);
  });
});
