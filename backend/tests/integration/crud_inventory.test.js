const {
  createTestApp,
  closeDb,
  dbRun,
  dbGet,
  dbAll,
} = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

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
    let childCategoryId;
    let parentWithProductsId;
    let parentProductId;
    let convertedChildId;
    let siblingLeafId;

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

    it("should create a child category with path metadata", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/categories")
        .send({
          name: "Kitchen Devices",
          parent_id: categoryId,
        });
      expect(res.status).toBe(200);
      childCategoryId = res.body.id;

      const listRes = await makeRequest(app, ADMIN_ID).get("/api/categories");
      const child = listRes.body.categories.find((c) => c.id === childCategoryId);
      expect(child.depth).toBe(1);
      expect(child.path_label).toBe("Home Appliances > Kitchen Devices");
      expect(child.is_leaf).toBe(true);
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

    it("should reject deleting a category with children", async () => {
      const res = await makeRequest(app, ADMIN_ID).delete(`/api/categories/${categoryId}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/child categories/i);
    });

    it("should delete an empty leaf category", async () => {
      const res = await makeRequest(app, ADMIN_ID).delete(`/api/categories/${childCategoryId}`);
      expect(res.status).toBe(200);
    });

    it("should block normal child creation under a category with assigned products", async () => {
      const parentRes = await makeRequest(app, ADMIN_ID)
        .post("/api/categories")
        .send({
          name: "Fashion Root",
        });
      expect(parentRes.status).toBe(200);
      parentWithProductsId = parentRes.body.id;

      const productRes = await makeRequest(app, ADMIN_ID).post("/api/products").send({
        name: "Flat Fashion Product",
        barcode: "FASHION-FLAT-001",
        price: 2500,
        category_id: parentWithProductsId,
      });
      expect(productRes.status).toBe(200);
      parentProductId = productRes.body.id;

      const blockedRes = await makeRequest(app, ADMIN_ID)
        .post("/api/categories")
        .send({
          name: "Shirts",
          parent_id: parentWithProductsId,
        });
      expect(blockedRes.status).toBe(400);
      expect(blockedRes.body.code).toBe("parent_has_products");
    });

    it("should create a child and move products in one guided conversion", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/categories/create-child-and-move")
        .send({
          name: "Shirts",
          parent_id: parentWithProductsId,
        });
      expect(res.status).toBe(200);
      expect(res.body.moved_products).toBe(1);
      convertedChildId = res.body.category.id;

      const movedProduct = await dbGet(
        db,
        "SELECT category_id FROM products WHERE id = ?",
        [parentProductId],
      );
      expect(Number(movedProduct.category_id)).toBe(Number(convertedChildId));
    });

    it("should bulk move products from one category to another leaf", async () => {
      const siblingRes = await makeRequest(app, ADMIN_ID)
        .post("/api/categories")
        .send({
          name: "Accessories",
          parent_id: parentWithProductsId,
        });
      expect(siblingRes.status).toBe(200);
      siblingLeafId = siblingRes.body.id;

      const res = await makeRequest(app, ADMIN_ID)
        .post(`/api/categories/${convertedChildId}/move-products`)
        .send({
          target_category_id: siblingLeafId,
        });
      expect(res.status).toBe(200);
      expect(res.body.moved_products).toBe(1);

      const movedProduct = await dbGet(
        db,
        "SELECT category_id FROM products WHERE id = ?",
        [parentProductId],
      );
      expect(Number(movedProduct.category_id)).toBe(Number(siblingLeafId));
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
    let parentCategoryId;
    let leafCategoryId;

    beforeAll(async () => {
      await dbRun(
        db,
        `INSERT INTO categories (id, name, description, parent_id, sort_order, is_active)
         VALUES (20, 'Devices', '', NULL, 0, 1)`,
      );
      await dbRun(
        db,
        `INSERT INTO categories (id, name, description, parent_id, sort_order, is_active)
         VALUES (21, 'Wearables', '', 20, 0, 1)`,
      );
      parentCategoryId = 20;
      leafCategoryId = 21;
    });

    it("should create a simple product", async () => {
      const res = await makeRequest(app, ADMIN_ID).post("/api/products").send({
        name: "Smart Watch",
        barcode: "1122334455",
        price: 15000,
        cost_price: 10000,
        category_id: leafCategoryId,
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

    it("should reject assigning a parent category to a product", async () => {
      const res = await makeRequest(app, ADMIN_ID).post("/api/products").send({
        name: "Invalid Parent Product",
        barcode: "PARENT-001",
        price: 1200,
        category_id: parentCategoryId,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/leaf categories/i);
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
    it("should reject bulk assigning a parent category", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/products/bulk-category")
        .send({
          ids: [1, 2],
          category_id: 20,
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/leaf categories/i);
    });

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

    it("should filter products by parent category including descendants", async () => {
      await makeRequest(app, ADMIN_ID).post("/api/products").send({
        name: "Hierarchy Filter Product",
        barcode: "HIER-001",
        price: 999,
        category_id: 21,
      });
      const res = await makeRequest(app, ADMIN_ID).get("/api/products?category_id=20");
      expect(res.status).toBe(200);
      expect(res.body.products.some((p) => p.name === "Hierarchy Filter Product")).toBe(true);
    });
  });
});
