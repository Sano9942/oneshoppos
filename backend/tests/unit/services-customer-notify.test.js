import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit tests for services/customer-notify.js (F05 notification engine).
//
// Pattern A: call the real notify() with a hand-built fake `db` and a stubbed
// sms/email layer. We assert the customer_notifications rows it writes (status
// truth log) and that a broken provider produces 'failed' — never throws —
// while a missing recipient / no-provider produces 'skipped', not 'failed'.

const { notify, normalizePhone } = require("../../services/customer-notify");

// Injected fakes (repo Pattern A — vi.mock can't intercept the engine's CJS
// top-level requires; notify() takes an optional 3rd deps arg for exactly this).
const enqueueEmailMock = vi.fn(async () => {});
const sendSmsMock = vi.fn(async () => ({ sent: true, provider_ref: "sms-1" }));
const sendWhatsAppMock = vi.fn(async () => ({ sent: true, provider_ref: "wa-1" }));
const deps = { enqueueEmail: enqueueEmailMock, sendSms: sendSmsMock, sendWhatsApp: sendWhatsAppMock };

function fakeDb({ rules = [], customer = null, flagEnabled = true } = {}) {
  const inserts = [];
  return {
    inserts,
    query: vi.fn(async (sql, params) => {
      if (sql.includes("FROM feature_flags")) {
        return { rows: [{ enabled: flagEnabled }], rowCount: 1 };
      }
      if (sql.includes("FROM notification_rules")) {
        // honor channelHints ANY($2) filtering if present
        let out = rules;
        if (sql.includes("channel = ANY($2)") && params[1]) {
          out = rules.filter((r) => params[1].includes(r.channel));
        }
        return { rows: out, rowCount: out.length };
      }
      if (sql.includes("FROM customers")) {
        return { rows: customer ? [customer] : [], rowCount: customer ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO customer_notifications")) {
        inserts.push({
          customer_id: params[0], event: params[1], channel: params[2],
          recipient: params[3], entity_type: params[4], entity_id: params[5],
          status: params[6], provider_ref: params[7], error: params[8],
        });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

beforeEach(() => {
  enqueueEmailMock.mockClear();
  sendSmsMock.mockClear();
  sendSmsMock.mockImplementation(async () => ({ sent: true, provider_ref: "sms-1" }));
});

describe("normalizePhone", () => {
  it("converts local PK formats to E.164", () => {
    expect(normalizePhone("03001234567")).toBe("+923001234567");
    expect(normalizePhone("+923001234567")).toBe("+923001234567");
    expect(normalizePhone("923001234567")).toBe("+923001234567");
    expect(normalizePhone("3001234567")).toBe("+923001234567");
    expect(normalizePhone("0300-123 4567")).toBe("+923001234567");
    expect(normalizePhone("")).toBe(null);
    expect(normalizePhone(null)).toBe(null);
  });
});

describe("notify", () => {
  it("throws when tenantSlug is missing (programmer-error guard)", async () => {
    const db = fakeDb();
    await expect(notify(db, { event: "x", tenantSlug: "" })).rejects.toThrow(/tenantSlug/);
  });

  it("short-circuits with reason 'disabled' when the feature flag is off", async () => {
    const db = fakeDb({ flagEnabled: false, rules: [{ channel: "sms", template_key: "ticket_completed" }], customer: { id: 1, mobile: "03001234567" } });
    const res = await notify(db, { event: "ticket.status_changed:completed", tenantSlug: "acme", customerId: 1 }, deps);
    expect(res.reason).toBe("disabled");
    expect(db.inserts).toHaveLength(0);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("returns no_rules when nothing matches (no rows written)", async () => {
    const db = fakeDb({ rules: [] });
    const res = await notify(db, { event: "ticket.status_changed:completed", tenantSlug: "acme", customerId: 1 });
    expect(res.reason).toBe("no_rules");
    expect(db.inserts).toHaveLength(0);
  });

  it("logs a 'skipped' (rule disabled) row when a matching rule is switched off", async () => {
    const db = fakeDb({
      rules: [{ channel: "sms", template_key: "ticket_completed", enabled: false }],
      customer: { id: 5, name: "Ali", mobile: "03009998877" },
    });
    const res = await notify(db, {
      event: "ticket.status_changed:completed", tenantSlug: "acme", customerId: 5,
      data: { storeName: "Acme", ticketNumber: "TKT-1" },
    }, deps);
    expect(res.dispatched[0].status).toBe("skipped");
    expect(db.inserts[0].status).toBe("skipped");
    expect(db.inserts[0].error).toMatch(/rule disabled/);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("enqueues email (status=queued) and sends sms (status=sent) for completed", async () => {
    const db = fakeDb({
      rules: [
        { channel: "email", template_key: "ticket_completed" },
        { channel: "sms", template_key: "ticket_completed" },
      ],
      customer: { id: 5, name: "Ali", mobile: "03009998877", email: "ali@e.com" },
    });
    const res = await notify(db, {
      event: "ticket.status_changed:completed",
      tenantSlug: "acme",
      tenant: { slug: "acme", name: "Acme" },
      customerId: 5,
      entityType: "ticket", entityId: 42,
      data: { storeName: "Acme", ticketNumber: "TKT-000042", ticketTitle: "iPhone screen" },
    }, deps);

    expect(res.dispatched).toHaveLength(2);
    // email enqueued with transactional priority + tenantSlug in payload
    expect(enqueueEmailMock).toHaveBeenCalledTimes(1);
    const emailArgs = enqueueEmailMock.mock.calls[0][1];
    expect(emailArgs.type).toBe("ticket_completed");
    expect(emailArgs.to).toBe("ali@e.com");
    expect(emailArgs.priority).toBeGreaterThan(0);
    expect(emailArgs.data.tenantSlug).toBe("acme");
    // sms sent to normalized number
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendSmsMock.mock.calls[0][1].to).toBe("+923009998877");

    const byChannel = Object.fromEntries(db.inserts.map((r) => [r.channel, r]));
    expect(byChannel.email.status).toBe("queued");
    expect(byChannel.sms.status).toBe("sent");
    expect(byChannel.sms.provider_ref).toBe("sms-1");
    expect(byChannel.sms.entity_id).toBe(42);
  });

  it("logs 'failed' (not thrown) when the sms provider errors", async () => {
    sendSmsMock.mockImplementation(async () => ({ sent: false, error: "Zong gateway 500" }));
    const db = fakeDb({
      rules: [{ channel: "sms", template_key: "ticket_completed" }],
      customer: { id: 5, name: "Ali", mobile: "03009998877", email: null },
    });
    const res = await notify(db, {
      event: "ticket.status_changed:completed", tenantSlug: "acme", customerId: 5,
      data: { storeName: "Acme", ticketNumber: "TKT-1" },
    }, deps);
    expect(res.dispatched[0].status).toBe("failed");
    expect(db.inserts[0].status).toBe("failed");
    expect(db.inserts[0].error).toMatch(/Zong/);
  });

  it("logs 'skipped' (not 'failed') when no sms provider is configured", async () => {
    sendSmsMock.mockImplementation(async () => ({ sent: false, error: "No SMS provider configured" }));
    const db = fakeDb({
      rules: [{ channel: "sms", template_key: "ticket_completed" }],
      customer: { id: 5, name: "Ali", mobile: "03009998877" },
    });
    const res = await notify(db, {
      event: "ticket.status_changed:completed", tenantSlug: "acme", customerId: 5,
      data: { storeName: "Acme", ticketNumber: "TKT-1" },
    }, deps);
    expect(res.dispatched[0].status).toBe("skipped");
    expect(db.inserts[0].status).toBe("skipped");
  });

  it("logs 'skipped' when the customer has no mobile for an sms rule", async () => {
    const db = fakeDb({
      rules: [{ channel: "sms", template_key: "ticket_completed" }],
      customer: { id: 5, name: "Ali", mobile: null, email: "ali@e.com" },
    });
    const res = await notify(db, {
      event: "ticket.status_changed:completed", tenantSlug: "acme", customerId: 5,
      data: { storeName: "Acme", ticketNumber: "TKT-1" },
    }, deps);
    expect(res.dispatched[0].status).toBe("skipped");
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("honors channelHints to restrict channels", async () => {
    const db = fakeDb({
      rules: [
        { channel: "email", template_key: "ticket_completed" },
        { channel: "sms", template_key: "ticket_completed" },
      ],
      customer: { id: 5, name: "Ali", mobile: "03009998877", email: "ali@e.com" },
    });
    const res = await notify(db, {
      event: "ticket.status_changed:completed", tenantSlug: "acme", customerId: 5,
      channelHints: ["email"],
      data: { storeName: "Acme", ticketNumber: "TKT-1" },
    }, deps);
    expect(res.dispatched).toHaveLength(1);
    expect(res.dispatched[0].channel).toBe("email");
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});
