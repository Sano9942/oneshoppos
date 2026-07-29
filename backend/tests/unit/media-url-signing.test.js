/**
 * media-url-signing.test.js
 *
 * Guards the signature scheme that replaced the /r2 proxy's three-prefix
 * allowlist. The properties that matter are the ones an attacker would attack
 * and the ones a refactor would quietly drop:
 *
 *   - a signature is bound to its key and its expiry, so it cannot be moved to
 *     another object or stretched
 *   - backups/ is refused by the signer AND the verifier, independently
 *   - the response interceptor rewrites URLs wherever they are nested, and
 *     leaves bodies without media untouched
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

// The modules under test are CommonJS; Vitest's ESM entry cannot be require()d,
// so bridge in the other direction rather than converting production code.
const require = createRequire(import.meta.url);
const {
  signMediaUrl,
  verifySignature,
  computeSignature,
  isNeverSignable,
  resetSigningKey,
} = require("../../utils/media-url");
const { signMediaUrls } = require("../../middleware/sign-media-urls");

const BASE = "https://api.example.test";
const KEY = "clinical/42/doc_1785_abcdef.pdf";
const URL = `${BASE}/r2/${KEY}`;

/** Minimal res double — captures whichever of json()/send() the code reaches. */
function fakeRes() {
  const res = {
    headers: {},
    sent: null,
    jsoned: null,
    setHeader(k, v) { this.headers[k] = v; },
    send(body) { this.sent = body; return this; },
    json(body) { this.jsoned = body; return this; },
  };
  return res;
}

/** Run the middleware and return the parsed body it actually emitted. */
function throughMiddleware(body) {
  const res = fakeRes();
  signMediaUrls({}, res, () => {});
  res.json(body);
  return res.sent !== null ? JSON.parse(res.sent) : res.jsoned;
}

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret-for-media-signing";
  resetSigningKey();
});

describe("media URL signing", () => {
  it("signs a proxy URL and the proxy accepts it", () => {
    const signed = signMediaUrl(URL);
    expect(signed).not.toBe(URL);
    const q = new URLSearchParams(signed.split("?")[1]);
    expect(verifySignature(KEY, q.get("exp"), q.get("sig"))).toBe(true);
  });

  it("binds the signature to the key — it cannot be moved to another object", () => {
    const q = new URLSearchParams(signMediaUrl(URL).split("?")[1]);
    // Same tenant, same directory, different file: still refused.
    expect(verifySignature("clinical/42/other_doc.pdf", q.get("exp"), q.get("sig"))).toBe(false);
    // The cross-tenant case the shared clinical/<planId>/ directory creates.
    expect(verifySignature("clinical/43/doc_1785_abcdef.pdf", q.get("exp"), q.get("sig"))).toBe(false);
  });

  it("binds the signature to the expiry — it cannot be extended", () => {
    const q = new URLSearchParams(signMediaUrl(URL).split("?")[1]);
    const stretched = Number(q.get("exp")) + 60_000;
    expect(verifySignature(KEY, stretched, q.get("sig"))).toBe(false);
  });

  it("rejects an expired signature even though the MAC is genuine", () => {
    const past = Date.now() - 1000;
    expect(verifySignature(KEY, past, computeSignature(KEY, past))).toBe(false);
  });

  it("rejects missing, malformed and wrong-length signatures", () => {
    const exp = Date.now() + 60_000;
    expect(verifySignature(KEY, exp, undefined)).toBe(false);
    expect(verifySignature(KEY, exp, "")).toBe(false);
    expect(verifySignature(KEY, exp, "deadbeef")).toBe(false);
    expect(verifySignature(KEY, "not-a-number", computeSignature(KEY, 1))).toBe(false);
    expect(verifySignature("", exp, computeSignature(KEY, exp))).toBe(false);
  });

  it("does not honour signatures minted under a different secret", () => {
    const q = new URLSearchParams(signMediaUrl(URL).split("?")[1]);
    process.env.JWT_SECRET = "a-different-secret";
    resetSigningKey();
    expect(verifySignature(KEY, q.get("exp"), q.get("sig"))).toBe(false);
  });

  describe("backups/ is unreachable through both halves independently", () => {
    const backupKey = "backups/full-backup-20260729.dump";

    it("the signer refuses to stamp it", () => {
      const url = `${BASE}/r2/${backupKey}`;
      expect(isNeverSignable(backupKey)).toBe(true);
      expect(signMediaUrl(url)).toBe(url); // returned untouched, no sig appended
    });

    it("the verifier refuses it even when handed a valid MAC", () => {
      // Simulates the signer having been bypassed or bugged: the MAC is real.
      const exp = Date.now() + 60_000;
      expect(verifySignature(backupKey, exp, computeSignature(backupKey, exp))).toBe(false);
    });
  });

  it("is idempotent — a second pass does not double-sign", () => {
    const once = signMediaUrl(URL);
    expect(signMediaUrl(once)).toBe(once);
  });

  it("leaves non-proxy strings alone", () => {
    expect(signMediaUrl("exports/products/x.webp")).toBe("exports/products/x.webp");
    expect(signMediaUrl("https://cdn.example.test/images/x.png")).toBe("https://cdn.example.test/images/x.png");
    expect(signMediaUrl(null)).toBe(null);
    expect(signMediaUrl(42)).toBe(42);
  });
});

describe("sign-media-urls middleware", () => {
  it("passes bodies with no media straight through", () => {
    const res = fakeRes();
    signMediaUrls({}, res, () => {});
    const body = { ok: true, items: [{ id: 1, name: "Widget" }] };
    res.json(body);
    // Untouched means the original json() ran — same object, not a re-parse.
    expect(res.jsoned).toBe(body);
    expect(res.sent).toBe(null);
  });

  it("signs URLs wherever they are nested", () => {
    const out = throughMiddleware({
      visit: { selfie_url: `${BASE}/r2/field-selfies/acme/7/uuid.jpg` },
      documents: [
        { file_url: `${BASE}/r2/clinical/42/a.pdf` },
        { file_url: `${BASE}/r2/clinical/42/b.pdf` },
      ],
      blob: { nested: { deep: [{ signature_url: `${BASE}/r2/consents/42/sig.png` }] } },
    });
    expect(out.visit.selfie_url).toMatch(/[?&]sig=/);
    expect(out.documents[0].file_url).toMatch(/[?&]sig=/);
    expect(out.documents[1].file_url).toMatch(/[?&]sig=/);
    expect(out.blob.nested.deep[0].signature_url).toMatch(/[?&]sig=/);
  });

  it("signs each URL distinctly — one signature does not leak onto its neighbour", () => {
    const out = throughMiddleware({
      a: `${BASE}/r2/clinical/42/a.pdf`,
      b: `${BASE}/r2/clinical/42/b.pdf`,
    });
    const sigOf = (u) => new URLSearchParams(u.split("?")[1]).get("sig");
    expect(sigOf(out.a)).not.toBe(sigOf(out.b));
    expect(verifySignature("clinical/42/a.pdf", new URLSearchParams(out.a.split("?")[1]).get("exp"), sigOf(out.a))).toBe(true);
    expect(verifySignature("clinical/42/b.pdf", new URLSearchParams(out.b.split("?")[1]).get("exp"), sigOf(out.b))).toBe(true);
  });

  it("never signs a backups/ URL that reaches a response body", () => {
    const url = `${BASE}/r2/backups/full-backup-20260729.dump`;
    const out = throughMiddleware({ backup_url: url });
    expect(out.backup_url).toBe(url);
    expect(out.backup_url).not.toMatch(/sig=/);
  });

  it("is mounted in index.js above all route registration", () => {
    // The middleware is only correct if nothing that returns media registers
    // ahead of it. Ordering is invisible at runtime — a route mounted earlier
    // simply serves unsigned URLs that then 404 in the browser, with no error
    // anywhere — so assert it statically rather than trusting review.
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.js"), "utf8");

    const mountedAt = src.indexOf("app.use(signMediaUrls)");
    expect(mountedAt, "signMediaUrls is not mounted in index.js").toBeGreaterThan(-1);

    // Every route-registration call site must come after the mount. The two
    // handlers that legitimately precede it (/uploads static and the /r2 proxy
    // itself) serve bytes, never JSON carrying media URLs.
    const registrations = [...src.matchAll(/^\s*(?:require\([^)]*\)\(app|register[A-Za-z]*Routes\()/gm)];
    expect(registrations.length).toBeGreaterThan(0);
    for (const m of registrations) {
      expect(m.index, `route registration at index ${m.index} precedes the signMediaUrls mount`).toBeGreaterThan(mountedAt);
    }
  });

  it("survives an unserialisable body instead of throwing", () => {
    const res = fakeRes();
    signMediaUrls({}, res, () => {});
    const circular = { name: "loop" };
    circular.self = circular;
    expect(() => res.json(circular)).not.toThrow();
    expect(res.jsoned).toBe(circular);
  });
});
