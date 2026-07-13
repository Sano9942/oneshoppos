import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit tests for services/booking-reminders.js.
//
// Before Pattern A, this module was dead code: its processPendingReminders
// function was exported but never called — booking-reminders had no worker
// registration anywhere. Pattern A Commit 3 registers it in boot/workers.js
// as a tenant-aware setInterval poll using forEachActiveTenant.
//
// These tests verify the function's logic directly: given a tenant-scoped
// db and a fake pg-boss, it (a) fetches pending reminders, (b) enqueues
// email jobs for email-channel reminders, (c) marks rows as sent on
// success, (d) marks rows as failed when the enqueue throws.
//
// Pattern is the same as Commit 2: mock nothing from the services layer —
// just build a fake `db` and `boss` and pass them in.

const { processPendingReminders } = require("../../services/booking-reminders");

/**
 * Build a fake tenant-scoped db whose query() returns canned rows for
 * the SELECT and records calls for the UPDATEs.
 */
function fakeDb({ reminders = [], appointmentsFlag = true } = {}) {
  const queries = [];
  return {
    queries,
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("FROM feature_flags")) {
        // Business Modules gate: worker no-ops unless phase4_appointments is on.
        return appointmentsFlag
          ? { rows: [{ enabled: true }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM appointment_reminders")) {
        return { rows: reminders, rowCount: reminders.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

function fakeBoss({ sendShouldThrow = false } = {}) {
  return {
    send: vi.fn(async (jobName, payload) => {
      if (sendShouldThrow) throw new Error("boss.send failed");
      return { id: "job-id" };
    }),
  };
}

describe("processPendingReminders", () => {
  it("returns 0 and does nothing when no reminders are pending", async () => {
    const db = fakeDb({ reminders: [] });
    const boss = fakeBoss();
    const result = await processPendingReminders(db, boss);
    expect(result).toBe(0);
    expect(boss.send).not.toHaveBeenCalled();
    // Flag gate + the Step 9 per-outlet activation reads (outlets, overrides,
    // defaults via getDisabledOutletIds) + SELECT ran — no UPDATEs.
    expect(db.queries).toHaveLength(5);
    expect(db.queries[0].sql).toContain("FROM feature_flags");
    expect(db.queries[db.queries.length - 1].sql).toContain("FROM appointment_reminders");
    expect(db.queries.some((q) => /UPDATE/i.test(q.sql))).toBe(false);
  });

  it("no-ops entirely when the Appointments module flag is off (Business Modules gate)", async () => {
    const reminders = [
      { id: 1, channel: "email", customer_email: "a@example.com", customer_name: "A", service_name: "Svc", appt_start: "2026-05-01T10:00:00Z" },
    ];
    const db = fakeDb({ reminders, appointmentsFlag: false });
    const boss = fakeBoss();

    const result = await processPendingReminders(db, boss);

    expect(result).toBe(0);
    expect(boss.send).not.toHaveBeenCalled();
    // Only the flag-gate query ran — pending rows were never even fetched,
    // so they stay 'pending' and resume when the module is re-enabled.
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].sql).toContain("FROM feature_flags");
  });

  it("enqueues an email job for each pending email-channel reminder", async () => {
    const reminders = [
      {
        id: 1,
        channel: "email",
        customer_email: "a@example.com",
        customer_name: "Alice",
        service_name: "Haircut",
        appt_start: "2026-05-01T10:00:00Z",
      },
      {
        id: 2,
        channel: "email",
        customer_email: "b@example.com",
        customer_name: "Bob",
        service_name: "Color",
        appt_start: "2026-05-01T14:00:00Z",
      },
    ];
    const db = fakeDb({ reminders });
    const boss = fakeBoss();

    const result = await processPendingReminders(db, boss);

    expect(result).toBe(2);
    expect(boss.send).toHaveBeenCalledTimes(2);
    // First enqueue was for Alice's haircut.
    const firstCall = boss.send.mock.calls[0];
    expect(firstCall[0]).toBe("email");
    expect(firstCall[1].to).toBe("a@example.com");
    expect(firstCall[1].subject).toContain("Haircut");
    // Second enqueue was for Bob's color.
    const secondCall = boss.send.mock.calls[1];
    expect(secondCall[1].to).toBe("b@example.com");
    expect(secondCall[1].subject).toContain("Color");
  });

  it("marks each processed reminder as 'sent' on the scoped db", async () => {
    const reminders = [
      { id: 42, channel: "email", customer_email: "x@e.com", customer_name: "X", service_name: "Svc", appt_start: "2026-05-01T10:00:00Z" },
    ];
    const db = fakeDb({ reminders });
    const boss = fakeBoss();

    await processPendingReminders(db, boss);

    // Expect: SELECT (1) + UPDATE sent (1) = 2 queries total.
    const updateSent = db.queries.find(
      (q) => q.sql.includes("UPDATE appointment_reminders SET status = 'sent'")
    );
    expect(updateSent).toBeDefined();
    expect(updateSent.params).toEqual([42]);
  });

  it("marks a reminder as 'failed' when boss.send throws", async () => {
    const reminders = [
      { id: 7, channel: "email", customer_email: "x@e.com", customer_name: "X", service_name: "Svc", appt_start: "2026-05-01T10:00:00Z" },
    ];
    const db = fakeDb({ reminders });
    const boss = fakeBoss({ sendShouldThrow: true });

    const result = await processPendingReminders(db, boss);

    // processPendingReminders catches internal errors and marks the row
    // as failed rather than crashing the worker iteration.
    expect(result).toBe(1); // count of rows considered, not rows sent

    const updateFailed = db.queries.find(
      (q) => q.sql.includes("UPDATE appointment_reminders SET status = 'failed'")
    );
    expect(updateFailed).toBeDefined();
    expect(updateFailed.params).toEqual([7]);

    // The 'sent' update must NOT have fired.
    const updateSent = db.queries.find(
      (q) => q.sql.includes("UPDATE appointment_reminders SET status = 'sent'")
    );
    expect(updateSent).toBeUndefined();
  });

  // F05 fix: the SMS channel now routes through the notification engine and is
  // marked truthfully. Previously it fell through to a false 'sent' without
  // delivering anything (completion-03 verdict: real latent bug). These cases
  // replace the old bug-documenting test deliberately.
  it("routes SMS-channel reminders through the engine and marks 'sent' on real delivery", async () => {
    const reminders = [
      { id: 9, channel: "sms", customer_id: 3, appointment_id: 55, customer_phone: "03001234567", customer_name: "X", service_name: "Svc", appt_start: "2026-05-01T10:00:00Z" },
    ];
    const db = fakeDb({ reminders });
    const boss = fakeBoss();
    const notify = vi.fn(async () => ({ dispatched: [{ channel: "sms", status: "sent", provider_ref: "p1" }] }));

    await processPendingReminders(db, boss, "acme", { notify });

    // Did NOT use the email queue for an sms reminder.
    expect(boss.send).not.toHaveBeenCalled();
    // Called the engine with the sms channel hint + slug + appointment entity.
    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0][1];
    expect(arg.event).toBe("appointment.reminder");
    expect(arg.channelHints).toEqual(["sms"]);
    expect(arg.tenantSlug).toBe("acme");
    expect(arg.entityId).toBe(55);
    // Marked 'sent' (truthfully — the engine reported a real send).
    const updateSent = db.queries.find((q) => q.sql.includes("UPDATE appointment_reminders SET status = 'sent'"));
    expect(updateSent).toBeDefined();
    expect(updateSent.params).toEqual([9]);
    const updateFailed = db.queries.find((q) => q.sql.includes("UPDATE appointment_reminders SET status = 'failed'"));
    expect(updateFailed).toBeUndefined();
  });

  it("marks an SMS reminder 'failed' (not false 'sent') when the engine does NOT deliver", async () => {
    const reminders = [
      { id: 10, channel: "sms", customer_id: 3, appointment_id: 56, customer_phone: "03001234567", customer_name: "X", service_name: "Svc", appt_start: "2026-05-01T10:00:00Z" },
    ];
    const db = fakeDb({ reminders });
    const boss = fakeBoss();
    // Flag off / no rule / no provider → engine returns nothing dispatched.
    const notify = vi.fn(async () => ({ dispatched: [], reason: "disabled" }));

    await processPendingReminders(db, boss, "acme", { notify });

    const updateFailed = db.queries.find((q) => q.sql.includes("UPDATE appointment_reminders SET status = 'failed'"));
    expect(updateFailed).toBeDefined();
    expect(updateFailed.params).toEqual([10]);
    // The old false 'sent' update must NOT have fired.
    const updateSent = db.queries.find((q) => q.sql.includes("UPDATE appointment_reminders SET status = 'sent'"));
    expect(updateSent).toBeUndefined();
  });
});
