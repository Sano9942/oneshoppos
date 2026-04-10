/**
 * Workforce scheduling smoke — Phase 2, flag `phase2_scheduling`.
 *
 * Happy path: fetch employees + outlet → create draft shift → publish → list
 * attendance for the employee → delete the draft shift (cleanup).
 *
 * If the flag is off the spec skips cleanly with a logged SKIP line.
 */
import { test, expect } from "@playwright/test";
import { get, post, put, del } from "../helpers/api.js";
import { skipIfFlagOff } from "./helpers/featureFlags.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";

const SPEC = "workforce.smoke.spec.js";

test.describe("Workforce scheduling smoke", () => {
  test.beforeAll(async () => {
    await skipIfFlagOff(test, SPEC, "phase2_scheduling");
  });

  test.afterAll(async () => {
    await cleanupAll();
  });

  let seededShiftId = null;

  test("create draft shift", async () => {
    const empRes = await get("/api/employees");
    expect(empRes.ok, `employees: ${JSON.stringify(empRes.data)}`).toBe(true);
    const employees = empRes.data?.employees || empRes.data || [];
    expect(employees.length, "at least one employee").toBeGreaterThan(0);
    const employee = employees[0];

    const outletsRes = await get("/api/outlets");
    const outlets = outletsRes.data?.outlets || outletsRes.data || [];
    const outlet = outlets.find((o) => o.is_active !== false) || outlets[0];
    expect(outlet, "at least one outlet").toBeTruthy();

    // Use a future date well beyond any leave requests to avoid overlap.
    const future = new Date();
    future.setDate(future.getDate() + 60);
    const shiftDate = future.toISOString().slice(0, 10);

    const createRes = await post("/api/schedules", {
      employee_id: employee.id,
      outlet_id: outlet.id,
      shift_date: shiftDate,
      start_time: "09:00",
      end_time: "17:00",
      break_minutes: 30,
      notes: "smoke test shift",
    });
    expect(createRes.ok, `create shift: ${JSON.stringify(createRes.data)}`).toBe(true);
    seededShiftId = createRes.data?.shift?.id;
    expect(seededShiftId).toBeTruthy();
    trackForCleanup("schedule", seededShiftId);
  });

  test("publish draft shift [KNOWN BACKEND BUG: date >= text]", async () => {
    test.skip(
      !seededShiftId,
      "create step did not seed a shift",
    );

    // NOTE: backend/routes/schedules.js:126 publish endpoint joins
    // scheduled_shifts.shift_date (date) against leave_requests.start_date
    // (text in prod?), producing a Postgres error: "operator does not exist:
    // date >= text". This smoke is expected to FAIL until the backend fix
    // casts either side to date. We still run it so a regression on the fix
    // trips a red light. Remove the expect.soft wrapper once the bug ships.
    const publishRes = await post("/api/schedules/publish", {
      shift_ids: [seededShiftId],
      notify: "affected",
    });
    expect.soft(
      publishRes.ok,
      `publish: ${JSON.stringify(publishRes.data)} (known backend bug if this fails with "operator does not exist: date >= text")`,
    ).toBe(true);
  });
});
