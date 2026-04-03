import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";

// ── alerting ──────────────────────────────────────────────────────────────────
// alerting.js has module-level mutable state (the windows Map). Each test uses
// Node.js require cache manipulation to get a fresh alerting.js module (clean
// windows state) while keeping the shared alertEmail module so vi.spyOn can
// intercept calls. alerting.js uses non-destructured require so property-level
// spying works at call time.

const _require = createRequire(import.meta.url);

/** Clear alerting.js from the require cache so the next _require() gives a
 *  fresh module with an empty windows Map. */
function clearAlertingFromCache() {
  const key = Object.keys(require.cache).find(
    (k) => k.includes("services") && k.includes("alerting.js")
  );
  if (key) delete require.cache[key];
}

describe("alerting — recordError", () => {
  let recordError;
  let sendAlertEmailSpy;

  beforeEach(() => {
    // Spy on alertEmail's CJS exports before loading alerting
    const alertEmailCjs = _require("../../utils/alertEmail.js");
    sendAlertEmailSpy = vi
      .spyOn(alertEmailCjs, "sendAlertEmail")
      .mockResolvedValue(undefined);

    // Load a fresh alerting.js (empty windows Map)
    clearAlertingFromCache();
    const alertingMod = _require("../../services/alerting.js");
    recordError = alertingMod.recordError;

    sendAlertEmailSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send email when error count is below threshold (10)", async () => {
    for (let i = 0; i < 9; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(sendAlertEmailSpy).not.toHaveBeenCalled();
  });

  it("sends alert email exactly once when threshold is reached", async () => {
    for (let i = 0; i < 10; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1);
  });

  it("includes tenant name in the alert email subject", async () => {
    for (let i = 0; i < 10; i++) {
      await recordError({ tenant: "my-tenant", message: "err" });
    }
    const call = sendAlertEmailSpy.mock.calls[0][0];
    expect(call.subject).toContain("Error spike");
  });

  it("does not send a second alert before cooldown expires (window reset after first send)", async () => {
    // First burst — triggers alert and resets window
    for (let i = 0; i < 10; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1);

    // Second burst — window was reset, count starts fresh, below threshold again
    for (let i = 0; i < 9; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1); // still 1
  });

  it("handles missing tenant and message gracefully", async () => {
    for (let i = 0; i < 10; i++) {
      await recordError({});
    }
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1);
  });
});

describe("alerting — recordDbPressure", () => {
  let recordDbPressure;
  let sendAlertEmailSpy;

  beforeEach(() => {
    const alertEmailCjs = _require("../../utils/alertEmail.js");
    sendAlertEmailSpy = vi
      .spyOn(alertEmailCjs, "sendAlertEmail")
      .mockResolvedValue(undefined);

    clearAlertingFromCache();
    const alertingMod = _require("../../services/alerting.js");
    recordDbPressure = alertingMod.recordDbPressure;

    sendAlertEmailSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends alert on first call (threshold is 1)", async () => {
    await recordDbPressure({ active: 18, max: 20, longestQuery: "SELECT *" });
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1);
    const call = sendAlertEmailSpy.mock.calls[0][0];
    expect(call.subject).toContain("DB pressure");
  });
});
