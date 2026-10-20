// Live 2026-10-20: "Read with AI" failed with "Cannot read properties of
// undefined (reading 'signal')" after the AI had read the whole bill.
// Sentry's Anthropic wrapper swaps the SDK's stream object for its own,
// which has no `controller`, and the SDK's stream helper reads
// stream.controller.signal at the end. Only the live server runs Sentry.
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import path from "path";
import { sentryOptions } from "../../services/sentry-options.js";

const helper = path.join(__dirname, "../helpers/photo-reader-under-sentry.js");

describe("bill photo reader with Sentry on (as on the live server)", () => {
  it("reads the bill instead of failing on 'signal'", () => {
    const out = execFileSync(process.execPath, [helper], { cwd: path.join(__dirname, "../.."), encoding: "utf8", timeout: 30000 });
    expect(out.trim().split("\n").pop()).toBe("OK 171");
  });

  it("Sentry's AI wrapper is left out, everything else kept", () => {
    const opts = sentryOptions({ SENTRY_DSN: "https://abc@o1.ingest.sentry.io/1", NODE_ENV: "production" });
    expect(opts.dsn).toBe("https://abc@o1.ingest.sentry.io/1");
    expect(opts.environment).toBe("production");
    expect(opts.tracesSampleRate).toBe(0);
    const kept = opts.integrations([{ name: "Http" }, { name: "Anthropic_AI" }, { name: "Express" }]);
    expect(kept.map((i) => i.name)).toEqual(["Http", "Express"]);
  });
});
