import { describe, it, expect, vi } from "vitest";
import {
  RETAIL_SEED_FLAGS,
  MULTI_OUTLET_SEED_FLAGS,
  seedRetailFlags,
  seedMultiOutletFlags,
} from "../../services/retail-flag-preset.js";

describe("retail-flag-preset", () => {
  it("exports exactly 19 retail seed flags", () => {
    expect(RETAIL_SEED_FLAGS).toHaveLength(19);
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

  it("seedMultiOutletFlags issues one upsert per multi-outlet flag", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    await seedMultiOutletFlags(client);
    expect(client.query).toHaveBeenCalledTimes(MULTI_OUTLET_SEED_FLAGS.length);
  });
});
