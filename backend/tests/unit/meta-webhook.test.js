"use strict";

/**
 * Verification contract for the Meta-signed channels (PLAN-V3 Step W0a2).
 *
 * Two things are load-bearing here:
 *
 * (1) The GET handshake must never echo the challenge to an unauthenticated
 *     caller. The bug this replaced compared `token === process.env.X` with X
 *     unset — `undefined === undefined` — so omitting hub.verify_token returned
 *     200 to anyone. The "unconfigured token refuses" cases below are that
 *     regression, pinned.
 *
 * (2) The signature contract is Meta's (hex, x-hub-signature-256, app secret),
 *     NOT the aggregator's (base64) and NOT Shopify's (base64). A digest-encoding
 *     regression would fail-close every real webhook — silently, since a rejected
 *     delivery just vanishes — so the encoding is asserted explicitly rather than
 *     only round-tripped through our own signer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

import {
  META_PROVIDERS,
  SIGNATURE_HEADER,
  resolveAppSecret,
  resolveVerifyToken,
  verifyHandshake,
  verifySignature,
  signBody,
} from "../../services/meta-webhook.js";

const ENV_KEYS = [
  "META_APP_SECRET",
  "WHATSAPP_APP_SECRET",
  "META_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
];

let saved;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("secret resolution", () => {
  it("covers exactly the two Meta-signed providers", () => {
    expect(META_PROVIDERS).toEqual(["facebook", "whatsapp"]);
  });

  it("returns null when unconfigured — callers must fail closed, not skip", () => {
    expect(resolveAppSecret("facebook")).toBeNull();
    expect(resolveAppSecret("whatsapp")).toBeNull();
    expect(resolveVerifyToken("facebook")).toBeNull();
    expect(resolveVerifyToken("whatsapp")).toBeNull();
  });

  it("lets WhatsApp override the shared secret but falls back to it", () => {
    process.env.META_APP_SECRET = "shared";
    expect(resolveAppSecret("whatsapp")).toBe("shared");
    expect(resolveAppSecret("facebook")).toBe("shared");

    process.env.WHATSAPP_APP_SECRET = "wa-only";
    expect(resolveAppSecret("whatsapp")).toBe("wa-only");
    // The override must not bleed into the commerce channel.
    expect(resolveAppSecret("facebook")).toBe("shared");
  });
});

describe("GET handshake", () => {
  it("REGRESSION: refuses when the verify token is unset, even with no token supplied", () => {
    // The exact undefined === undefined shape of the original bypass.
    const r = verifyHandshake({ provider: "facebook", mode: "subscribe", token: undefined });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_verify_token_configured");
  });

  it("REGRESSION: refuses when the verify token is unset and a token IS supplied", () => {
    const r = verifyHandshake({ provider: "whatsapp", mode: "subscribe", token: "anything" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_verify_token_configured");
  });

  it("accepts a set + matching token", () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "tok-abc";
    expect(verifyHandshake({ provider: "facebook", mode: "subscribe", token: "tok-abc" }))
      .toEqual({ ok: true });
  });

  it("rejects a mismatched token, a bad mode, and a missing token", () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "tok-abc";
    expect(verifyHandshake({ provider: "facebook", mode: "subscribe", token: "tok-xyz" }).reason)
      .toBe("token_mismatch");
    expect(verifyHandshake({ provider: "facebook", mode: "unsubscribe", token: "tok-abc" }).reason)
      .toBe("bad_mode");
    expect(verifyHandshake({ provider: "facebook", mode: "subscribe", token: "" }).reason)
      .toBe("missing_token");
  });

  it("does not let a length-mismatched token throw the constant-time compare", () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "short";
    expect(() =>
      verifyHandshake({ provider: "facebook", mode: "subscribe", token: "considerably-longer" })
    ).not.toThrow();
  });

  it("keys the token per provider", () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "fb-tok";
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "wa-tok";
    expect(verifyHandshake({ provider: "whatsapp", mode: "subscribe", token: "fb-tok" }).ok).toBe(false);
    expect(verifyHandshake({ provider: "whatsapp", mode: "subscribe", token: "wa-tok" }).ok).toBe(true);
  });
});

describe("POST signature", () => {
  const SECRET = "app-secret-123";
  const BODY = JSON.stringify({ object: "page", entry: [{ id: "42" }] });

  const headersFor = (sig) => ({ [SIGNATURE_HEADER]: sig });

  it("accepts a correctly signed body", () => {
    const headers = headersFor(signBody(BODY, SECRET));
    expect(verifySignature({ rawBody: BODY, headers, secret: SECRET })).toEqual({ ok: true });
  });

  it("pins Meta's contract: sha256= prefix + HEX digest over the raw body", () => {
    // Computed independently of signBody — this is the assertion that catches a
    // copy-paste of the aggregator's base64 verifier.
    const expectedHex = crypto.createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex");
    expect(signBody(BODY, SECRET)).toBe(`sha256=${expectedHex}`);
    expect(expectedHex).toMatch(/^[0-9a-f]{64}$/);

    const asBase64 = crypto.createHmac("sha256", SECRET).update(BODY, "utf8").digest("base64");
    expect(verifySignature({ rawBody: BODY, headers: headersFor(`sha256=${asBase64}`), secret: SECRET }).ok)
      .toBe(false);
  });

  it("fails closed when no app secret is configured", () => {
    const headers = headersFor(signBody(BODY, SECRET));
    expect(verifySignature({ rawBody: BODY, headers, secret: null }).reason)
      .toBe("no_app_secret_configured");
    expect(verifySignature({ rawBody: BODY, headers, secret: "" }).reason)
      .toBe("no_app_secret_configured");
  });

  it("rejects a wrong secret, a tampered body, and a missing signature", () => {
    expect(verifySignature({ rawBody: BODY, headers: headersFor(signBody(BODY, "wrong")), secret: SECRET }).reason)
      .toBe("invalid_signature");
    expect(verifySignature({ rawBody: `${BODY} `, headers: headersFor(signBody(BODY, SECRET)), secret: SECRET }).reason)
      .toBe("invalid_signature");
    expect(verifySignature({ rawBody: BODY, headers: {}, secret: SECRET }).reason)
      .toBe("missing_signature");
  });

  it("distinguishes an uncaptured raw body from an empty one", () => {
    const headers = headersFor(signBody("", SECRET));
    // Body never captured — must not be silently hashed as "".
    expect(verifySignature({ rawBody: undefined, headers, secret: SECRET }).reason).toBe("no_raw_body");
    // A genuinely empty body still verifies on its own signature.
    expect(verifySignature({ rawBody: "", headers, secret: SECRET }).ok).toBe(true);
  });

  it("rejects malformed signature values rather than throwing", () => {
    for (const bad of ["", "deadbeef", "sha1=abc", "sha256=", "sha256=nothex!!", "sha256=abc"]) {
      const r = verifySignature({ rawBody: BODY, headers: headersFor(bad), secret: SECRET });
      expect(r.ok).toBe(false);
    }
  });

  it("reads the header case-insensitively and unwraps a repeated header", () => {
    const sig = signBody(BODY, SECRET);
    expect(verifySignature({ rawBody: BODY, headers: { "X-Hub-Signature-256": sig }, secret: SECRET }).ok).toBe(true);
    expect(verifySignature({ rawBody: BODY, headers: { [SIGNATURE_HEADER]: [sig] }, secret: SECRET }).ok).toBe(true);
  });

  it("accepts an uppercase hex digest (Meta sends lowercase; be liberal on input)", () => {
    const sig = signBody(BODY, SECRET).toUpperCase().replace("SHA256=", "sha256=");
    expect(verifySignature({ rawBody: BODY, headers: headersFor(sig), secret: SECRET }).ok).toBe(true);
  });

  it("verifies a unicode body byte-exactly", () => {
    const body = JSON.stringify({ text: "سلام — naïve 🚀" });
    const headers = headersFor(signBody(body, SECRET));
    expect(verifySignature({ rawBody: body, headers, secret: SECRET }).ok).toBe(true);
  });
});
