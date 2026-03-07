const { createTestApp, closeDb, dbRun, dbGet } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

describe("Settings CRUD Integration Tests", () => {
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

  describe("Outlets CRUD", () => {
    let outletId;

    it("should create a new outlet", async () => {
      const res = await makeRequest(app, ADMIN_ID).post("/api/outlets").send({
        name: "Warehouse Alpha",
        address: "123 Industrial Rd",
        phone: "555-0101",
      });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      outletId = res.body.id;
    });

    it("should list outlets", async () => {
      const res = await makeRequest(app, ADMIN_ID).get("/api/outlets");
      expect(res.status).toBe(200);
      expect(res.body.outlets.some((o) => o.id === outletId)).toBe(true);
    });

    it("should update an outlet", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .put(`/api/outlets/${outletId}`)
        .send({
          name: "Grand Central Flagship",
        });
      expect(res.status).toBe(200);
      const o = await dbGet(db, "SELECT name FROM outlets WHERE id = ?", [
        outletId,
      ]);
      expect(o.name).toBe("Grand Central Flagship");
    });
  });

  describe("Taxes CRUD", () => {
    let taxId;

    it("should create a new tax rate", async () => {
      const res = await makeRequest(app, ADMIN_ID).post("/api/taxes").send({
        name: "Service Tax 10%",
        rate: 10,
        is_default: 1,
      });
      expect(res.status).toBe(200);
      taxId = res.body.id;
    });

    it("should list taxes", async () => {
      const res = await makeRequest(app, ADMIN_ID).get("/api/taxes");
      expect(res.status).toBe(200);
      expect(res.body.taxes.some((t) => t.id === taxId)).toBe(true);
    });

    it("should update a tax rate", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .put(`/api/taxes/${taxId}`)
        .send({
          rate: 16,
        });
      expect(res.status).toBe(200);
      const t = await dbGet(db, "SELECT rate FROM taxes WHERE id = ?", [taxId]);
      expect(t.rate).toBe(16);
    });
  });

  describe("Templates CRUD", () => {
    it("should create and update receipt templates", async () => {
      // 1. Create
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/receipt-templates")
        .send({
          name: "Standard Receipt",
          header_text: "Welcome to Sano Shop",
          footer_text: "Thank you for your business",
          show_logo: 1,
          is_active: 1,
        });
      if (res.status !== 200) console.log("Receipt Create Error:", res.body);
      expect(res.status).toBe(200);
      const templateId = res.body.id;

      // 2. Update
      const updateRes = await makeRequest(app, ADMIN_ID)
        .put(`/api/receipt-templates/${templateId}`)
        .send({
          name: "Standard Receipt Updated",
          header_text: "Welcome to Sano Shop v2",
          is_active: 1,
        });
      expect(updateRes.status).toBe(200);

      const t = await dbGet(
        db,
        "SELECT header_text FROM receipt_templates WHERE id = ?",
        [templateId],
      );
      expect(t.header_text).toBe("Welcome to Sano Shop v2");
    });

    it("should create and update barcode templates", async () => {
      // 1. Create
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/barcode-templates")
        .send({
          name: "Jewelry Label",
          width_mm: 50,
          height_mm: 30,
          show_name: 1,
          show_price: 1,
          is_default: 1,
        });
      if (res.status !== 200) console.log("Barcode Create Error:", res.body);
      expect(res.status).toBe(200);
      const templateId = res.body.id;

      // 2. Update
      const updateRes = await makeRequest(app, ADMIN_ID)
        .put(`/api/barcode-templates/${templateId}`)
        .send({
          name: "Jewelry Label Updated",
          width_mm: 55,
          height_mm: 30,
          show_name: 1,
          show_price: 1,
          show_barcode: 1,
          show_sku: 0,
          show_brand: 0,
          font_size: 12,
          is_default: 1,
        });
      if (updateRes.status !== 200)
        console.log("Barcode Update Error:", updateRes.body);
      expect(updateRes.status).toBe(200);

      const t = await dbGet(
        db,
        "SELECT width_mm FROM barcode_templates WHERE id = ?",
        [templateId],
      );
      expect(t.width_mm).toBe(55);
    });
  });
});
