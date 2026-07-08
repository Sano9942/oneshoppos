/**
 * pg-ai-routes — HTTP wiring for the catalog AI endpoints (Phase 2).
 *
 * These cover the concerns that don't require a live model call: the API-key
 * soft-gate, permission gating, input validation, and image-upload rejection.
 * The actual generation/extraction logic is unit-tested with a mocked client in
 * tests/unit/services-ai.test.js. Every case here short-circuits BEFORE any
 * network call to Anthropic, so no real key or mock is needed.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, cleanup, adminReq, cashierReq;
let savedKey;

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  cleanup = result.cleanup;
  require("../../routes/ai")(app, result.deps);
  adminReq = makeRequest(app, ADMIN_ID);
  cashierReq = makeRequest(app, CASHIER_ID);
  // Default state for most tests: key present (so we exercise validation paths
  // that live after the key check). Safe to mutate now — createTestApp has run.
  savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-not-used-no-network";
}, 60000);

afterAll(async () => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  if (cleanup) await cleanup();
}, 30000);

describe("POST /api/ai/product-content", () => {
  it("403 for an employee without manage_inventory/all_access", async () => {
    const res = await cashierReq.post("/api/ai/product-content").send({ name: "Widget" });
    expect(res.status).toBe(403);
  });

  it("400 'name is required' when name is missing", async () => {
    const res = await adminReq.post("/api/ai/product-content").send({ category: "Apparel" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it("400 'not configured' when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await adminReq.post("/api/ai/product-content").send({ name: "Widget" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not configured|api key/i);
    } finally {
      process.env.ANTHROPIC_API_KEY = "test-key-not-used-no-network";
    }
  });
});

describe("POST /api/ai/invoice-extract", () => {
  it("400 when no image is uploaded", async () => {
    const res = await adminReq.post("/api/ai/invoice-extract");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no image/i);
  });

  it("400 when the uploaded file fails magic-byte verification", async () => {
    const notAnImage = Buffer.from("this is definitely not a jpeg");
    const res = await adminReq
      .post("/api/ai/invoice-extract")
      .attach("file", notAnImage, { filename: "fake.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid image/i);
  });

  it("400 'not configured' when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await adminReq.post("/api/ai/invoice-extract");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not configured|api key/i);
    } finally {
      process.env.ANTHROPIC_API_KEY = "test-key-not-used-no-network";
    }
  });
});
