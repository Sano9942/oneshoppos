import { describe, it, expect, vi } from "vitest";
import {
  RETAIL_SEED_FLAGS,
  RESTAURANT_SEED_FLAGS,
  MULTI_OUTLET_SEED_FLAGS,
  seedRetailFlags,
  seedRestaurantFlags,
  seedMultiOutletFlags,
} from "../../services/retail-flag-preset.js";

describe("retail-flag-preset", () => {
  it("exports exactly 19 retail seed flags", () => {
    expect(RETAIL_SEED_FLAGS).toHaveLength(19);
  });

  it("exports exactly 10 restaurant seed flags", () => {
    expect(RESTAURANT_SEED_FLAGS).toHaveLength(10);
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

  it("RESTAURANT_SEED_FLAGS includes loyalty, gift cards, manager override, and delivery integrations", () => {
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
      "phase2_draft_orders",
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
});
