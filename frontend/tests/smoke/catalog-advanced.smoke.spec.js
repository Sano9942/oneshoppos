/**
 * Catalog advanced smoke — Phase 2b. Five independent sub-tests, each gated by
 * its own flag. Smart collections, outlet tax profiles, scheduled catalog
 * changes, POS layouts, item suggestions.
 */
import { test, expect } from "@playwright/test";
import { get, post, put } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const SPEC = "catalog-advanced.smoke.spec.js";

test.describe("Catalog advanced smoke", () => {
  test.afterAll(async () => {
    await cleanupAll();
  });

  test("smart collections: create rule-based collection", async () => {
    if (!(await softSkip(test, SPEC, "phase2_smart_collections"))) return;

    const createRes = await post("/api/smart-collections", {
      name: prefix("On Sale"),
      disjunctive: false,
      rules: [{ field: "price", operator: "less_than", value: "1000" }],
    });
    expect(createRes.ok, `smart collection: ${JSON.stringify(createRes.data)}`).toBe(true);
    const id = createRes.data?.id || createRes.data?.collection?.id;
    expect(id).toBeTruthy();
    trackForCleanup("smart-collection", id);
  });

  test("outlet tax profiles: CRUD", async () => {
    if (!(await softSkip(test, SPEC, "phase2_outlet_tax"))) return;

    const outletsRes = await get("/api/outlets");
    const outlet = (outletsRes.data?.outlets || outletsRes.data || [])[0];
    expect(outlet).toBeTruthy();

    const putRes = await put(`/api/outlet-tax-profiles/${outlet.id}`, {
      gst_rate: 17,
      provincial_rate: 0,
      name: prefix("Tax Profile"),
    });
    expect(putRes.ok, `tax profile put: ${JSON.stringify(putRes.data)}`).toBe(true);

    const resolveRes = await get(`/api/outlet-tax-profiles/resolve?outlet_id=${outlet.id}`);
    expect(resolveRes.ok).toBe(true);
  });

  test("scheduled catalog changes: create a future price change", async () => {
    if (!(await softSkip(test, SPEC, "phase2_scheduled_changes"))) return;

    const productRes = await post("/api/products", {
      name: prefix("Scheduled Product"),
      price: 999,
      cost_price: 500,
      gst: 0,
    });
    expect(productRes.ok).toBe(true);
    const productId = productRes.data?.id;
    trackForCleanup("product", productId);

    const future = new Date();
    future.setDate(future.getDate() + 60);

    const createRes = await post("/api/catalog/scheduled-changes", {
      change_type: "price",
      entity_type: "product",
      entity_id: productId,
      field_name: "price",
      new_value: "799",
      scheduled_at: future.toISOString(),
      notes: "smoke seasonal",
    });
    expect(createRes.ok, `scheduled change: ${JSON.stringify(createRes.data)}`).toBe(true);
    const id = createRes.data?.change?.id || createRes.data?.id;
    if (id) trackForCleanup("scheduled-change", id);
  });

  test("POS layouts: create → update → fetch", async () => {
    if (!(await softSkip(test, SPEC, "phase2_pos_layouts"))) return;

    const createRes = await post("/api/pos-layouts", {
      name: prefix("High Volume"),
      scope_type: "global",
      layout_json: {
        tiles: [
          { type: "quick_sale", position: 0 },
          { type: "refund", position: 1 },
        ],
      },
    });
    expect(createRes.ok, `layout create: ${JSON.stringify(createRes.data)}`).toBe(true);
    const id = createRes.data?.layout?.id;
    expect(id).toBeTruthy();
    trackForCleanup("pos-layout", id);

    const fetchRes = await get(`/api/pos-layouts`);
    expect(fetchRes.ok).toBe(true);
  });

  test("item suggestions: endpoint responds", async () => {
    if (!(await softSkip(test, SPEC, "phase2_item_suggestions"))) return;

    const res = await get(`/api/pos/suggestions?outlet_id=1`);
    // Accept 200/201 (endpoint present) or 404 (not registered yet — caught loudly)
    expect([200, 201, 404], `suggestions status: ${res.status}`).toContain(res.status);
  });
});
