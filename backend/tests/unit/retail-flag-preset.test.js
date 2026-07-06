import { describe, it, expect, vi } from "vitest";
import {
  RETAIL_SEED_FLAGS,
  RESTAURANT_SEED_FLAGS,
  MULTI_OUTLET_SEED_FLAGS,
  RETAIL_SUBTYPE_FLAGS,
  RETAIL_BUNDLE_INDUSTRIES,
  seedRetailFlags,
  seedRestaurantFlags,
  seedMultiOutletFlags,
  seedRetailSubtypeFlags,
} from "../../services/retail-flag-preset.js";

describe("retail-flag-preset", () => {
  it("exports exactly 19 retail seed flags", () => {
    expect(RETAIL_SEED_FLAGS).toHaveLength(19);
  });

  it("exports exactly 12 restaurant seed flags", () => {
    // 11 F&B flags + delivery_aggregators (V03 foodpanda/Careem injection).
    expect(RESTAURANT_SEED_FLAGS).toHaveLength(12);
  });

  it("exports exactly 5 multi-outlet seed flags", () => {
    expect(MULTI_OUTLET_SEED_FLAGS).toHaveLength(5);
  });

  it("does NOT include kiosk_context_locked in multi-outlet seeds (merchant opt-in)", () => {
    expect(MULTI_OUTLET_SEED_FLAGS).not.toContain("kiosk_context_locked");
  });

  it("includes the four locked retail integrations", () => {
    for (const key of [
      "phase5_cod_reconciliation",
      "phase5_shipping_automation",
      "phase5_sms_providers",
      "sms_campaigns",
    ]) {
      expect(RETAIL_SEED_FLAGS).toContain(key);
    }
  });

  it("RESTAURANT_SEED_FLAGS includes loyalty, gift cards, manager override, delivery integrations, and draft orders", () => {
    for (const key of [
      "phase2g_loyalty",
      "phase2g_gift_cards",
      "phase2g_price_override",
      "phase2_pos_approvals",
      "phase2g_risk_controls",
      "sms_campaigns",
      "phase5_sms_providers",
      "phase5_cod_reconciliation",
      "phase5_shipping_automation",
      "retail_weekly_digest",
      // phase2_draft_orders is required because POSContext.ensureDraftOrder
      // backs every restaurant check with a draft_orders row.
      "phase2_draft_orders",
    ]) {
      expect(RESTAURANT_SEED_FLAGS).toContain(key);
    }
  });

  it("RESTAURANT_SEED_FLAGS excludes retail-only POS flags that don't apply to F&B", () => {
    for (const key of [
      "phase2g_omni_input",
      "phase2g_variant_picker",
      "phase2g_receipt_barcode_lookup",
      "phase2g_per_line_restock",
      "phase2g_holds",
      "phase2g_inventory_intelligence",
      "phase2g_label_designer",
      "phase2_item_suggestions",
    ]) {
      expect(RESTAURANT_SEED_FLAGS).not.toContain(key);
    }
  });

  it("seedRetailFlags issues one upsert per flag with enabled=true", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    await seedRetailFlags(client);
    expect(client.query).toHaveBeenCalledTimes(RETAIL_SEED_FLAGS.length);

    // Spot-check the first call's SQL + params
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO feature_flags/);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO UPDATE SET enabled = true/);
    expect(params).toEqual([RETAIL_SEED_FLAGS[0]]);
  });

  it("seedRestaurantFlags issues one upsert per flag with enabled=true", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    await seedRestaurantFlags(client);
    expect(client.query).toHaveBeenCalledTimes(RESTAURANT_SEED_FLAGS.length);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO feature_flags/);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO UPDATE SET enabled = true/);
    expect(params).toEqual([RESTAURANT_SEED_FLAGS[0]]);
  });

  it("seedMultiOutletFlags issues one upsert per multi-outlet flag", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    await seedMultiOutletFlags(client);
    expect(client.query).toHaveBeenCalledTimes(MULTI_OUTLET_SEED_FLAGS.length);
  });

  // V01 retail depth — the buy/sell retail family shares the retail bundle, and
  // each perishable/lot/kit sub-type layers its vertical engines on top. These
  // assertions guard against drift in the signup flag-seeding contract.
  describe("V01 retail sub-type seeding", () => {
    it("RETAIL_BUNDLE_INDUSTRIES covers all six buy/sell retail presets", () => {
      expect(RETAIL_BUNDLE_INDUSTRIES).toEqual([
        "general_retail",
        "grocery",
        "wholesale",
        "butcher",
        "sweet_shop",
        "textile",
      ]);
    });

    it("maps the exact per-preset vertical-engine flags", () => {
      expect(RETAIL_SUBTYPE_FLAGS).toEqual({
        grocery: ["batch_expiry_tracking"],
        butcher: ["batch_expiry_tracking", "kit_bom_engine"],
        sweet_shop: ["batch_expiry_tracking", "kit_bom_engine"],
        textile: ["batch_expiry_tracking"],
      });
    });

    it("grocery/textile get batch tracking but NOT the kit engine", () => {
      expect(RETAIL_SUBTYPE_FLAGS.grocery).not.toContain("kit_bom_engine");
      expect(RETAIL_SUBTYPE_FLAGS.textile).not.toContain("kit_bom_engine");
    });

    it("butcher + sweet_shop get both batch + kit engines (disassembly / assorted box)", () => {
      for (const preset of ["butcher", "sweet_shop"]) {
        expect(RETAIL_SUBTYPE_FLAGS[preset]).toContain("batch_expiry_tracking");
        expect(RETAIL_SUBTYPE_FLAGS[preset]).toContain("kit_bom_engine");
      }
    });

    it("seedRetailSubtypeFlags upserts the preset's engines, no-ops for general_retail/wholesale", async () => {
      const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
      await seedRetailSubtypeFlags(client, "butcher");
      expect(client.query).toHaveBeenCalledTimes(2); // batch + kit
      const [sql, params] = client.query.mock.calls[0];
      expect(sql).toMatch(/ON CONFLICT \(key\) DO UPDATE SET enabled = true/);
      expect(params).toEqual(["batch_expiry_tracking"]);

      client.query.mockClear();
      await seedRetailSubtypeFlags(client, "general_retail");
      expect(client.query).not.toHaveBeenCalled();
      await seedRetailSubtypeFlags(client, "wholesale");
      expect(client.query).not.toHaveBeenCalled();
    });
  });
});
