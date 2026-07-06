const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const members = require("../../services/members");
const { publicMemberCheckinSchema } = require("../../schemas/members");

/**
 * pg-v07-gym.test.js — V07 gym member check-in.
 *
 * The heart of this suite is the status-truth matrix on deriveMemberStatus:
 * the door verdict MUST derive from the same billing state the renewal/dunning
 * engine writes, or the door lies. Covers active/trial/grace/frozen/
 * payment_failed/expired/cancelled/pack, the "active-but-card-failed" overlay
 * (findings [08] partial row), frozen-vs-expired mapping, member_code
 * randomness/uniqueness, class-attendance linkage, the minimal public
 * projection, and the enrollment hook (member_code + waiver auto-attach).
 */

let app, db, deps, cleanup;

// ── fixtures ──────────────────────────────────────────────────────────
async function makePlan(interval = "monthly", price = 3000, trialDays = 0) {
  const { rows: [p] } = await db.query(
    "INSERT INTO subscription_plans (name, price, billing_interval, trial_days) VALUES ('Gold', $1, $2, $3) RETURNING id",
    [price, interval, trialDays]
  );
  return p.id;
}
async function makeCustomer(name = "Ahmed Khan") {
  const { rows: [c] } = await db.query(
    "INSERT INTO customers (name, email, mobile) VALUES ($1, 'a@x.co', '03009998877') RETURNING id",
    [name]
  );
  return c.id;
}
// sub with explicit lifecycle knobs
async function makeSub(planId, customerId, opts = {}) {
  const {
    status = "active",
    periodEnd = "NOW() + INTERVAL '20 days'",
    graceEnd = "NULL",
    trialEnd = "NULL",
    pausedAt = "NULL",
    cancelledAt = "NULL",
  } = opts;
  const { rows: [s] } = await db.query(
    `INSERT INTO customer_subscriptions
       (plan_id, customer_id, status, current_period_start, current_period_end, grace_period_end, trial_end, paused_at, cancelled_at, auto_charge, gateway_token)
     VALUES ($1, $2, $3, NOW() - INTERVAL '10 days', ${periodEnd}, ${graceEnd}, ${trialEnd}, ${pausedAt}, ${cancelledAt}, true, 'sbx_tok_GOOD')
     RETURNING id`,
    [planId, customerId, status]
  );
  return s.id;
}
async function openFailedRun(subId) {
  await db.query(
    `INSERT INTO subscription_runs (subscription_id, period_start, period_end, status, charge_status, dunning_attempts, first_failed_at, next_dunning_at)
     VALUES ($1, NOW(), NOW() + INTERVAL '30 days', 'invoiced', 'failed', 1, NOW() - INTERVAL '20 days', NOW() + INTERVAL '1 day')`,
    [subId]
  );
}
async function status(customerId, opts = {}) {
  const { rows: [c] } = await db.query(
    "SELECT id, name, member_code, mobile, email FROM customers WHERE id = $1",
    [customerId]
  );
  return members.deriveMemberStatus(db, c, { tz: "UTC", ...opts });
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app; db = result.db; deps = result.deps; cleanup = result.cleanup;
  await db.query("SET TIME ZONE 'UTC'");
  await db.query(
    "INSERT INTO feature_flags (key, enabled) VALUES ('member_checkin', true) ON CONFLICT (key) DO UPDATE SET enabled = true"
  );
  require("../../routes/members")(app, deps);
}, 120000);

afterAll(async () => { if (cleanup) await cleanup(); }, 30000);

describe("V07 — status truth at the door", () => {
  test("active membership → allow", async () => {
    const c = await makeCustomer();
    await makeSub(await makePlan(), c);
    const s = await status(c);
    expect(s.verdict).toBe("allow");
    expect(s.state).toBe("active");
    expect(s.expiry_date).toBeTruthy();
    expect(s.payment_failed).toBe(false);
  });

  test("trial membership → allow (trial)", async () => {
    const c = await makeCustomer();
    await makeSub(await makePlan("monthly", 3000, 14), c, { trialEnd: "NOW() + INTERVAL '10 days'" });
    const s = await status(c);
    expect(s.verdict).toBe("allow");
    expect(s.state).toBe("trial");
  });

  test("expired (period + grace passed) → deny (expired, not frozen)", async () => {
    const c = await makeCustomer();
    await makeSub(await makePlan(), c, { periodEnd: "NOW() - INTERVAL '5 days'", graceEnd: "NOW() - INTERVAL '1 day'" });
    const s = await status(c);
    expect(s.verdict).toBe("deny");
    expect(s.state).toBe("expired");
    expect(s.message).toMatch(/expired/i);
  });

  test("cancelled → deny (cancelled)", async () => {
    const c = await makeCustomer();
    await makeSub(await makePlan(), c, { status: "cancelled", cancelledAt: "NOW() - INTERVAL '2 days'" });
    const s = await status(c);
    expect(s.verdict).toBe("deny");
    expect(s.state).toBe("cancelled");
  });

  test("frozen (paused, no failed charge) → deny FROZEN, never 'expired'", async () => {
    const c = await makeCustomer();
    await makeSub(await makePlan(), c, { status: "paused", pausedAt: "NOW() - INTERVAL '3 days'" });
    const s = await status(c);
    expect(s.verdict).toBe("deny");
    expect(s.state).toBe("frozen");
    expect(s.message).toMatch(/frozen/i);
    expect(s.message).not.toMatch(/expired/i);
  });

  test("active BUT open failed charge → warn + payment_failed (the 'door lies' fix)", async () => {
    const c = await makeCustomer();
    const sub = await makeSub(await makePlan(), c); // period valid, status active
    await openFailedRun(sub);
    const s = await status(c);
    expect(s.payment_failed).toBe(true);
    expect(s.verdict).toBe("warn"); // downgraded from allow — desk collects at the door
    expect(s.dunning).toBeTruthy();
    expect(s.needs_front_desk).toBe(true);
  });

  test("dunning-paused (paused + open failed charge) → state payment_failed, not frozen", async () => {
    const c = await makeCustomer();
    const sub = await makeSub(await makePlan(), c, { status: "paused", pausedAt: "NOW() - INTERVAL '1 day'" });
    await openFailedRun(sub);
    const s = await status(c);
    expect(s.state).toBe("payment_failed");
    expect(s.verdict).toBe("deny");
    expect(s.message).toMatch(/payment failed/i);
  });

  test("grace window (period passed, within grace) → warn (grace)", async () => {
    const c = await makeCustomer();
    await makeSub(await makePlan(), c, { periodEnd: "NOW() - INTERVAL '2 days'", graceEnd: "NOW() + INTERVAL '3 days'" });
    const s = await status(c);
    expect(s.state).toBe("grace");
    expect(s.verdict).toBe("warn");
  });

  test("pack-only (no live sub, active package with credits) → allow", async () => {
    const c = await makeCustomer();
    const { rows: [pt] } = await db.query(
      "INSERT INTO package_templates (name, price, credits) VALUES ('10-Class Pass', 10000, 10) RETURNING id"
    );
    await db.query(
      "INSERT INTO customer_packages (customer_id, package_template_id, credits_total, credits_used, status) VALUES ($1, $2, 10, 3, 'active')",
      [c, pt.id]
    );
    const s = await status(c);
    expect(s.verdict).toBe("allow");
    expect(s.packages.credits_remaining).toBe(7);
    expect(s.status_label).toMatch(/pass/i);
  });

  test("grace-checkins policy: expired member with N courtesy check-ins → warn", async () => {
    const c = await makeCustomer();
    await makeSub(await makePlan(), c, { periodEnd: "NOW() - INTERVAL '5 days'", graceEnd: "NOW() - INTERVAL '1 day'" });
    const strict = await status(c, { graceCheckins: 0 });
    expect(strict.verdict).toBe("deny");
    const lenient = await status(c, { graceCheckins: 2 });
    expect(lenient.verdict).toBe("warn");
    expect(lenient.state).toBe("grace");
  });
});

describe("V07 — member_code", () => {
  test("generateMemberCode is an 8-digit non-sequential unique code", async () => {
    const a = await members.generateMemberCode(db);
    const b = await members.generateMemberCode(db);
    expect(a).toMatch(/^\d{8}$/);
    expect(a).not.toBe(b);
  });

  test("ensureMemberCode assigns once and is idempotent", async () => {
    const c = await makeCustomer();
    const code1 = await members.ensureMemberCode(db, c);
    const code2 = await members.ensureMemberCode(db, c);
    expect(code1).toMatch(/^\d{8}$/);
    expect(code2).toBe(code1);
    const dup = await db.query("SELECT COUNT(*)::int n FROM customers WHERE member_code = $1", [code1]);
    expect(dup.rows[0].n).toBe(1);
  });
});

describe("V07 — check-in + class attendance", () => {
  test("check-in with a booked class today links the class (attendance mark)", async () => {
    const c = await makeCustomer();
    await makeSub(await makePlan(), c);
    const { rows: [svc] } = await db.query("INSERT INTO booking_services (name) VALUES ('Yoga') RETURNING id");
    const { rows: [cs] } = await db.query(
      `INSERT INTO class_sessions (service_id, start_at, end_at, max_capacity, status)
       VALUES ($1, CURRENT_DATE + INTERVAL '12 hours', CURRENT_DATE + INTERVAL '13 hours', 10, 'scheduled') RETURNING id`,
      [svc.id]
    );
    await db.query(
      "INSERT INTO class_session_bookings (class_session_id, customer_id, status, booked_via) VALUES ($1, $2, 'confirmed', 'portal')",
      [cs.id, c]
    );

    const before = await status(c);
    expect(before.class_today).toBeTruthy();
    expect(before.class_today.already_checked_in).toBe(false);

    await members.recordCheckin(db, { customerId: c, method: "kiosk", classSessionId: before.class_today.class_session_id, statusSnapshot: before.state });

    const after = await status(c);
    expect(after.class_today.already_checked_in).toBe(true);
    const { rows: [chk] } = await db.query("SELECT class_session_id FROM member_checkins WHERE customer_id = $1", [c]);
    expect(chk.class_session_id).toBe(cs.id);
  });
});

describe("V07 — public projection + enumeration guard", () => {
  test("toPublicStatus emits first name + verdict only, never phone/email/balance", async () => {
    const c = await makeCustomer("Zara Malik");
    const { rows: [pt] } = await db.query("INSERT INTO package_templates (name, price, credits) VALUES ('5-Pass', 5000, 5) RETURNING id");
    await db.query("INSERT INTO customer_packages (customer_id, package_template_id, credits_total, credits_used, status) VALUES ($1,$2,5,0,'active')", [c, pt.id]);
    const full = await status(c);
    const pub = members.toPublicStatus(full);
    expect(pub.first_name).toBe("Zara");
    expect(pub.verdict).toBeTruthy();
    // No PII / balance leaks on the public path.
    expect(pub.phone).toBeUndefined();
    expect(pub.email).toBeUndefined();
    expect(pub.packages).toBeUndefined();
    expect(pub.dunning).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain("03009998877");
  });

  test("public check-in schema strips a raw customer_id (no arbitrary check-in)", () => {
    const parsed = publicMemberCheckinSchema.parse({ member_code: "12345678", customer_id: 5 });
    expect(parsed.member_code).toBe("12345678");
    expect(parsed.customer_id).toBeUndefined();
  });
});

describe("V07 — authed front-desk routes", () => {
  test("lookup by member_code returns full detail; check-in records + feed counts it", async () => {
    const c = await makeCustomer();
    await makeSub(await makePlan(), c);
    const code = await members.ensureMemberCode(db, c);
    const api = makeRequest(app, ADMIN_ID);

    const look = await api.post("/api/members/lookup").send({ member_code: code });
    expect(look.status).toBe(200);
    expect(look.body.found).toBe(true);
    expect(look.body.customer.phone).toBeTruthy(); // staff path DOES see detail
    expect(look.body.verdict).toBe("allow");

    const chk = await api.post("/api/members/check-in").send({ member_code: code });
    expect(chk.status).toBe(201);
    expect(chk.body.checkin).toBeTruthy();

    const feed = await api.get("/api/members/checkins/today");
    expect(feed.status).toBe(200);
    expect(feed.body.count).toBeGreaterThanOrEqual(1);
  });

  test("assign-code issues a code for a walk-in member", async () => {
    const c = await makeCustomer();
    const api = makeRequest(app, ADMIN_ID);
    const res = await api.post(`/api/members/${c}/assign-code`).send({});
    expect(res.status).toBe(200);
    expect(res.body.member_code).toMatch(/^\d{8}$/);
  });

  test("member_checkin flag OFF → feature gate blocks", async () => {
    await db.query("UPDATE feature_flags SET enabled = false WHERE key = 'member_checkin'");
    const api = makeRequest(app, ADMIN_ID);
    const res = await api.post("/api/members/lookup").send({ member_code: "99999999" });
    // Production requireFeature answers 403; the test-harness stub answers 503.
    // Either way the gate must refuse the request.
    expect([403, 503]).toContain(res.status);
    await db.query("UPDATE feature_flags SET enabled = true WHERE key = 'member_checkin'");
  });
});

describe("V07 — enrollment hook", () => {
  test("enrollment assigns member_code + auto-attaches the waiver", async () => {
    const c = await makeCustomer();
    // A membership-enroll waiver template (F03).
    const { rows: [ft] } = await db.query(
      `INSERT INTO form_templates (name, entity_scope, fields, require_signature, auto_attach, is_active)
       VALUES ('Liability Waiver', 'membership',
               '[{"key":"agree","label":"I accept the liability terms","type":"signature_ack","required":true}]'::jsonb,
               TRUE, 'membership_enroll', TRUE) RETURNING id`
    );
    // Simulate what routes/subscriptions.js does on enrollment.
    await members.ensureMemberCode(db, c);
    const { autoAttachForms } = require("../../services/forms");
    await autoAttachForms(db, "membership_enroll", { customerId: c, entityType: "subscription", entityId: 1 });

    const { rows: [cust] } = await db.query("SELECT member_code FROM customers WHERE id = $1", [c]);
    expect(cust.member_code).toMatch(/^\d{8}$/);
    const { rows: [resp] } = await db.query(
      "SELECT status, form_template_id FROM form_responses WHERE customer_id = $1 AND form_template_id = $2",
      [c, ft.id]
    );
    expect(resp).toBeTruthy();
    expect(resp.status).toBe("pending"); // unsigned waiver → surfaces at the door
  });
});
