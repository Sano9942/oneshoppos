/**
 * P31 + P32 — POST /api/support/upload upload-security regression.
 *
 * P31: Pre-fix, imageFileFilter whitelisted image/svg+xml + .svg. The
 * route stored client-supplied bytes on R2 with the client-supplied
 * content-type, served back from api.sanopos.com same-origin to the auth
 * refresh cookie. A crafted SVG with <script>fetch('/api/auth/refresh')</script>
 * was proven (Phase 7.11 walkthrough) to siphon a fresh access JWT for
 * the victim — full session takeover.
 *
 * Fix: routes/support.js uses rasterImageFileFilter (subset that drops
 * svg). Product/receipt logo paths keep SVG because sharp rasterises.
 *
 * P32: Pre-fix, the route trusted file.mimetype (set from the client
 * multipart envelope) without sniffing actual bytes — payload.exe
 * renamed payload.jpg with Content-Type: image/jpeg landed on R2.
 *
 * Fix: verifyImageMagicBytes(buffer, mimetype) check between multer and
 * uploadToR2. EXE/ZIP/empty/anything-not-matching-the-claim → 400.
 *
 * This test mounts support.js on a tiny Express app with stub upstream
 * middleware. R2 is never reached — both fixes reject before uploadToR2
 * is called — so the test is hermetic, no R2 credentials needed.
 */
const request = require("supertest");
const express = require("express");

describe("P31 — support upload rejects SVG", () => {
  let app;

  beforeAll(() => {
    app = express();
    // Stub upstream middleware — provide the fields the support route reads.
    app.use((req, res, next) => {
      req.tenantSlug = "test_p31";
      req.employee = { id: 1, name: "Test", email: null };
      req.company = { company_name: "Test Tenant" };
      req.log = { error: () => {} };
      next();
    });

    // Mount the route. db is unused on the upload path itself, but support.js
    // reads deps.db at module-load time for other routes — pass a stub.
    const deps = { db: { query: async () => ({ rows: [] }) } };
    require("../../routes/support")(app, deps);
  });

  it("rejects image/svg+xml with a 400", async () => {
    const svgBytes = Buffer.from(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><script>alert(2)</script></svg>`
    );
    const res = await request(app)
      .post("/api/support/upload")
      .attach("file", svgBytes, { filename: "xss.svg", contentType: "image/svg+xml" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image/i);
  });

  it("rejects an .svg extension even when MIME claims image/png", async () => {
    const bytes = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const res = await request(app)
      .post("/api/support/upload")
      .attach("file", bytes, { filename: "sneaky.svg", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(".svg");
  });

  it("still accepts image/jpeg (smoke — does not regress legit uploads)", async () => {
    // Real JPEG magic bytes. Filter + magic-byte verifier (P32) both pass.
    // We don't assert 200 (uploadToR2 needs creds in CI); we assert the
    // response is NOT a 400 carrying a filter/verifier error. A 5xx from
    // r2.js without creds is fine — it proves we got past the gates.
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const res = await request(app)
      .post("/api/support/upload")
      .attach("file", jpegBytes, { filename: "ok.jpg", contentType: "image/jpeg" });

    if (res.status === 400) {
      expect(res.body.error).not.toMatch(/image|allowed|svg|contents do not match/i);
    } else {
      expect([200, 500]).toContain(res.status);
    }
  });

  // ── P32 — magic-byte verification ────────────────────────────────────

  it("P32: rejects EXE bytes renamed .jpg with image/jpeg content-type", async () => {
    // DOS MZ header — the exact attack confirmed live in Phase 7.11.
    const mzBytes = Buffer.alloc(64);
    mzBytes.write("MZ", 0);
    mzBytes.write("This program cannot be run in DOS mode.", 4);

    const res = await request(app)
      .post("/api/support/upload")
      .attach("file", mzBytes, { filename: "payload.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contents do not match/i);
  });

  it("P32: rejects PNG bytes claimed as image/jpeg (mismatched but real-image bytes)", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const res = await request(app)
      .post("/api/support/upload")
      .attach("file", pngBytes, { filename: "fake.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contents do not match/i);
  });

  it("P32: rejects empty buffer (no magic bytes)", async () => {
    const res = await request(app)
      .post("/api/support/upload")
      .attach("file", Buffer.alloc(0), { filename: "empty.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    // Multer may treat 0-byte attachments as no-file in some configs; either
    // "No file uploaded" or "File contents do not match" is acceptable —
    // both close the P32 hole. We only require a 400.
    expect(res.body.error).toMatch(/no file|contents do not match/i);
  });
});
