import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit tests for workers/email-worker-boss.js — verifies that the 4
// tenant-scoped job handlers:
//   1. Require `tenantSlug` in the job payload (defensive throw)
//   2. Route DB work through a tenant-scoped client (search_path set)
//   3. Pass the scoped db (not pool) into service functions
//
// Strategy: let the REAL withTenantContext helper run, but provide a
// fake pg.Pool that records connect/query/release. The worker → helper
// → client chain is exercised end-to-end without touching Postgres.
//
// Notes on mocking:
// - We mock `resend`, `email-templates`, `subscriptions`, and `marketing`
//   because those are side-effectful (email send / service bodies) and
//   we only care that the worker invokes them with the right scoped db.
// - We do NOT mock `tenant-job-context` — Vitest's vi.mock() interop
//   with CommonJS require() is unreliable in this repo, and the real
//   helper is small enough that running it is cheap + more realistic.

// ── Mocks (hoisted so vi.mock factories see them) ────────────────────────

const mocks = vi.hoisted(() => ({
  resendSend: vi.fn().mockResolvedValue({ id: "rs-test" }),
  processRenewal: vi.fn().mockResolvedValue(null),
  enqueueCampaignSend: vi.fn().mockResolvedValue({ recipientCount: 1 }),
}));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mocks.resendSend },
  })),
}));

vi.mock("../../services/email-templates", () => ({
  TEMPLATES: {
    invoice_reminder: () => ({ html: "<p>reminder</p>" }),
  },
}));

vi.mock("../../services/subscriptions", () => ({
  processRenewal: mocks.processRenewal,
}));

vi.mock("../../services/marketing", () => ({
  enqueueCampaignSend: mocks.enqueueCampaignSend,
}));

// ── Fake pg.Pool that records everything ─────────────────────────────────

/**
 * Build a fake pg.Pool whose connect() returns a client that records
 * every query. The client has a real-shape `release` method.
 * Exposes `clientQueries` so tests can inspect what ran under the
 * tenant-scoped context.
 */
function makeFakePool() {
  const clientQueries = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      clientQueries.push({ sql, params });
      // For the invoice-reminder SELECT that fetches the invoice row,
      // return a plausible row so the handler proceeds past the guard.
      if (sql.includes("FROM customer_invoices")) {
        return {
          rows: [{
            id: 2,
            invoice_number: "INV-001",
            status: "sent",
            balance_due: 100,
            due_date: "2026-05-01",
            customer_email: "c@example.com",
            customer_name: "Test",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(), // not used in tenant-scoped paths, but present for shape
  };
  return { pool, client, clientQueries };
}

/**
 * Register the email worker and return a map of job name -> handler,
 * plus the fake pool's recorded queries.
 */
async function registerAndCaptureHandlers() {
  const { pool, client, clientQueries } = makeFakePool();
  const handlers = {};
  const boss = {
    createQueue: vi.fn().mockResolvedValue(null),
    work: vi.fn((name, optsOrFn, maybeFn) => {
      const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn;
      handlers[name] = fn;
      return Promise.resolve();
    }),
    schedule: vi.fn().mockResolvedValue(null),
    send: vi.fn().mockResolvedValue({ id: "job-sent" }),
  };

  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test-key";

  const { registerEmailWorker } = require("../../workers/email-worker-boss");
  await registerEmailWorker(boss, pool);

  return { boss, pool, client, clientQueries, handlers };
}

// ── Test setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  mocks.resendSend.mockClear();
  mocks.processRenewal.mockClear();
  mocks.enqueueCampaignSend.mockClear();
});

// ── subscription-renewal ─────────────────────────────────────────────────

describe("subscription-renewal worker", () => {
  it("throws when tenantSlug is missing", async () => {
    const { handlers } = await registerAndCaptureHandlers();
    await expect(
      handlers["subscription-renewal"]([{ data: { subscriptionId: 42 } }])
    ).rejects.toThrow(/tenantSlug/);
  });

  it("sets search_path to tenant_packagesmall before calling processRenewal", async () => {
    const { handlers, clientQueries } = await registerAndCaptureHandlers();
    await handlers["subscription-renewal"]([{
      data: { tenantSlug: "packagesmall", subscriptionId: 42 },
    }]);
    // First query on the scoped client must be the SET search_path.
    expect(clientQueries[0].sql).toContain("SET search_path TO tenant_packagesmall");
    // Last query must be the reset before release.
    const last = clientQueries[clientQueries.length - 1];
    expect(last.sql).toContain("SET search_path TO public");
  });

  it("runs processRenewal's subscription lookup SQL inside tenant scope", async () => {
    const { handlers, clientQueries } = await registerAndCaptureHandlers();
    await handlers["subscription-renewal"]([{
      data: { tenantSlug: "packagesmall", subscriptionId: 42 },
    }]);
    // The real processRenewal runs its SELECT against the scoped client.
    // Because our fake returns rows: [], it exits early at the "not found"
    // branch — but we can still assert the SELECT fired and that it ran
    // AFTER the search_path was set to tenant_packagesmall.
    const setIdx = clientQueries.findIndex((q) =>
      q.sql.includes("SET search_path TO tenant_packagesmall")
    );
    const selectIdx = clientQueries.findIndex((q) =>
      q.sql.includes("FROM customer_subscriptions")
    );
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThan(setIdx);
    // And the subscription ID was passed as a param.
    expect(clientQueries[selectIdx].params).toEqual([42]);
  });
});

// ── campaign-scheduled-send ──────────────────────────────────────────────

describe("campaign-scheduled-send worker", () => {
  it("throws when tenantSlug is missing", async () => {
    const { handlers } = await registerAndCaptureHandlers();
    await expect(
      handlers["campaign-scheduled-send"]([{ data: { campaignId: 7 } }])
    ).rejects.toThrow(/tenantSlug/);
  });

  it("runs enqueueCampaignSend's campaign lookup SQL inside tenant scope", async () => {
    const { handlers, clientQueries } = await registerAndCaptureHandlers();
    // The real enqueueCampaignSend will 404 on an empty fake client,
    // which propagates as a throw — that's expected and we catch it.
    await expect(
      handlers["campaign-scheduled-send"]([{
        data: { tenantSlug: "handicraft", campaignId: 7 },
      }])
    ).rejects.toThrow(/Campaign not found/);

    // Even though the service threw, the scoped context ran: first
    // query was SET search_path, and the campaign SELECT fired inside
    // the scoped client.
    const setIdx = clientQueries.findIndex((q) =>
      q.sql.includes("SET search_path TO tenant_handicraft")
    );
    const selectIdx = clientQueries.findIndex((q) =>
      q.sql.includes("FROM marketing_campaigns")
    );
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThan(setIdx);
    // And search_path was reset before release (finally block runs on error).
    const lastReset = [...clientQueries].reverse().find((q) =>
      q.sql.includes("SET search_path TO public")
    );
    expect(lastReset).toBeDefined();
  });
});

// ── invoice-reminder ─────────────────────────────────────────────────────

describe("invoice-reminder worker", () => {
  it("throws when tenantSlug is missing", async () => {
    const { handlers } = await registerAndCaptureHandlers();
    await expect(
      handlers["invoice-reminder"]([{ data: { reminderId: 1, invoiceId: 2 } }])
    ).rejects.toThrow(/tenantSlug/);
  });

  it("runs inside tenant context and enqueues the email send", async () => {
    const { handlers, boss, clientQueries } = await registerAndCaptureHandlers();
    await handlers["invoice-reminder"]([{
      data: { tenantSlug: "khantoys", reminderId: 1, invoiceId: 2 },
    }]);
    expect(clientQueries[0].sql).toContain("SET search_path TO tenant_khantoys");
    // SELECT must have fired on the scoped client (not pool.query).
    const selectedInvoice = clientQueries.find((q) => q.sql.includes("FROM customer_invoices"));
    expect(selectedInvoice).toBeDefined();
    // "email" job was enqueued via boss.send — that's how reminders go out.
    const emailSend = boss.send.mock.calls.find((c) => c[0] === "email");
    expect(emailSend).toBeDefined();
  });
});

// ── campaign-email ───────────────────────────────────────────────────────

describe("campaign-email worker", () => {
  it("throws when tenantSlug is missing", async () => {
    const { handlers } = await registerAndCaptureHandlers();
    await expect(
      handlers["campaign-email"]([{
        data: { deliveryId: 1, to: "a@b.com", subject: "s", html: "<p>h</p>" },
      }])
    ).rejects.toThrow(/tenantSlug/);
  });

  it("updates delivery row under tenant_packagesmall after send", async () => {
    const { handlers, clientQueries } = await registerAndCaptureHandlers();
    await handlers["campaign-email"]([{
      data: {
        tenantSlug: "packagesmall",
        deliveryId: 99,
        to: "customer@example.com",
        subject: "Hello",
        html: "<p>Hi</p>",
        campaignId: 5,
      },
    }]);

    // Scoped client ran SET search_path + the delivery UPDATE.
    // (We don't assert on Resend here — vi.mock() doesn't intercept
    // CommonJS requires reliably in this repo, so the real Resend
    // client runs. The DB-layer assertion is the meaningful one.)
    expect(clientQueries[0].sql).toContain("SET search_path TO tenant_packagesmall");
    const updateDelivery = clientQueries.find((q) =>
      q.sql.includes("UPDATE marketing_campaign_deliveries SET status = 'sent'")
    );
    expect(updateDelivery).toBeDefined();
    expect(updateDelivery.params).toContain(99);

    // The rollup query should also have fired inside the scoped context.
    const rollup = clientQueries.find((q) =>
      q.sql.includes("FROM marketing_campaign_deliveries WHERE campaign_id")
    );
    expect(rollup).toBeDefined();
  });
});
