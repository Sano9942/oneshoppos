/**
 * pg-v08-photography.test.js — V08 photography depth.
 *
 * Backend half of the plan's verification bar (the closed Studio Ninja loop):
 *   - Pre-flight spine fix: quotation → approve → convert-to-project carries the
 *     accepted total as the project budget (was silently NULL — read `total`
 *     instead of `total_amount`).
 *   - P1a public inquiry → CRM lead (source='inquiry_form') + staff notification;
 *     validation guard; spam bulk-dismiss.
 *   - P1b questionnaires via F03: templates auto-attach on project creation,
 *     surface on the project page, and the client sees ONLY their own on the
 *     portal (cross-customer scoping).
 *   - P1c gallery: staff upload → mark client-visible; portal grid serves
 *     R2-direct URLs (never the /r2 proxy); client selects → staff notified.
 *   - HARDEN — portal IDOR: client B cannot read/select/submit client A's
 *     gallery (404), and cannot see A's questionnaires.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const supertest = require("supertest");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const sharp = require("sharp");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

const STUB_TENANT = { id: 999, slug: "studio", name: "Studio Co" };
const publicTenantCtx = require("../../services/public-tenant-context");
const originalResolve = publicTenantCtx.resolvePublicTenantDb;

describe("V08 — photography depth (Postgres)", () => {
  let app, db, deps, cleanup, req, staff;
  let tokenA, tokenB, custA, custB;

  beforeAll(async () => {
    process.env.CUSTOMER_PORTAL_JWT_SECRET = "v08-test-secret";
    ({ app, db, deps, cleanup } = await createTestApp());

    // Portal + public routes resolve tenant through this — pin it to the test db.
    publicTenantCtx.resolvePublicTenantDb = async () => ({ db, tenant: STUB_TENANT });

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });
    const { requireFeature } = require("../../middleware/feature-flags");
    const { requirePerm } = require("../../middleware/permissions");

    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_service_projects', true),
        ('phase4_appointments', true),
        ('crm_quotations', true),
        ('notifications', true),
        ('custom_forms', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);
    await db.query(
      "INSERT INTO tenant_modes (mode, enabled) VALUES ('service_projects', true), ('appointments', true) ON CONFLICT (mode) DO NOTHING"
    );
    await db.query("UPDATE company_profile SET industry_type = 'photography_studio' WHERE id = 1");

    // Seed the two photography questionnaires (setup.js / migration v122 do this
    // in the real app; the test seeds them directly).
    await db.query(
      `INSERT INTO form_templates (name, entity_scope, fields, require_signature, auto_attach, is_active)
       VALUES ('Event Timeline', 'project', '[{"key":"venue","label":"Venue","type":"text","required":true}]'::jsonb, false, 'project_created', true),
              ('Shot List', 'project', '[{"key":"must_have_shots","label":"Must-have shots","type":"textarea","required":true}]'::jsonb, false, 'project_created', true)`
    );

    app.use(cookieParser());
    require("../../routes/projects")(app, deps);
    require("../../routes/public-inquiries")(app, deps);
    require("../../routes/customer-portal/auth")(app, deps);
    require("../../routes/customer-portal/forms")(app, deps);
    require("../../routes/customer-portal/gallery")(app, deps);

    const crmRouter = require("../../routes/tier4/crm")({
      db, requireFeature, requirePerm, createNotification: () => {},
    });
    app.use(crmRouter);

    req = supertest(app);
    staff = makeRequest(app, ADMIN_ID);

    // Two portal-enabled clients.
    const pw = await bcrypt.hash("Client1234!", 4);
    const mk = async (name, email) => {
      const { rows: [c] } = await db.query(
        `INSERT INTO customers (name, email, portal_password_hash, portal_enabled_at, portal_email_verified_at)
         VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
        [name, email, pw]
      );
      const login = await req.post("/api/portal/auth/login?tenant=studio").send({ email, password: "Client1234!" }).expect(200);
      return { id: c.id, token: login.body.access_token };
    };
    const a = await mk("Ayesha", "ayesha@example.com");
    const b = await mk("Bilal", "bilal@example.com");
    custA = a.id; tokenA = a.token;
    custB = b.id; tokenB = b.token;
  }, 90000);

  afterAll(async () => {
    publicTenantCtx.resolvePublicTenantDb = originalResolve;
    if (cleanup) await cleanup();
    delete process.env.CUSTOMER_PORTAL_JWT_SECRET;
  }, 30000);

  // ── Pre-flight spine fix ────────────────────────────────────────────
  describe("spine: quotation → project budget", () => {
    it("carries the accepted total as the project budget", async () => {
      const projects = require("../../services/projects");
      const { rows: [q] } = await db.query(
        `INSERT INTO quotations (quote_number, customer_id, outlet_id, status, estimate_status, subtotal, tax_total, total_amount)
         VALUES ('Q-V08-1', $1, 1, 'draft', 'draft', 5000, 0, 5000) RETURNING id`,
        [custA]
      );
      await projects.approveQuotation(db, q.id, ADMIN_ID);
      const project = await projects.convertQuotationToProject(db, q.id, ADMIN_ID);
      expect(Number(project.budget)).toBe(5000);
    });
  });

  // ── P1a public inquiry ──────────────────────────────────────────────
  describe("public inquiry → lead", () => {
    it("creates a CRM lead + staff notification", async () => {
      const res = await req
        .post("/api/public/inquiries?tenant=studio")
        .send({ name: "Sana", phone: "0300", email: "sana@example.com", event_type: "Wedding", event_date: "2026-12-01", message: "Full day coverage?" })
        .expect(201);
      expect(res.body.id).toBeTruthy();

      const { rows: [lead] } = await db.query("SELECT * FROM crm_leads WHERE id = $1", [res.body.id]);
      expect(lead.source).toBe("inquiry_form");
      expect(lead.stage).toBe("new");
      expect(lead.notes).toContain("Wedding");

      const { rows: notifs } = await db.query("SELECT * FROM notifications WHERE type = 'inquiry_received'");
      expect(notifs.length).toBeGreaterThan(0);
    });

    it("rejects an inquiry with no name (400)", async () => {
      await req.post("/api/public/inquiries?tenant=studio").send({ phone: "0300" }).expect(400);
    });

    it("bulk-dismisses spam leads", async () => {
      await db.query("INSERT INTO crm_leads (name, stage, source) VALUES ('junk', 'spam', 'inquiry_form')");
      await staff.delete("/api/crm/leads/spam").expect(200);
      const { rows } = await db.query("SELECT * FROM crm_leads WHERE stage = 'spam'");
      expect(rows.length).toBe(0);
    });
  });

  // ── P1b questionnaires ──────────────────────────────────────────────
  describe("questionnaires via F03", () => {
    let projectId;
    it("auto-attaches templates on project creation", async () => {
      const projects = require("../../services/projects");
      const project = await projects.createProject(db, { name: "Ayesha Wedding", customer_id: custA }, ADMIN_ID);
      projectId = project.id;
      const { rows } = await db.query(
        "SELECT * FROM form_responses WHERE entity_type = 'project' AND entity_id = $1",
        [projectId]
      );
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.status === "pending" && r.customer_id === custA)).toBe(true);
    });

    it("surfaces questionnaires on the project page", async () => {
      const projects = require("../../services/projects");
      const full = await projects.getProject(db, projectId);
      expect(full.questionnaires.length).toBe(2);
    });

    it("client sees only their own questionnaires on the portal", async () => {
      const a = await req.get("/api/portal/me/forms?tenant=studio").set("Authorization", `Bearer ${tokenA}`).expect(200);
      expect(a.body.forms.length).toBeGreaterThanOrEqual(2);
      const b = await req.get("/api/portal/me/forms?tenant=studio").set("Authorization", `Bearer ${tokenB}`).expect(200);
      expect(b.body.forms.length).toBe(0);
    });
  });

  // ── P1c gallery + HARDEN IDOR ───────────────────────────────────────
  describe("gallery proofing + IDOR", () => {
    let projA, projB, fileA;

    beforeAll(async () => {
      const { rows: [pa] } = await db.query(
        "INSERT INTO service_projects (name, customer_id, created_by) VALUES ('A Shoot', $1, $2) RETURNING id",
        [custA, ADMIN_ID]
      );
      const { rows: [pb] } = await db.query(
        "INSERT INTO service_projects (name, customer_id, created_by) VALUES ('B Shoot', $1, $2) RETURNING id",
        [custB, ADMIN_ID]
      );
      projA = pa.id; projB = pb.id;
    });

    it("staff uploads an image (client_visible defaults false)", async () => {
      const img = await sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png().toBuffer();
      const res = await staff
        .post(`/api/projects/${projA}/files`)
        .attach("files", img, "shot1.png")
        .expect(201);
      expect(res.body.files.length).toBe(1);
      fileA = res.body.files[0];
      expect(fileA.client_visible).toBe(false);
      // R2-direct: never wrapped in the Express /r2 streaming proxy.
      expect(String(fileA.file_url)).not.toContain("/r2/");
    });

    it("staff marks the shot client-visible", async () => {
      await staff.put(`/api/projects/${projA}/files/${fileA.id}`).send({ client_visible: true }).expect(200);
    });

    it("client sees the visible shot in their portal gallery", async () => {
      const list = await req.get("/api/portal/me/projects?tenant=studio").set("Authorization", `Bearer ${tokenA}`).expect(200);
      const row = list.body.projects.find((p) => p.id === projA);
      expect(row.gallery_count).toBe(1);

      const gal = await req.get(`/api/portal/me/projects/${projA}/gallery?tenant=studio`).set("Authorization", `Bearer ${tokenA}`).expect(200);
      expect(gal.body.files.length).toBe(1);
      expect(String(gal.body.files[0].file_url)).not.toContain("/r2/");
    });

    it("client selects a shot and submits → staff notified + selection visible", async () => {
      await req.put(`/api/portal/me/projects/${projA}/gallery/${fileA.id}?tenant=studio`).set("Authorization", `Bearer ${tokenA}`).send({ selected: true }).expect(200);
      const sub = await req.post(`/api/portal/me/projects/${projA}/gallery/submit?tenant=studio`).set("Authorization", `Bearer ${tokenA}`).expect(200);
      expect(sub.body.selected_count).toBe(1);

      const { rows: notifs } = await db.query("SELECT * FROM notifications WHERE type = 'gallery_selection'");
      expect(notifs.length).toBeGreaterThan(0);

      const projects = require("../../services/projects");
      const full = await projects.getProject(db, projA);
      expect(full.files.find((f) => f.id === fileA.id).client_selected).toBe(true);
    });

    it("IDOR: client B cannot read client A's gallery (404)", async () => {
      await req.get(`/api/portal/me/projects/${projA}/gallery?tenant=studio`).set("Authorization", `Bearer ${tokenB}`).expect(404);
    });

    it("IDOR: client B cannot select in client A's gallery (404)", async () => {
      await req.put(`/api/portal/me/projects/${projA}/gallery/${fileA.id}?tenant=studio`).set("Authorization", `Bearer ${tokenB}`).send({ selected: true }).expect(404);
    });

    it("IDOR: client B cannot submit selection on client A's project (404)", async () => {
      await req.post(`/api/portal/me/projects/${projA}/gallery/submit?tenant=studio`).set("Authorization", `Bearer ${tokenB}`).expect(404);
    });

    it("client B's project list excludes client A's project", async () => {
      const list = await req.get("/api/portal/me/projects?tenant=studio").set("Authorization", `Bearer ${tokenB}`).expect(200);
      expect(list.body.projects.find((p) => p.id === projA)).toBeUndefined();
    });
  });
});
