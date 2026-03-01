import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestApp,
  closeDb,
  dbRun,
  dbGet,
  dbAll,
} from "../helpers/createTestApp";
import { makeRequest, ADMIN_ID } from "../helpers/request";

describe("Inventory CRUD Integration Tests", () => {
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

  describe("Categories CRUD", () => {
    let categoryId;

    it("should create a new category", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/categories")
        .send({
          name: "Home Appliances",
          description: "Household appliances",
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      categoryId = res.body.id;
    });

    it("should list categories", async () => {
      const res = await makeRequest(app, ADMIN_ID).get("/api/categories");
      expect(res.status).toBe(200);
      expect(res.body.categories.some((c) => c.id === categoryId)).toBe(true);
    });

    it("should update a category", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .put(`/api/categories/${categoryId}`)
        .send({
          name: "Digital Gadgets",
        });
      expect(res.status).toBe(200);
      const cat = await dbGet(db, "SELECT name FROM categories WHERE id = ?", [
        categoryId,
      ]);
      expect(cat.name).toBe("Digital Gadgets");
    });
  });

  describe("Brands CRUD", () => {
    let brandId;

    it("should create a new brand", async () => {
      const res = await makeRequest(app, ADMIN_ID).post("/api/brands").send({
        name: "UniqueBrandX",
      });
      expect(res.status).toBe(200);
      brandId = res.body.id;
    });

    it("should list brands", async () => {
      const res = await makeRequest(app, ADMIN_ID).get("/api/brands");
      expect(res.status).toBe(200);
      expect(res.body.brands.some((b) => b.id === brandId)).toBe(true);
    });
  });

  describe("Products CRUD (Simple)", () => {
    let productId;

    it("should create a simple product", async () => {
      const res = await makeRequest(app, ADMIN_ID).post("/api/products").send({
        name: "Smart Watch",
        barcode: "1122334455",
        price: 15000,
        cost_price: 10000,
        category_id: 1,
        unit: "pcs",
      });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      productId = res.body.id;
    });

    it("should find product via scan", async () => {
      const res = await makeRequest(app, ADMIN_ID).get(
        "/api/products/scan/1122334455",
      );
      expect(res.status).toBe(200);
      expect(res.body.product.name).toBe("Smart Watch");
    });

    it("should update product details", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .put(`/api/products/${productId}`)
        .send({
          price: 16000,
        });
      expect(res.status).toBe(200);
      const p = await dbGet(db, "SELECT price FROM products WHERE id = ?", [
        productId,
      ]);
      expect(p.price).toBe(16000);
    });

    it("should delete a product", async () => {
      const res = await makeRequest(app, ADMIN_ID).delete(
        `/api/products/${productId}`,
      );
      expect(res.status).toBe(200);
      const p = await dbGet(db, "SELECT * FROM products WHERE id = ?", [
        productId,
      ]);
      expect(p).toBeUndefined();
    });
  });

  describe("Products CRUD (Variants)", () => {
    it("should create a product with variants", async () => {
      // 1. Setup Attribute Set and Attributes
      await dbRun(
        db,
        "INSERT INTO attribute_sets (name) VALUES ('T-Shirt Set')",
      );
      const setId = (await dbGet(db, "SELECT last_insert_rowid() as id")).id;

      await dbRun(
        db,
        "INSERT INTO attributes (name, attribute_set_id) VALUES ('Size', ?)",
        [setId],
      );
      const attrId = (await dbGet(db, "SELECT last_insert_rowid() as id")).id;

      await dbRun(
        db,
        "INSERT INTO attribute_options (attribute_id, value) VALUES (?, 'Large')",
        [attrId],
      );
      const optId = (await dbGet(db, "SELECT last_insert_rowid() as id")).id;

      // 2. Create Product with Variant
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/products")
        .send({
          name: "Premium Tee",
          barcode: "TEE-001",
          price: 2000,
          has_variants: 1,
          attribute_set_id: setId,
          variants: [
            {
              sku: "TEE-L",
              barcode: "1000001",
              price: 2200,
              options: [{ attribute_id: attrId, attribute_option_id: optId }],
            },
          ],
        });

      expect(res.status).toBe(200);
      const productId = res.body.id;

      // 3. Verify Variants Exist
      const varRes = await makeRequest(app, ADMIN_ID).get(
        `/api/products/${productId}/variants`,
      );
      expect(varRes.status).toBe(200);
      expect(varRes.body.variants).toHaveLength(1);
      expect(varRes.body.variants[0].sku).toBe("TEE-L");
      expect(varRes.body.variants[0].options[0].option_value).toBe("Large");
    });
  });

  describe("Bulk Operations", () => {
    it("should bulk import products", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/products/bulk-import")
        .send({
          rows: [
            { barcode: "B1", name: "Bulk 1", price: 100 },
            { barcode: "B2", name: "Bulk 2", price: 200 },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(2);

      const count = await dbGet(
        db,
        "SELECT COUNT(*) as c FROM products WHERE barcode IN ('B1', 'B2')",
      );
      expect(count.c).toBe(2);
    });

    it("should bulk delete products", async () => {
      const p1 = await dbGet(
        db,
        "SELECT id FROM products WHERE barcode = 'B1'",
      );
      const p2 = await dbGet(
        db,
        "SELECT id FROM products WHERE barcode = 'B2'",
      );

      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/products/bulk-delete")
        .send({
          ids: [p1.id, p2.id],
        });
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(2);
    });
  });
});
