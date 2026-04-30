/**
 * P31 — POST /api/support/upload must reject SVG.
 *
 * Pre-fix: imageFileFilter whitelisted image/svg+xml + .svg. The route
 * stored client-supplied bytes on R2 with the client-supplied content-type,
 * served back from api.sanopos.com, same-origin to the auth refresh cookie.
 * A crafted SVG with <script>fetch('/api/auth/refresh')...</script> was
 * proven (Phase 7.11 walkthrough) to siphon a fresh access JWT for the
 * victim — full session takeover.
 *
 * Fix: routes/support.js now uses rasterImageFileFilter (subset that drops
 * svg). Product/receipt logo paths still accept SVG because sharp
 * rasterises before storage.
 *
 * This test mounts support.js on a tiny Express app with stub upstream
 * middleware that pretends to be loadTenantAndPerms+resolveTenant, then
 * POSTs an SVG and asserts 400. We never call uploadToR2 — the filter
 * rejects before the handler runs — so this test is hermetic, no R2
 * credentials needed.
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
    // Minimal valid JPEG header bytes — multer fileFilter only checks
    // mimetype + extname, so any byte payload with correct envelope is fine.
    // We don't assert 200 (uploadToR2 would need credentials in CI); we just
    // assert the filter does NOT reject — i.e. the response is NOT 400 with
    // "Only image uploads" / ".jpg is not allowed". A 5xx from R2 in CI is
    // acceptable here as proof that the filter let it through.
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const res = await request(app)
      .post("/api/support/upload")
      .attach("file", jpegBytes, { filename: "ok.jpg", contentType: "image/jpeg" });

    // Filter passed iff status is NOT a multer-filter 400. In CI without R2
    // creds the upload either succeeds locally (200) or fails inside r2.js
    // (500). Either is fine — we only need to prove the filter is permissive
    // for jpeg.
    if (res.status === 400) {
      // If the body looks like a filter error, fail the test — the only
      // expected 400 is from multer, which would carry a filter message.
      expect(res.body.error).not.toMatch(/image|allowed|svg/i);
    } else {
      expect([200, 500]).toContain(res.status);
    }
  });
});
