/**
 * pg-v05-clinical.test.js — V05 clinical depth.
 *
 * Covers the recall/continuing-care loop (arm on plan/session completion,
 * suppression while a future appointment exists, book-from-recall completes +
 * re-arms), vet vaccinations as recall specialization (per-vaccine type keys),
 * the outreach worker (cadence, attempt cap, auto-book, event routing),
 * structured allergies + the prescribe-time name-match warning, the treatment
 * folio-tax slice (session fee from plan.tax_id, pos_sale carries the sale's
 * own tax, settle writes real per-line rates), deposit release on discontinue,
 * and portal subject-scope on the new handout/vaccination endpoints.
 */

const supertest = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const tp = require("../../services/treatment-plan-service");
const recalls = require("../../services/recall-service");
const { runOnce } = require("../../workers/recall-worker-boss");

// ── Portal tenant resolver stub (must precede portal route require) ──
const STUB_TENANT = { id: 999, slug: "acme", name: "Acme Clinic" };
const publicTenantCtx = require("../../services/public-tenant-context");
let testDb;
publicTenantCtx.resolvePublicTenantDb = async () => ({ db: testDb, tenant: STUB_TENANT });

let app, db, deps, cleanup, req;

async function makeCustomer(name = "Ali Raza", email = "ali@x.co", mobile = "03001234567") {
  const { rows: [c] } = await db.query(
    "INSERT INTO customers (name, email, mobile) VALUES ($1, $2, $3) RETURNING id",
    [name, email, mobile]
  );
  return c.id;
}

async function makeSubject(customerId, name = "Self", extra = {}) {
  return tp.createPatientSubject(db, {
    customer_id: customerId,
    subject_type: extra.subject_type || "self",
    name,
    ...extra,
  });
}

async function makeActivePlan(customerId, opts = {}) {
  const plan = await tp.createPlan(db, {
    customer_id: customerId,
    subject_id: opts.subject_id || null,
    title: opts.title || "Test plan",
    total_sessions_planned: opts.sessions || 2,
    recall_interval_months: opts.recall_interval_months,
    recall_type: opts.recall_type || "checkup",
    tax_id: opts.tax_id || null,
  }, ADMIN_ID);
  await tp.transitionPlanStatus(db, plan.id, "active", ADMIN_ID);
  return plan;
}

async function makeBookingService() {
  const { rows: [s] } = await db.query(
    `INSERT INTO booking_services (name, duration_minutes, price) VALUES ('Checkup', 30, 1000) RETURNING id`
  );
  return s.id;
}

async function makeAppointment(customerId, { startAt = "NOW() + INTERVAL '3 days'", serviceId, planId = null } = {}) {
  const { rows: [a] } = await db.query(
    `INSERT INTO appointments (service_id, customer_id, start_at, end_at, status, treatment_plan_id)
     VALUES ($1, $2, ${startAt}, ${startAt} + INTERVAL '30 minutes', 'confirmed', $3) RETURNING id`,
    [serviceId, customerId, planId]
  );
  return a.id;
}

async function openRecalls(customerId) {
  const { rows } = await db.query(
    `SELECT *, due_date::text AS due_date FROM patient_recalls
      WHERE customer_id = $1 AND status IN ('due','contacted','booked') ORDER BY id`,
    [customerId]
  );
  return rows;
}

async function setFlag(key, enabled) {
  await db.query(
    "INSERT INTO feature_flags (key, enabled) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET enabled = $2",
    [key, enabled]
  );
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();
}

function fakeNotifyDeps() {
  const calls = { sms: [], email: [] };
  return {
    calls,
    enqueueEmail: async (_db, payload) => { calls.email.push(payload); },
    sendSms: async (_db, { to, body }) => { calls.sms.push({ to, body }); return { sent: true, provider_ref: "fake" }; },
    sendWhatsApp: async () => ({ skipped: true, error: "not configured" }),
  };
}

beforeAll(async () => {
  process.env.CUSTOMER_PORTAL_JWT_SECRET = "v05-test-portal-secret";
  const result = await createTestApp();
  app = result.app; db = result.db; deps = result.deps; cleanup = result.cleanup;
  testDb = db;
  await db.query("SET TIME ZONE 'UTC'");
  // Real feature-flag middleware needs init({ db }) in the harness (same as
  // pg-treatment-plans.test.js) — without it requireFeature 500s.
  require("../../middleware/feature-flags").init({ db });
  for (const key of ["phase4_treatment_plans", "clinical_recalls", "vet_vaccinations", "clinical_handouts"]) {
    await db.query(
      "INSERT INTO feature_flags (key, enabled) VALUES ($1, true) ON CONFLICT (key) DO UPDATE SET enabled = true",
      [key]
    );
  }
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();
  require("../../routes/treatment-plans")(app, deps);
  require("../../routes/recalls")(app, deps);
  require("../../routes/handouts")(app, deps);
  require("../../routes/customer-portal/treatments")(app, {});
  req = makeRequest(app, ADMIN_ID);
}, 120000);

afterAll(async () => { if (cleanup) await cleanup(); }, 30000);

// ── Recall arm / advance ──────────────────────────────────────────────

describe("V05 — recall arm/advance", () => {
  test("completing a plan with recall config arms a recall at +interval", async () => {
    const c = await makeCustomer("Arm One", "arm1@x.co");
    const plan = await makeActivePlan(c, { recall_interval_months: 6, sessions: 1 });
    await tp.transitionPlanStatus(db, plan.id, "completed", ADMIN_ID);

    const open = await openRecalls(c);
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("due");
    expect(open[0].recall_type).toBe("checkup");
    expect(open[0].interval_months).toBe(6);
    expect(open[0].source_plan_id).toBe(plan.id);
    const { rows: [d] } = await db.query(
      "SELECT ((CURRENT_DATE + make_interval(months => 6))::date = due_date) AS ok FROM patient_recalls WHERE id = $1",
      [open[0].id]
    );
    expect(d.ok).toBe(true);
  });

  test("completing a session advances the open recall (one open per key, history kept)", async () => {
    const c = await makeCustomer("Arm Two", "arm2@x.co");
    const plan = await makeActivePlan(c, { recall_interval_months: 3, sessions: 3 });

    const s1 = await tp.createSession(db, plan.id, {}, ADMIN_ID);
    await tp.completeSession(db, s1.id, {}, ADMIN_ID);
    let open = await openRecalls(c);
    expect(open).toHaveLength(1);

    const s2 = await tp.createSession(db, plan.id, {}, ADMIN_ID);
    await tp.completeSession(db, s2.id, {}, ADMIN_ID);
    open = await openRecalls(c);
    expect(open).toHaveLength(1); // still exactly one open

    const { rows: all } = await db.query(
      "SELECT status FROM patient_recalls WHERE customer_id = $1 ORDER BY id",
      [c]
    );
    expect(all.length).toBe(2); // cycle history: completed + due
    expect(all[0].status).toBe("completed");
    expect(all[1].status).toBe("due");
  });

  test("suppression: arming while a future appointment exists auto-books the recall", async () => {
    const c = await makeCustomer("Suppress", "sup@x.co");
    const svc = await makeBookingService();
    const futureAppt = await makeAppointment(c, { serviceId: svc });
    const plan = await makeActivePlan(c, { recall_interval_months: 6, sessions: 1 });
    await tp.transitionPlanStatus(db, plan.id, "completed", ADMIN_ID);

    const open = await openRecalls(c);
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("booked");
    expect(open[0].appointment_id).toBe(futureAppt);
  });

  test("subject-scoped recall is NOT suppressed by another subject's appointment", async () => {
    const c = await makeCustomer("Two Pets", "pets@x.co");
    const rex = await makeSubject(c, "Rex", { subject_type: "pet", species: "dog" });
    const felix = await makeSubject(c, "Felix", { subject_type: "pet", species: "cat" });
    const svc = await makeBookingService();
    // Future appointment linked (via plan) to Felix only.
    const felixPlan = await makeActivePlan(c, { subject_id: felix.id, sessions: 1 });
    await makeAppointment(c, { serviceId: svc, planId: felixPlan.id });

    // Arm a recall for Rex — must stay 'due' (Felix's visit is not Rex's).
    const r = await recalls.armRecall(db, {
      customerId: c, subjectId: rex.id, recallType: "checkup", intervalMonths: 12,
    });
    expect(r.status).toBe("due");
  });
});

// ── Book-from-recall loop ─────────────────────────────────────────────

describe("V05 — book-from-recall loop", () => {
  test("book links an appointment; completing that visit completes + re-arms", async () => {
    const c = await makeCustomer("Loop", "loop@x.co");
    const plan = await makeActivePlan(c, { recall_interval_months: 6, sessions: 2 });
    const s1 = await tp.createSession(db, plan.id, {}, ADMIN_ID);
    await tp.completeSession(db, s1.id, {}, ADMIN_ID);
    const [recall] = await openRecalls(c);
    expect(recall.status).toBe("due");

    const svc = await makeBookingService();
    const appt = await makeAppointment(c, { serviceId: svc });
    const res = await req.post(`/api/recalls/${recall.id}/book`).send({ appointment_id: appt });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("booked");
    expect(res.body.appointment_id).toBe(appt);

    // The booked visit happens: a session tied to that appointment completes.
    const { rows: [s2] } = await db.query(
      `INSERT INTO treatment_sessions (plan_id, session_number, appointment_id, status)
       VALUES ($1, 99, $2, 'scheduled') RETURNING *`,
      [plan.id, appt]
    );
    await tp.completeSession(db, s2.id, {}, ADMIN_ID);

    const { rows: after } = await db.query(
      "SELECT status FROM patient_recalls WHERE customer_id = $1 ORDER BY id",
      [c]
    );
    // First cycle completed at booking-visit completion; a fresh one is armed.
    expect(after.filter((r) => r.status === "completed").length).toBeGreaterThanOrEqual(1);
    const open = await openRecalls(c);
    expect(open).toHaveLength(1);
    expect(["due", "booked"]).toContain(open[0].status);
  });

  test("book with scheduled_at 400s cleanly when appointments require a service", async () => {
    const c = await makeCustomer("NoSvc", "nosvc@x.co");
    const r = await recalls.armRecall(db, { customerId: c, recallType: "checkup", intervalMonths: 1 });
    const res = await req.post(`/api/recalls/${r.id}/book`).send({ scheduled_at: new Date(Date.now() + 86400000).toISOString() });
    expect(`${res.status} ${res.body.error || ""}`).toMatch(/^400/);
  });
});

// ── Overdue screen routes ─────────────────────────────────────────────

describe("V05 — overdue-patients screen", () => {
  test("GET /api/recalls?overdue=1 lists overdue with days_overdue; contact stamps attempt", async () => {
    const c = await makeCustomer("Overdue", "ovd@x.co");
    await recalls.armRecall(db, { customerId: c, recallType: "hygiene", dueDate: "2020-01-01", intervalMonths: 6 });

    const list = await req.get("/api/recalls?overdue=1");
    expect(`${list.status} ${JSON.stringify(list.body.error || "")}`).toMatch(/^200/);
    const mine = list.body.recalls.filter((r) => r.customer_id === c);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0].days_overdue)).toBeGreaterThan(1000);

    // customer_notifications flag is OFF here — contact still stamps the
    // attempt and reports reason 'disabled' (auditable no-send).
    const contact = await req.put(`/api/recalls/${mine[0].id}/contact`).send({});
    expect(contact.status).toBe(200);
    expect(contact.body.recall.status).toBe("contacted");
    expect(contact.body.recall.contact_attempts).toBe(1);

    const dismiss = await req.put(`/api/recalls/${mine[0].id}/dismiss`).send({ notes: "moved away" });
    expect(dismiss.status).toBe(200);
    expect(dismiss.body.status).toBe("dismissed");
  });

  test("recall routes 403 when clinical_recalls flag is off", async () => {
    await setFlag("clinical_recalls", false);
    const res = await req.get("/api/recalls");
    expect(res.status).toBe(403);
    await setFlag("clinical_recalls", true);
  });
});

// ── Outreach worker ───────────────────────────────────────────────────

describe("V05 — recall outreach worker", () => {
  beforeAll(async () => {
    await db.query(
      "INSERT INTO feature_flags (key, enabled) VALUES ('customer_notifications', true) ON CONFLICT (key) DO UPDATE SET enabled = true"
    );
  });

  test("due recall fires sms+email via F05 and stamps contacted (clock-shifted)", async () => {
    const c = await makeCustomer("Worker One", "w1@x.co", "03111111111");
    const subj = await makeSubject(c, "Worker One");
    await recalls.armRecall(db, {
      customerId: c, subjectId: subj.id, recallType: "checkup",
      intervalMonths: 6, dueDate: "2020-06-01", // long overdue = clock-shift
    });

    const fake = fakeNotifyDeps();
    const workerErrors = [];
    const collectingLogger = { error: (o, m) => workerErrors.push(`${m}: ${JSON.stringify(o)}`) };
    const n = await runOnce(db, { tenantSlug: "acme", tenantName: "Acme Clinic", notifyDeps: fake, logger: collectingLogger });
    expect(workerErrors).toEqual([]);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(fake.calls.sms.length).toBeGreaterThanOrEqual(1);
    const mine = fake.calls.sms.find((s) => s.to.includes("3111111111"));
    expect(mine.body).toMatch(/6-month checkup/);
    expect(mine.body).toMatch(/\/book\/acme/);

    const { rows: [r] } = await db.query(
      "SELECT * FROM patient_recalls WHERE customer_id = $1", [c]
    );
    expect(r.status).toBe("contacted");
    expect(r.contact_attempts).toBe(1);
    expect(r.last_contacted_at).toBeTruthy();

    // Delivery audit rows written by the engine
    const { rows: audit } = await db.query(
      "SELECT channel, status FROM customer_notifications WHERE customer_id = $1", [c]
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  test("cadence: a just-contacted recall is not re-contacted", async () => {
    const fake = fakeNotifyDeps();
    await runOnce(db, { tenantSlug: "acme", notifyDeps: fake });
    // Recalls contacted in the previous test are inside the 30-day cadence.
    expect(fake.calls.sms.filter((s) => s.to.includes("3111111111"))).toHaveLength(0);
  });

  test("attempt cap: contact_attempts >= 3 stops outreach", async () => {
    const c = await makeCustomer("Capped", "cap@x.co", "03122222222");
    const r = await recalls.armRecall(db, { customerId: c, recallType: "checkup", dueDate: "2020-01-01", intervalMonths: 6 });
    await db.query("UPDATE patient_recalls SET contact_attempts = 3 WHERE id = $1", [r.id]);
    const fake = fakeNotifyDeps();
    await runOnce(db, { tenantSlug: "acme", notifyDeps: fake });
    expect(fake.calls.sms.filter((s) => s.to.includes("3122222222"))).toHaveLength(0);
  });

  test("fire-time suppression: patient booked since arming → auto-booked, not texted", async () => {
    const c = await makeCustomer("Booked Since", "bs@x.co", "03133333333");
    const r = await recalls.armRecall(db, { customerId: c, recallType: "checkup", dueDate: "2020-01-01", intervalMonths: 6 });
    expect(r.status).toBe("due");
    const svc = await makeBookingService();
    const appt = await makeAppointment(c, { serviceId: svc });

    const fake = fakeNotifyDeps();
    await runOnce(db, { tenantSlug: "acme", notifyDeps: fake });
    expect(fake.calls.sms.filter((s) => s.to.includes("3133333333"))).toHaveLength(0);
    const { rows: [after] } = await db.query("SELECT * FROM patient_recalls WHERE id = $1", [r.id]);
    expect(after.status).toBe("booked");
    expect(after.appointment_id).toBe(appt);
  });

  test("vaccination recall routes to recall.vaccination_due with vaccine copy", async () => {
    const c = await makeCustomer("Vax Owner", "vaxo@x.co", "03144444444");
    const pet = await makeSubject(c, "Bella", { subject_type: "pet", species: "dog" });
    await recalls.administerVaccination(db, {
      subjectId: pet.id, vaccineName: "Rabies", nextDue: "2020-02-01",
    });
    const fake = fakeNotifyDeps();
    await runOnce(db, { tenantSlug: "acme", notifyDeps: fake });
    const mine = fake.calls.sms.find((s) => s.to.includes("3144444444"));
    expect(mine).toBeTruthy();
    expect(mine.body).toMatch(/Rabies/i);
    expect(mine.body).toMatch(/Bella/);
  });

  test("worker no-ops when clinical_recalls flag is off", async () => {
    await db.query("UPDATE feature_flags SET enabled = false WHERE key = 'clinical_recalls'");
    const fake = fakeNotifyDeps();
    const n = await runOnce(db, { tenantSlug: "acme", notifyDeps: fake });
    expect(n).toBe(0);
    expect(fake.calls.sms).toHaveLength(0);
    await db.query("UPDATE feature_flags SET enabled = true WHERE key = 'clinical_recalls'");
  });
});

// ── Vaccinations ──────────────────────────────────────────────────────

describe("V05 — vet vaccinations", () => {
  test("administer writes the record and arms a per-vaccine recall at next_due", async () => {
    const c = await makeCustomer("Vax A", "vaxa@x.co");
    const pet = await makeSubject(c, "Rocky", { subject_type: "pet", species: "dog" });
    const res = await req.post("/api/vaccinations").send({
      patient_subject_id: pet.id, vaccine_name: "Rabies",
      next_due: "2030-01-15", batch_number: "B-42",
    });
    expect(res.status).toBe(201);
    expect(res.body.record.vaccine_name).toBe("Rabies");
    expect(res.body.recall.recall_type).toBe("vaccination:rabies");
    expect(res.body.recall.due_date).toBe("2030-01-15");
    expect(res.body.recall.vaccination_record_id).toBe(res.body.record.id);
  });

  test("re-administering the same vaccine advances its recall; other vaccines coexist", async () => {
    const c = await makeCustomer("Vax B", "vaxb@x.co");
    const pet = await makeSubject(c, "Milo", { subject_type: "pet", species: "cat" });
    await recalls.administerVaccination(db, { subjectId: pet.id, vaccineName: "Rabies", nextDue: "2030-01-01" });
    await recalls.administerVaccination(db, { subjectId: pet.id, vaccineName: "Distemper", nextDue: "2030-03-01" });
    let open = await openRecalls(c);
    expect(open.map((r) => r.recall_type).sort()).toEqual(["vaccination:distemper", "vaccination:rabies"]);

    // Booster given: rabies recall advances (old completed, new armed).
    await recalls.administerVaccination(db, { subjectId: pet.id, vaccineName: "Rabies", nextDue: "2031-01-01" });
    open = await openRecalls(c);
    expect(open).toHaveLength(2);
    const rabies = open.find((r) => r.recall_type === "vaccination:rabies");
    expect(rabies.due_date).toBe("2031-01-01");
  });

  test("vaccination card lists records + upcoming recalls", async () => {
    const c = await makeCustomer("Vax C", "vaxc@x.co");
    const pet = await makeSubject(c, "Coco", { subject_type: "pet", species: "dog" });
    await recalls.administerVaccination(db, { subjectId: pet.id, vaccineName: "Parvo", nextDue: "2030-06-01", batchNumber: "P-1" });
    const res = await req.get(`/api/patient-subjects/${pet.id}/vaccination-card`);
    expect(res.status).toBe(200);
    expect(res.body.subject.name).toBe("Coco");
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].batch_number).toBe("P-1");
    expect(res.body.upcoming).toHaveLength(1);
    expect(res.body.upcoming[0].due_date).toBe("2030-06-01");
  });

  test("vaccination endpoints 403 without the vet_vaccinations flag", async () => {
    await setFlag("vet_vaccinations", false);
    const res = await req.post("/api/vaccinations").send({ patient_subject_id: 1, vaccine_name: "X" });
    expect(res.status).toBe(403);
    await setFlag("vet_vaccinations", true);
  });
});

// ── Allergies / prescribe-time warning ───────────────────────────────

describe("V05 — structured allergies + prescribe warning", () => {
  test("subject stores allergies/alerts/medications via the API", async () => {
    const c = await makeCustomer("Allergy A", "alla@x.co");
    const subj = await makeSubject(c, "Allergy A");
    const res = await req.put(`/api/patient-subjects/${subj.id}`).send({
      allergies: ["Penicillin", "Latex"],
      medical_alerts: ["Diabetic"],
      current_medications: ["Metformin 500mg"],
    });
    expect(res.status).toBe(200);
    expect(res.body.allergies).toEqual(["Penicillin", "Latex"]);
    expect(res.body.medical_alerts).toEqual(["Diabetic"]);
  });

  test("prescribing a name-matched medication returns an advisory warning", async () => {
    const c = await makeCustomer("Allergy B", "allb@x.co");
    const subj = await makeSubject(c, "Allergy B", { allergies: ["penicillin"] });
    const plan = await makeActivePlan(c, { subject_id: subj.id });
    const session = await tp.createSession(db, plan.id, {}, ADMIN_ID);

    const rx = await tp.createPrescription(db, session.id, { medication_name: "Penicillin V 250mg" }, ADMIN_ID);
    expect(rx.allergy_warnings).toEqual(["penicillin"]);

    const safe = await tp.createPrescription(db, session.id, { medication_name: "Ibuprofen" }, ADMIN_ID);
    expect(safe.allergy_warnings).toEqual([]);
  });

  test("completeSession surfaces warnings for in-session prescriptions", async () => {
    const c = await makeCustomer("Allergy C", "allc@x.co");
    const subj = await makeSubject(c, "Allergy C", { allergies: ["Amoxicillin"] });
    const plan = await makeActivePlan(c, { subject_id: subj.id });
    const session = await tp.createSession(db, plan.id, {}, ADMIN_ID);
    const done = await tp.completeSession(db, session.id, {
      prescriptions: [{ medication_name: "Amoxicillin 500" }],
    }, ADMIN_ID);
    expect(done.allergy_warnings).toHaveLength(1);
    expect(done.allergy_warnings[0].matched_allergies).toEqual(["Amoxicillin"]);
  });
});

// ── Folio-tax slice ───────────────────────────────────────────────────

describe("V05 — treatment folio-tax", () => {
  let taxId;
  beforeAll(async () => {
    const { rows: [t] } = await db.query(
      "INSERT INTO taxes (name, rate) VALUES ('GST 10 (v05)', 10) RETURNING id"
    );
    taxId = t.id;
  });

  async function setTaxMode(mode) {
    await db.query("UPDATE company_profile SET tax_mode = $1 WHERE id = 1", [mode]);
  }

  test("exclusive mode: session fee resolves plan.tax_id; settle writes real rates", async () => {
    await setTaxMode("exclusive");
    const c = await makeCustomer("Tax A", "taxa@x.co");
    const plan = await makeActivePlan(c, { tax_id: taxId, sessions: 1 });
    const session = await tp.createSession(db, plan.id, {}, ADMIN_ID);
    await tp.completeSession(db, session.id, { session_fee: 1000 }, ADMIN_ID);

    const folio = await tp.getFolioForPlan(db, plan.id);
    const feeLine = folio.lines.find((l) => l.line_type === "session_fee");
    expect(Number(feeLine.tax_rate_at_charge)).toBe(10);
    expect(Number(feeLine.tax_amount_at_charge)).toBe(100);
    expect(feeLine.tax_inclusive_at_charge).toBe(false);
    expect(Number(folio.tax_total)).toBe(100);
    expect(Number(folio.grand_total)).toBe(1100); // exclusive tax on top

    await tp.transitionPlanStatus(db, plan.id, "completed", ADMIN_ID);
    const settled = await tp.settleFolio(db, folio.id, ADMIN_ID);
    expect(Number(settled.invoice.tax_total)).toBe(100);
    expect(Number(settled.invoice.subtotal)).toBe(1000);
    expect(Number(settled.invoice.total_amount)).toBe(1100);

    const { rows: items } = await db.query(
      "SELECT * FROM customer_invoice_items WHERE invoice_id = $1", [settled.invoice.id]
    );
    expect(Number(items[0].tax_rate)).toBe(10); // was hardcoded 0 pre-V05
  });

  test("inclusive mode: tax carved out of the fee, grand unchanged", async () => {
    await setTaxMode("inclusive");
    const c = await makeCustomer("Tax B", "taxb@x.co");
    const plan = await makeActivePlan(c, { tax_id: taxId, sessions: 1 });
    const session = await tp.createSession(db, plan.id, {}, ADMIN_ID);
    await tp.completeSession(db, session.id, { session_fee: 1100 }, ADMIN_ID);

    const folio = await tp.getFolioForPlan(db, plan.id);
    expect(Number(folio.tax_total)).toBe(100); // 1100 × 10/110
    expect(Number(folio.grand_total)).toBe(1100);
  });

  test("pos_sale line carries the sale's own tax inside its gross", async () => {
    await setTaxMode("exclusive");
    const c = await makeCustomer("Tax C", "taxc@x.co");
    const plan = await makeActivePlan(c, { sessions: 1 });
    const folio = await tp.upsertFolioForPlan(db, plan.id);

    const { rows: [sale] } = await db.query(
      `INSERT INTO sales (total_amount, subtotal, tax_total, payment_method) VALUES (550, 500, 50, 'cash') RETURNING id`
    );
    await tp.attachSaleToFolio(db, sale.id, folio.id, ADMIN_ID);

    const fresh = await tp.getFolioForPlan(db, plan.id);
    expect(Number(fresh.tax_total)).toBe(50);
    expect(Number(fresh.grand_total)).toBe(550); // no double-add: tax inside gross
    expect(Number(fresh.pos_charge_total)).toBe(550);
  });

  test("manual folio line with explicit tax_id snapshots its rate", async () => {
    await setTaxMode("exclusive");
    const c = await makeCustomer("Tax D", "taxd@x.co");
    const plan = await makeActivePlan(c, { sessions: 1 });
    const folio = await tp.upsertFolioForPlan(db, plan.id);
    await tp.addFolioLine(db, folio.id, {
      line_type: "manual_charge", description: "Consumables", quantity: 2, unit_price: 100, tax_id: taxId,
    }, ADMIN_ID);
    const fresh = await tp.getFolioForPlan(db, plan.id);
    expect(Number(fresh.tax_total)).toBe(20);
    expect(Number(fresh.grand_total)).toBe(220);
  });

  test("untaxed plan stays untaxed (tax_id NULL → rate 0)", async () => {
    await setTaxMode("exclusive");
    const c = await makeCustomer("Tax E", "taxe@x.co");
    const plan = await makeActivePlan(c, { sessions: 1 });
    const session = await tp.createSession(db, plan.id, {}, ADMIN_ID);
    await tp.completeSession(db, session.id, { session_fee: 800 }, ADMIN_ID);
    const folio = await tp.getFolioForPlan(db, plan.id);
    expect(Number(folio.tax_total)).toBe(0);
    expect(Number(folio.grand_total)).toBe(800);
  });
});

// ── Deposit release on discontinue ───────────────────────────────────

describe("V05 — deposit release on plan discontinue", () => {
  test("authorized pre-auth is released when the plan is discontinued", async () => {
    const c = await makeCustomer("Deposit", "dep@x.co");
    const plan = await makeActivePlan(c, { sessions: 1 });
    await db.query(
      `UPDATE treatment_plans SET deposit_status = 'authorized',
              deposit_payment_intent_id = 'pi_test_v05', deposit_authorized_at = NOW()
        WHERE id = $1`,
      [plan.id]
    );
    await tp.transitionPlanStatus(db, plan.id, "discontinued", ADMIN_ID, "patient moved");
    const { rows: [after] } = await db.query(
      "SELECT deposit_status FROM treatment_plans WHERE id = $1", [plan.id]
    );
    expect(after.deposit_status).toBe("released");
  });

  test("captured deposits are NOT auto-refunded on discontinue (clinic policy)", async () => {
    const c = await makeCustomer("Deposit B", "depb@x.co");
    const plan = await makeActivePlan(c, { sessions: 1 });
    await db.query(
      `UPDATE treatment_plans SET deposit_status = 'captured', deposit_payment_intent_id = 'pi_x' WHERE id = $1`,
      [plan.id]
    );
    await tp.transitionPlanStatus(db, plan.id, "discontinued", ADMIN_ID);
    const { rows: [after] } = await db.query(
      "SELECT deposit_status FROM treatment_plans WHERE id = $1", [plan.id]
    );
    expect(after.deposit_status).toBe("captured");
  });
});

// ── Handouts ──────────────────────────────────────────────────────────

describe("V05 — handout library + delivery", () => {
  let handoutId, customerA, customerB;

  beforeAll(async () => {
    customerA = await makeCustomer("Handout A", "ha@x.co");
    customerB = await makeCustomer("Handout B", "hb@x.co");
    const { rows: [h] } = await db.query(
      `INSERT INTO handouts (title, tags, file_url, file_mime)
       VALUES ('Knee Exercises', '{physio,knee}', 'https://r2/x.pdf', 'application/pdf') RETURNING id`
    );
    handoutId = h.id;
  });

  test("assign delivers to a customer and lists on their chart", async () => {
    const res = await req.post(`/api/handouts/${handoutId}/assign`).send({ customer_id: customerA });
    expect(res.status).toBe(201);
    const list = await req.get(`/api/handout-assignments?customer_id=${customerA}`);
    expect(list.status).toBe(200);
    expect(list.body.assignments).toHaveLength(1);
    expect(list.body.assignments[0].title).toBe("Knee Exercises");
  });

  test("library search by tag", async () => {
    const res = await req.get("/api/handouts?q=knee");
    expect(res.status).toBe(200);
    expect(res.body.handouts.some((h) => h.id === handoutId)).toBe(true);
  });

  test("handout routes 403 without the clinical_handouts flag", async () => {
    await setFlag("clinical_handouts", false);
    const res = await req.get("/api/handouts");
    expect(res.status).toBe(403);
    await setFlag("clinical_handouts", true);
  });
});

// ── Portal subject-scope ─────────────────────────────────────────────

describe("V05 — portal scope on new endpoints", () => {
  const { signCustomerTokens } = require("../../middleware/customer-auth");
  let ownerA, ownerB, tokenA, tokenB, petA;

  beforeAll(async () => {
    ownerA = await makeCustomer("Portal A", "pa@x.co");
    ownerB = await makeCustomer("Portal B", "pb@x.co");
    petA = await makeSubject(ownerA, "Simba", { subject_type: "pet", species: "cat" });
    await recalls.administerVaccination(db, { subjectId: petA.id, vaccineName: "Rabies", nextDue: "2030-01-01" });
    const { rows: [h] } = await db.query(
      `INSERT INTO handouts (title, file_url) VALUES ('Post-op care', 'https://r2/y.pdf') RETURNING id`
    );
    await db.query(
      `INSERT INTO handout_assignments (handout_id, customer_id) VALUES ($1, $2)`,
      [h.id, ownerA]
    );
    tokenA = signCustomerTokens({ id: ownerA }, STUB_TENANT).accessToken;
    tokenB = signCustomerTokens({ id: ownerB }, STUB_TENANT).accessToken;
  });

  test("owner sees own handouts; another customer sees none", async () => {
    const a = await supertest(app).get("/api/portal/me/handouts?tenant=acme")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(a.status).toBe(200);
    expect(a.body.handouts).toHaveLength(1);

    const b = await supertest(app).get("/api/portal/me/handouts?tenant=acme")
      .set("Authorization", `Bearer ${tokenB}`);
    expect(b.status).toBe(200);
    expect(b.body.handouts).toHaveLength(0);
  });

  test("vaccination card: owner reads own pet; other owner gets 404", async () => {
    const a = await supertest(app).get(`/api/portal/me/subjects/${petA.id}/vaccination-card?tenant=acme`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(a.status).toBe(200);
    expect(a.body.subject.name).toBe("Simba");
    expect(a.body.records).toHaveLength(1);

    const b = await supertest(app).get(`/api/portal/me/subjects/${petA.id}/vaccination-card?tenant=acme`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(b.status).toBe(404);
  });
});

// ── Preset config guards ──────────────────────────────────────────────

describe("V05 — clinic preset enablement (config)", () => {
  const cfg = require("../../config/industry-config");

  test("clinic preset now carries the clinical stack", () => {
    const clinic = cfg.INDUSTRY_PRESETS.clinic;
    expect(clinic.modes).toContain("treatment_plans");
    expect(clinic.clinical_config.chart_preset).toBe("body");
    expect(clinic.visible_report_groups).toContain("Clinical");
    expect(cfg.PORTAL_ENABLED_TABS_BY_PRESET.clinic).toContain("treatments");
  });

  test("clinical presets carry the V05 extra flags", () => {
    expect(cfg.getExtraFlagsForPreset("clinic")).toEqual(
      expect.arrayContaining(["clinical_recalls", "custom_forms"])
    );
    expect(cfg.getExtraFlagsForPreset("veterinary")).toContain("vet_vaccinations");
    expect(cfg.getExtraFlagsForPreset("physiotherapy")).toContain("clinical_handouts");
    expect(cfg.getExtraFlagsForPreset("dental_clinic")).toContain("clinical_recalls");
  });
});
