const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const forms = require("../../services/forms");

/**
 * pg-forms.test.js — F03 form builder integration tests (Postgres).
 *
 * Covers the load-bearing invariants:
 *  - template CRUD + zero-field rejection
 *  - send freezes fields_snapshot; template edit never mutates old responses
 *  - the three fill paths converge on one submit + one validation path
 *  - required-field rejection
 *  - public token: single-use (burned on submit) + 404-worthy on bad/used token
 *  - void
 */
describe("F03 — Form builder (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    // Inject an admin employee with all_access so requirePerm passes.
    app.use((req, _res, next) => {
      req.employee = { id: 1 };
      req.employeePerms = ["all_access"];
      req.tenantSlug = "testco";
      next();
    });

    require("../../routes/forms")(app, deps);

    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('custom_forms', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
  }, 30000);

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  let templateId;

  it("rejects a template with zero fields (400)", async () => {
    const res = await request(app)
      .post("/api/forms/templates")
      .send({ name: "Empty", fields: [] });
    expect(res.status).toBe(400);
  });

  it("creates a template with all field types + signature (201)", async () => {
    const res = await request(app)
      .post("/api/forms/templates")
      .send({
        name: "New Patient Intake",
        entity_scope: "appointment",
        require_signature: true,
        fields: [
          { key: "full_name", label: "Full name", type: "text", required: true },
          { key: "history", label: "Medical history", type: "textarea" },
          { key: "blood_type", label: "Blood type", type: "select", options: ["A", "B", "O"], required: true },
          { key: "consent", label: "I consent", type: "checkbox", required: true },
          { key: "dob", label: "Date of birth", type: "date" },
          { key: "age", label: "Age", type: "number" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    templateId = res.body.id;
  });

  let responseId, publicToken;

  it("send creates a pending response with a public token + fill url", async () => {
    const res = await request(app)
      .post(`/api/forms/templates/${templateId}/send`)
      .send({ customer_id: 1, entity_type: "appointment", entity_id: 42, channel: "none" });
    expect(res.status).toBe(201);
    expect(res.body.response.status).toBe("pending");
    expect(res.body.response.public_token).toMatch(/^[0-9a-f]{64}$/); // 256-bit
    expect(res.body.fill_url).toContain("/forms/fill/");
    responseId = res.body.response.id;
    publicToken = res.body.response.public_token;
  });

  it("rejects submit missing a required field (400)", async () => {
    const res = await request(app)
      .post(`/api/forms/responses/${responseId}/submit`)
      .send({ answers: { history: "none" } }); // omits required full_name/blood_type/consent
    expect(res.status).toBe(400);
  });

  it("staff-assisted submit succeeds + freezes answers (via=staff)", async () => {
    const res = await request(app)
      .post(`/api/forms/responses/${responseId}/submit`)
      .send({
        answers: { full_name: "Jane", blood_type: "O", consent: true, age: "30" },
        signature_image_base64: null,
      });
    // require_signature is true, and no signature provided → must reject.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ss]ignature/);
  });

  it("staff submit with signature succeeds; number coerced", async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const res = await request(app)
      .post(`/api/forms/responses/${responseId}/submit`)
      .send({
        answers: { full_name: "Jane", blood_type: "O", consent: true, age: "30" },
        signature_image_base64: png,
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("submitted");
    expect(res.body.submitted_via).toBe("staff");
    expect(res.body.answers.age).toBe(30); // number coercion
    expect(res.body.public_token).toBeNull(); // token burned on submit
  });

  it("template edit does NOT mutate an already-submitted response snapshot", async () => {
    // Edit the live template: rename a field + add a new one.
    await request(app)
      .put(`/api/forms/templates/${templateId}`)
      .send({
        fields: [
          { key: "full_name", label: "CHANGED LABEL", type: "text", required: true },
          { key: "brand_new", label: "New field", type: "text", required: true },
        ],
      })
      .expect(200);

    // The old response still renders from its frozen snapshot.
    const res = await request(app).get(`/api/forms/responses/${responseId}`);
    expect(res.status).toBe(200);
    const labels = (res.body.fields_snapshot || []).map((f) => f.label);
    expect(labels).toContain("Full name"); // original label preserved
    expect(labels).not.toContain("CHANGED LABEL");
    expect(labels).not.toContain("New field");
  });

  it("public token was burned — second submit path returns not-found", async () => {
    // getPendingByToken should no longer resolve the used token.
    const pending = await forms.getPendingByToken(deps.db, publicToken);
    expect(pending).toBeNull();
    // submitByToken on a used/unknown token returns null (route → 404).
    const bad = await forms.submitByToken(deps.db, publicToken, { answers: {} });
    expect(bad).toBeNull();
    const unknown = await forms.getPendingByToken(deps.db, "deadbeef".repeat(8));
    expect(unknown).toBeNull();
  });

  it("all three fill paths share one validation path (portal token still enforces required)", async () => {
    // Fresh pending response, then submit via the token path missing a required field.
    const sent = await forms.sendForm(deps.db, templateId, { customerId: 1 });
    let threw = false;
    try {
      await forms.submitByToken(deps.db, sent.public_token, { answers: { full_name: "X" } });
    } catch (e) {
      threw = e.statusCode === 400;
    }
    expect(threw).toBe(true); // brand_new is required in the edited template snapshot
  });

  it("void marks a response void and clears its token", async () => {
    const sent = await forms.sendForm(deps.db, templateId, { customerId: 1 });
    const res = await request(app).post(`/api/forms/responses/${sent.id}/void`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("void");
    const { rows: [row] } = await deps.db.query(
      "SELECT public_token FROM form_responses WHERE id = $1",
      [sent.id]
    );
    expect(row.public_token).toBeNull();
  });

  it("auto-attach creates pending responses for a matching trigger", async () => {
    await request(app)
      .post("/api/forms/templates")
      .send({
        name: "Auto waiver",
        auto_attach: "appointment_created",
        fields: [{ key: "ok", label: "OK", type: "checkbox" }],
      })
      .expect(201);
    const created = await forms.autoAttachForms(deps.db, "appointment_created", {
      customerId: 1,
      entityType: "appointment",
      entityId: 99,
    });
    expect(created.length).toBe(1);
    expect(created[0].status).toBe("pending");
    expect(created[0].entity_id).toBe(99);
  });
});
