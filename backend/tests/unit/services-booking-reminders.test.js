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
function fakeDb({ reminders = [] } = {}) {
  const queries = [];
  return {
    queries,
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
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
    // Only the SELECT query ran — no UPDATEs.
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].sql).toContain("FROM appointment_reminders");
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

  it("skips email enqueue for non-email channels but still marks row as sent", async () => {
    // Pre-existing behavior: SMS channel has no send code path, so the
    // function falls through to the 'sent' update without actually
    // delivering anything. Tracked as pre-existing issue, not fixed here.
    const reminders = [
      { id: 9, channel: "sms", customer_phone: "+100", customer_name: "X", service_name: "Svc", appt_start: "2026-05-01T10:00:00Z" },
    ];
    const db = fakeDb({ reminders });
    const boss = fakeBoss();

    await processPendingReminders(db, boss);

    expect(boss.send).not.toHaveBeenCalled();
    const updateSent = db.queries.find(
      (q) => q.sql.includes("UPDATE appointment_reminders SET status = 'sent'")
    );
    expect(updateSent).toBeDefined();
  });
});
