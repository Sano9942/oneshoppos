const {
  createTestApp,
  closeDb,
  dbRun,
  dbGet,
  dbAll,
} = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

describe("Employee & Role CRUD Integration Tests", () => {
  let app;
  let db;

  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
    db = setup.db;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  describe("Roles & Permissions CRUD", () => {
    let roleId;

    it("should create a new custom role", async () => {
      const res = await makeRequest(app, ADMIN_ID).post("/api/roles").send({
        name: "Inventory Spec",
        description: "Specialist for inventory",
      });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      roleId = res.body.id;
    });

    it("should update role permissions via separate endpoint", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .put(`/api/roles/${roleId}/permissions`)
        .send({
          permissions: ["manage_inventory", "view_reports"],
        });
      expect(res.status).toBe(200);

      const perms = await dbAll(
        db,
        "SELECT permission FROM role_permissions WHERE role_id = ?",
        [roleId],
      );
      expect(perms).toHaveLength(2);
      expect(perms.some((p) => p.permission === "manage_inventory")).toBe(true);
    });

    it("should list roles", async () => {
      const res = await makeRequest(app, ADMIN_ID).get("/api/roles");
      expect(res.status).toBe(200);
      expect(res.body.roles.some((r) => r.id === roleId)).toBe(true);
    });
  });

  describe("Employee CRUD", () => {
    let employeeId;

    it("should create a new employee", async () => {
      const res = await makeRequest(app, ADMIN_ID).post("/api/employees").send({
        name: "Jane Doe",
        pin_code: "5678",
        role_id: 2, // Manager
      });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      employeeId = res.body.id;
    });

    it("should list employees", async () => {
      const res = await makeRequest(app, ADMIN_ID).get("/api/employees");
      expect(res.status).toBe(200);
      expect(res.body.employees.some((e) => e.id === employeeId)).toBe(true);
    });

    it("should update employee profile", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .put(`/api/employees/${employeeId}`)
        .send({
          pin_code: "9999",
        });
      expect(res.status).toBe(200);
      const e = await dbGet(db, "SELECT pin_code FROM employees WHERE id = ?", [
        employeeId,
      ]);
      expect(e.pin_code).toBe("9999");
    });

    it("should delete an employee", async () => {
      const res = await makeRequest(app, ADMIN_ID).delete(
        `/api/employees/${employeeId}`,
      );
      expect(res.status).toBe(200);
      const e = await dbGet(db, "SELECT * FROM employees WHERE id = ?", [
        employeeId,
      ]);
      expect(e).toBeUndefined();
    });
  });
});
