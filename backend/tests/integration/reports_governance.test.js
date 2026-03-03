const {
  createTestApp,
  closeDb,
  dbRun,
  dbGet,
} = require("../helpers/createTestApp");
const {
  makeRequest,
  ADMIN_ID,
  MANAGER_ID,
  CASHIER_ID,
} = require("../helpers/request");

describe("Reports Governance Integration", () => {
  let app;
  let db;

  beforeEach(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;
    await dbRun(
      db,
      "UPDATE feature_flags SET enabled = 1 WHERE key = 'reports_scheduled_exports'",
    );
    await dbRun(
      db,
      "UPDATE feature_flags SET enabled = 1 WHERE key = 'reports_profit_layer'",
    );
  });

  afterEach(async () => {
    await closeDb(db);
  });

  it("allows personal saved views and scopes them to the current employee", async () => {
    const createRes = await makeRequest(app, CASHIER_ID)
      .post("/api/reports/saved-views")
      .send({
        report_key: "overview",
        name: "Cashier View",
        scope: "personal",
        filters: { outletId: "1" },
      });

    expect(createRes.status).toBe(200);

    const ownViews = await makeRequest(app, CASHIER_ID).get(
      "/api/reports/saved-views",
    );
    expect(ownViews.status).toBe(200);
    expect(ownViews.body.views.some((view) => view.name === "Cashier View")).toBe(
      true,
    );

    const managerViews = await makeRequest(app, MANAGER_ID).get(
      "/api/reports/saved-views",
    );
    expect(managerViews.status).toBe(200);
    expect(
      managerViews.body.views.some((view) => view.name === "Cashier View"),
    ).toBe(false);
  });

  it("creates schedules, runs them, and records delivery logs", async () => {
    const scheduleRes = await makeRequest(app, MANAGER_ID)
      .post("/api/reports/schedules")
      .send({
        name: "Daily Profit Export",
        report_key: "profit-by-product",
        frequency: "daily",
        run_hour: 6,
        run_minute: 0,
        filters: {},
      });

    expect(scheduleRes.status).toBe(200);
    expect(scheduleRes.body.id).toBeTruthy();

    const runRes = await makeRequest(app, MANAGER_ID).post(
      `/api/reports/schedules/${scheduleRes.body.id}/run-now`,
    );
    expect(runRes.status).toBe(200);
    expect(runRes.body.run.row_count).toBeGreaterThanOrEqual(0);

    const runRow = await dbGet(
      db,
      "SELECT status, row_count, file_path FROM report_schedule_runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 1",
      [scheduleRes.body.id],
    );
    expect(runRow.status).toBe("success");
    expect(runRow.file_path).toContain("exports");

    const logRes = await makeRequest(app, MANAGER_ID).get(
      "/api/reports/delivery-log",
    );
    expect(logRes.status).toBe(200);
    expect(logRes.body.log.some((row) => row.schedule_id === scheduleRes.body.id)).toBe(
      true,
    );
  });

  it("restricts schedule management when the scheduled exports feature is disabled", async () => {
    await dbRun(
      db,
      "UPDATE feature_flags SET enabled = 0 WHERE key = 'reports_scheduled_exports'",
    );

    const res = await makeRequest(app, ADMIN_ID).get("/api/reports/schedules");
    expect(res.status).toBe(503);
    expect(res.body.flag).toBe("reports_scheduled_exports");
  });

  it("allows managers to register report definitions", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/reports/governance/definitions")
      .send({
        report_key: "profit-by-product",
        version: "v2.0.0",
        query_signature: "profit-v2",
        notes: "Coverage test",
      });

    expect(res.status).toBe(200);

    const definitions = await makeRequest(app, MANAGER_ID).get(
      "/api/reports/governance/definitions",
    );
    expect(definitions.status).toBe(200);
    expect(
      definitions.body.definitions.some(
        (definition) =>
          definition.report_key === "profit-by-product" &&
          definition.version === "v2.0.0",
      ),
    ).toBe(true);
  });
});
