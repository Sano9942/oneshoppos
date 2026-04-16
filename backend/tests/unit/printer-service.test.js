import { describe, it, expect, vi } from "vitest";
import printerModule from "../../services/printer.js";

const { withRetry } = printerModule;

describe("withRetry", () => {
  it("returns immediately on first success (no retries consumed)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 2, 1);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once on failure then succeeds on second attempt", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error("network glitch");
      return "recovered";
    });
    const result = await withRetry(fn, 2, 1);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after exhausting all retries", async () => {
    const err = new Error("printer offline");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 2, 1)).rejects.toThrow("printer offline");
    // retries=2 means 3 total attempts (0, 1, 2)
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff (500ms * 2^attempt by default)", async () => {
    // Verify the waits happen — we don't need precision here, just prove
    // that on 2 retries the total wait is at least baseDelay * (1 + 2) = 3ms
    // with baseDelay=1ms.
    const start = Date.now();
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(withRetry(fn, 2, 1)).rejects.toThrow();
    const elapsed = Date.now() - start;
    // With baseDelayMs=1, waits are 1ms then 2ms → 3ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(3);
  });

  it("honors retries=0 (single attempt, no retries)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("one-shot"));
    await expect(withRetry(fn, 0, 1)).rejects.toThrow("one-shot");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("openDrawer (factory behavior)", () => {
  const factory = printerModule;

  it("returns { ok: false } when printer is not configured (DB returns null)", async () => {
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const service = factory(mockDb);
    const result = await service.openDrawer();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured|inactive/i);
  });

  it("returns { ok: false } when printer is_active is false", async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ is_active: false, cash_drawer: true }] }),
    };
    const service = factory(mockDb);
    const result = await service.openDrawer();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/inactive|not configured/i);
  });

  it("returns { ok: false } when cash_drawer is disabled in config", async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          is_active: true,
          cash_drawer: false,
          connection_type: "network",
          host: "192.168.1.100",
          port: 9100,
        }],
      }),
    };
    const service = factory(mockDb);
    const result = await service.openDrawer();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cash drawer not enabled/i);
  });

  it("returns { ok: false } on DB error", async () => {
    const mockDb = {
      query: vi.fn().mockRejectedValue(new Error("connection refused")),
    };
    const service = factory(mockDb);
    const result = await service.openDrawer();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DB error/i);
  });
});

describe("printer factory exports", () => {
  it("exposes openDrawer on the service instance", () => {
    const mockDb = { query: vi.fn() };
    const service = printerModule(mockDb);
    expect(typeof service.openDrawer).toBe("function");
  });

  it("still exposes the original methods (printReceipt, printerStatus, printTest, printToNetwork)", () => {
    const mockDb = { query: vi.fn() };
    const service = printerModule(mockDb);
    expect(typeof service.printReceipt).toBe("function");
    expect(typeof service.printerStatus).toBe("function");
    expect(typeof service.printTest).toBe("function");
    expect(typeof service.printToNetwork).toBe("function");
  });
});
