/**
 * pg-batch-phase3c-atomicity.test.js — Wave 3 Batch 3C regression coverage
 *
 * Covers three cross-domain atomicity + gating findings fixed in
 * commits 43a3a55 (H3), c955a67 (H2), and a09be15 (H1):
 *
 *   H1 — processRenewal wrapped in db.transaction() with boss.send AFTER
 *        the commit. Tests the happy path (invoice + run + period advance +
 *        boss.send ordering) and the early-return path (status != 'active' →
 *        no rows, no boss.send).
 *
 *   H2 — sendToKitchen wrapped in db.transaction(). Tests the happy path
 *        (tickets, junctions, events, kitchen_status flip) and the rollback
 *        path (wrap the db proxy to throw on the Nth INSERT, assert zero
 *        tickets + zero junctions + items still 'pending').
 *
 *   H3 — notifyCustomerSms gates on phase5_sms_providers. Tests the flag-off
 *        path (no sms.sendSms call) and the flag-on path (sms.sendSms called
 *        with the expected body).
 */

const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

// H3 mocks sms.sendSms via vi.spyOn on the real module (not vi.mock).
// Jest's jest.mock() intercepted CJS require() calls via require.cache
// manipulation — Vitest's vi.mock() works via ESM hooks and CJS
// require() interop is unreliable (per reference_vitest_cjs_mock_caveat
// memory). notifyCustomerSms calls `const sms = require("../services/sms")`
// inline inside the function body, which under vi.mock() was not being
// intercepted (flag-ON test asserted 1 call, observed 0).
//
// vi.spyOn against the real module works because it mutates the real
// exports object AFTER the module has been required. Every subsequent
// call — including inline requires that hit the cached module — sees
// the spied method. The spy is installed in H3's beforeAll and restored
// in afterAll; H1 and H2 tests are unaffected because they never reach
// the sms code path.

describe("Wave 3 Batch 3C — Cross-domain atomicity + gating", () => {
  let app;
  let db;
  let cleanup;
  let couriersModule;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Cache the couriers module for H3 — Object.assign export means the
    // default is the mount function AND it has a notifyCustomerSms prop.
    couriersModule = require("../../routes/couriers");
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ───────────────────────────────────────────────────────────────
  // H1 — processRenewal atomicity + post-commit boss.send
  // ───────────────────────────────────────────────────────────────
  describe("H1 — processRenewal atomic writes + post-commit boss.send", () => {
    const { processRenewal } = require("../../services/subscriptions");
    let planId;
    let subscriptionId;

    beforeAll(async () => {
      // Seed a subscription_plan and a customer_subscription with status=active.
      const { rows: [plan] } = await db.query(
        `INSERT INTO subscription_plans (name, price, billing_interval, billing_interval_count)
         VALUES ('H1 Test Plan', 5000, 'monthly', 1) RETURNING id`
      );
      planId = plan.id;

      // Customer 1 is seeded by the factory.
      const { rows: [sub] } = await db.query(
        `INSERT INTO customer_subscriptions
           (plan_id, customer_id, status, current_period_start, current_period_end)
         VALUES ($1, 1, 'active', NOW() - INTERVAL '31 days', NOW())
         RETURNING id`,
        [planId]
      );
      subscriptionId = sub.id;
    });

    it("happy path: creates invoice + item + run + advances period, then calls boss.send", async () => {
      const bossCalls = [];
      const boss = {
        send: vi.fn(async (queue, payload, options) => {
          // Capture the point-in-time DB state at which boss.send was called.
          // This is the key assertion for the post-commit ordering: by the time
          // boss.send fires, all 4 writes must already be visible.
          const { rows: invoices } = await db.query(
            `SELECT id, invoice_number, total_amount FROM customer_invoices
             WHERE customer_id = 1 AND notes LIKE 'Subscription renewal%'`
          );
          const { rows: runs } = await db.query(
            `SELECT id, status FROM subscription_runs WHERE subscription_id = $1`,
            [subscriptionId]
          );
          const { rows: [subNow] } = await db.query(
            `SELECT current_period_end FROM customer_subscriptions WHERE id = $1`,
            [subscriptionId]
          );
          bossCalls.push({ queue, payload, options, invoices, runs, subNow });
          return { id: "boss-job-1" };
        }),
      };

      const result = await processRenewal(db, boss, "packagesmall", subscriptionId);

      // Function returned the invoice row.
      expect(result).toBeDefined();
      expect(result.invoice_number).toMatch(/^INV-\d{6}$/);

      // Exactly one boss.send call, with the right payload.
      expect(boss.send).toHaveBeenCalledTimes(1);
      expect(bossCalls).toHaveLength(1);
      expect(bossCalls[0].queue).toBe("subscription-renewal");
      expect(bossCalls[0].payload).toEqual({
        tenantSlug: "packagesmall",
        subscriptionId,
      });
      expect(bossCalls[0].options.startAfter).toBeDefined();

      // The snapshot taken INSIDE boss.send proves the tx had committed:
      //   - invoice row exists with the expected amount
      //   - subscription_runs row exists with status='invoiced'
      //   - customer_subscriptions.current_period_end has advanced past
      //     the original value (we seeded it to NOW())
      expect(bossCalls[0].invoices).toHaveLength(1);
      expect(Number(bossCalls[0].invoices[0].total_amount)).toBe(5000);
      expect(bossCalls[0].runs).toHaveLength(1);
      expect(bossCalls[0].runs[0].status).toBe("invoiced");

      // Period advanced — new end should be ~30 days in the future.
      const newEnd = new Date(bossCalls[0].subNow.current_period_end);
      const now = Date.now();
      const daysDiff = (newEnd.getTime() - now) / 86400000;
      expect(daysDiff).toBeGreaterThan(25); // monthly = 30 days, allow jitter
      expect(daysDiff).toBeLessThan(35);

      // And the item row landed — verify via direct query since processRenewal
      // only returns the invoice.
      const { rows: items } = await db.query(
        `SELECT description, quantity FROM customer_invoice_items WHERE invoice_id = $1`,
        [result.id]
      );
      expect(items).toHaveLength(1);
      expect(items[0].description).toMatch(/H1 Test Plan subscription/);
      expect(Number(items[0].quantity)).toBe(1);
    });

    it("skip path: status='cancelled' returns early — no new rows, no boss.send", async () => {
      // Mutate sub to cancelled.
      await db.query(
        `UPDATE customer_subscriptions SET status = 'cancelled' WHERE id = $1`,
        [subscriptionId]
      );

      const invoicesBefore = await db.query(
        `SELECT COUNT(*)::int AS n FROM customer_invoices WHERE customer_id = 1`
      );
      const runsBefore = await db.query(
        `SELECT COUNT(*)::int AS n FROM subscription_runs WHERE subscription_id = $1`,
        [subscriptionId]
      );

      const boss = { send: vi.fn() };
      const result = await processRenewal(db, boss, "packagesmall", subscriptionId);

      expect(result).toBeUndefined();
      expect(boss.send).not.toHaveBeenCalled();

      const invoicesAfter = await db.query(
        `SELECT COUNT(*)::int AS n FROM customer_invoices WHERE customer_id = 1`
      );
      const runsAfter = await db.query(
        `SELECT COUNT(*)::int AS n FROM subscription_runs WHERE subscription_id = $1`,
        [subscriptionId]
      );
      expect(invoicesAfter.rows[0].n).toBe(invoicesBefore.rows[0].n);
      expect(runsAfter.rows[0].n).toBe(runsBefore.rows[0].n);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // H2 — sendToKitchen atomicity
  // ───────────────────────────────────────────────────────────────
  describe("H2 — sendToKitchen atomic writes + rollback on failure", () => {
    const kds = require("../../services/restaurant-kds");
    let stationA;
    let stationB;

    beforeAll(async () => {
      // Seed 2 categories, 2 products (one per category), 2 stations,
      // 2 routing rules. This gives sendToKitchen a group split to
      // exercise — 2 tickets expected per send.
      // Factory already seeds category 1 + category 2 + product 1..5.
      // Products 1-3 are in category 1, products 4-5 in category 2.

      const { rows: [sa] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role, is_active)
         VALUES (1, 'Hot Line', 'prep', true) RETURNING id`
      );
      stationA = sa.id;

      const { rows: [sb] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role, is_active)
         VALUES (1, 'Cold Line', 'prep', true) RETURNING id`
      );
      stationB = sb.id;

      await db.query(
        `INSERT INTO kds_station_routes (station_id, category_id)
         VALUES ($1, 1)`,
        [stationA]
      );
      await db.query(
        `INSERT INTO kds_station_routes (station_id, category_id)
         VALUES ($1, 2)`,
        [stationB]
      );
    });

    async function seedDraftWithItems() {
      const { rows: [draft] } = await db.query(
        `INSERT INTO draft_orders (outlet_id, created_by, status)
         VALUES (1, 1, 'open') RETURNING id`
      );
      await db.query(
        `INSERT INTO draft_order_items
           (draft_order_id, product_id, product_name, quantity, price, kitchen_status)
         VALUES ($1, 1, 'Widget A', 1, 100, 'pending')`,
        [draft.id]
      );
      await db.query(
        `INSERT INTO draft_order_items
           (draft_order_id, product_id, product_name, quantity, price, kitchen_status)
         VALUES ($1, 4, 'Snack D', 1, 50, 'pending')`,
        [draft.id]
      );
      return draft.id;
    }

    it("happy path: inserts tickets + junction rows + events, marks items sent", async () => {
      const draftId = await seedDraftWithItems();

      const tickets = await kds.sendToKitchen(db, draftId);

      // Two tickets — one per station, since we seeded items in 2 different
      // categories routing to different stations.
      expect(tickets).toHaveLength(2);
      const stationIds = new Set(tickets.map(t => t.station_id));
      expect(stationIds.has(stationA)).toBe(true);
      expect(stationIds.has(stationB)).toBe(true);

      // Junction rows: 2 total (1 item per ticket).
      const { rows: junctions } = await db.query(
        `SELECT ticket_id, draft_order_item_id FROM kds_ticket_items
         WHERE ticket_id = ANY($1::int[])`,
        [tickets.map(t => t.id)]
      );
      expect(junctions).toHaveLength(2);

      // Events: 1 'created' per ticket.
      const { rows: events } = await db.query(
        `SELECT ticket_id, event_type FROM kds_ticket_events
         WHERE ticket_id = ANY($1::int[])`,
        [tickets.map(t => t.id)]
      );
      expect(events).toHaveLength(2);
      expect(events.every(e => e.event_type === "created")).toBe(true);

      // kitchen_status flipped to 'sent' on all items.
      const { rows: itemStatuses } = await db.query(
        `SELECT kitchen_status FROM draft_order_items WHERE draft_order_id = $1`,
        [draftId]
      );
      expect(itemStatuses).toHaveLength(2);
      expect(itemStatuses.every(i => i.kitchen_status === "sent")).toBe(true);
    });

    it("rollback path: mid-loop failure leaves zero tickets, zero junctions, items still pending", async () => {
      const draftId = await seedDraftWithItems();

      // Wrap the test db so its transaction method's internal `client` throws
      // on the 2nd kds_tickets INSERT. We want the first group's writes to
      // succeed and then force a failure on group 2 — that's the real
      // atomicity test (proves rollback of earlier writes, not just the
      // failing write).
      let kdsTicketInsertCount = 0;
      const wrappedDb = {
        query: (...args) => db.query(...args),
        transaction: (fn) => db.transaction(async (client) => {
          const wrappedClient = new Proxy(client, {
            get(target, prop) {
              if (prop === "query") {
                return (sql, params) => {
                  if (typeof sql === "string" && sql.includes("INSERT INTO kds_tickets")) {
                    kdsTicketInsertCount++;
                    if (kdsTicketInsertCount === 2) {
                      // Throw AFTER the first ticket + its junction + event
                      // have been written — before the second ticket lands.
                      // db.transaction()'s catch block will ROLLBACK.
                      throw new Error("Simulated mid-loop failure for rollback test");
                    }
                  }
                  return target.query(sql, params);
                };
              }
              return target[prop];
            },
          });
          return fn(wrappedClient);
        }),
      };

      await expect(kds.sendToKitchen(wrappedDb, draftId)).rejects.toThrow(
        /Simulated mid-loop failure/
      );

      // Critical assertions: the rollback wiped everything.
      const { rows: ticketsAfter } = await db.query(
        `SELECT id FROM kds_tickets WHERE draft_order_id = $1`,
        [draftId]
      );
      expect(ticketsAfter).toHaveLength(0);

      const { rows: junctionsAfter } = await db.query(
        `SELECT kti.ticket_id FROM kds_ticket_items kti
         JOIN kds_tickets kt ON kt.id = kti.ticket_id
         WHERE kt.draft_order_id = $1`,
        [draftId]
      );
      expect(junctionsAfter).toHaveLength(0);

      const { rows: itemStatuses } = await db.query(
        `SELECT kitchen_status FROM draft_order_items WHERE draft_order_id = $1`,
        [draftId]
      );
      expect(itemStatuses.every(i => i.kitchen_status === "pending")).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // H3 — notifyCustomerSms feature flag gate
  // ───────────────────────────────────────────────────────────────
  describe("H3 — notifyCustomerSms gated on phase5_sms_providers", () => {
    let orderId;
    let sendSmsSpy;

    beforeAll(async () => {
      // Install the sms.sendSms spy against the real module. See the
      // file-top comment for why this uses vi.spyOn instead of vi.mock.
      const smsService = require("../../services/sms");
      sendSmsSpy = vi
        .spyOn(smsService, "sendSms")
        .mockResolvedValue({ success: true, provider_ref: "test-1" });

      // Enable sms_consent on customer 1 (factory seeds it at id=1).
      // sms_consent column was added in v21 per fix-plan.md Phase 3 M2.
      // Defensive: add it if missing, then set it.
      await db.query(
        `ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN DEFAULT false`
      );
      await db.query(
        `UPDATE customers SET sms_consent = true, mobile = '0300-1234567' WHERE id = 1`
      );

      // Seed a web_orders row linked to customer 1.
      const { rows: [order] } = await db.query(
        `INSERT INTO web_orders
           (source, external_order_id, customer_id, delivery_method, currency,
            subtotal, grand_total, payment_status, fulfillment_status, order_status,
            ordered_at, tracking_number, external_order_number)
         VALUES ('test', 'H3-1', 1, 'ship_to_customer', 'PKR',
                 100, 100, 'pending', 'unfulfilled', 'open',
                 NOW(), 'TRK12345', 'H3-ORDER-001')
         RETURNING id`
      );
      orderId = order.id;
    });

    afterAll(() => {
      sendSmsSpy?.mockRestore();
    });

    beforeEach(() => {
      sendSmsSpy.mockClear();
    });

    it("flag OFF: sms.sendSms is NOT called", async () => {
      // Ensure the flag is absent or false.
      await db.query(
        `INSERT INTO feature_flags (key, enabled) VALUES ('phase5_sms_providers', false)
         ON CONFLICT (key) DO UPDATE SET enabled = false`
      );

      await couriersModule.notifyCustomerSms(
        db,
        orderId,
        "Hi {name}, your order {order} has tracking {tracking}"
      );

      expect(sendSmsSpy).not.toHaveBeenCalled();
    });

    it("flag ON: sms.sendSms IS called with the expected body", async () => {
      await db.query(
        `INSERT INTO feature_flags (key, enabled) VALUES ('phase5_sms_providers', true)
         ON CONFLICT (key) DO UPDATE SET enabled = true`
      );

      await couriersModule.notifyCustomerSms(
        db,
        orderId,
        "Hi {name}, your order {order} has tracking {tracking}"
      );

      expect(sendSmsSpy).toHaveBeenCalledTimes(1);
      const [, args] = sendSmsSpy.mock.calls[0];
      expect(args.to).toBe("0300-1234567");
      expect(args.body).toContain("H3-ORDER-001");
      expect(args.body).toContain("TRK12345");
      expect(args.type).toBe("transactional");
    });
  });
});
