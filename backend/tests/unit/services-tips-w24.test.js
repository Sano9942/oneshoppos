// W24 — services/tips.js captureTipOnSale must normalise tip_method to
// lowercase before INSERT and reject anything outside the DB CHECK allowlist.
//
// Before this fix, the frontend sent capitalised "Cash" / "Card" / "Wallet";
// the INSERT then failed on the tip_captures.tip_method CHECK constraint
// ('cash' | 'card' | 'split'); the route's fire-and-forget catch swallowed
// the error, the sale completed, and the tip vanished silently.
//
// This test exercises the normalisation + rejection logic without a real DB —
// the fake `db` object's `query` is a vi.fn() that we inspect after the call.

import { describe, it, expect, vi } from "vitest";
import tipsService from "../../services/tips.js";

const { captureTipOnSale } = tipsService;

function makeDb() {
  const queries = [];
  const db = {
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      // Idempotency check — return no existing row.
      if (/SELECT id FROM tip_captures WHERE sale_id/.test(sql)) {
        return { rows: [] };
      }
      // Outlet lookup from sales — return outlet 1.
      if (/SELECT outlet_id FROM sales/.test(sql)) {
        return { rows: [{ outlet_id: 1 }] };
      }
      // Final INSERT — return a fake row.
      if (/INSERT INTO tip_captures/.test(sql)) {
        return {
          rows: [
            {
              id: 1, sale_id: params[0], draft_order_id: params[1],
              outlet_id: params[2], server_id: params[3],
              tip_amount: params[4], tip_method: params[5],
            },
          ],
        };
      }
      // Anything else — empty.
      return { rows: [] };
    }),
  };
  return { db, queries };
}

describe("W24 — captureTipOnSale tip_method normalisation + validation", () => {
  it("accepts lowercase 'cash' (existing happy path, regression guard)", async () => {
    const { db } = makeDb();
    const captured = await captureTipOnSale(db, {
      sale_id: 100,
      draft_order_id: null,
      tip_amount: 360,
      tip_method: "cash",
      server_id: 1,
    });
    expect(captured).not.toBeNull();
    expect(captured.tip_method).toBe("cash");
  });

  it("normalises capitalised 'Cash' to 'cash' before INSERT (W24 fix)", async () => {
    const { db } = makeDb();
    const captured = await captureTipOnSale(db, {
      sale_id: 101,
      draft_order_id: null,
      tip_amount: 200,
      tip_method: "Cash",
      server_id: 1,
    });
    expect(captured).not.toBeNull();
    // The INSERT call should have received lowercase "cash" as $6.
    const insertCall = db.query.mock.calls.find((c) =>
      /INSERT INTO tip_captures/.test(c[0])
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][5]).toBe("cash"); // params[5] = tip_method
  });

  it("normalises 'CARD' to 'card' before INSERT", async () => {
    const { db } = makeDb();
    await captureTipOnSale(db, {
      sale_id: 102,
      draft_order_id: null,
      tip_amount: 100,
      tip_method: "CARD",
      server_id: 1,
    });
    const insertCall = db.query.mock.calls.find((c) =>
      /INSERT INTO tip_captures/.test(c[0])
    );
    expect(insertCall[1][5]).toBe("card");
  });

  it("rejects 'wallet' (not in DB allowlist) with INVALID_TIP_METHOD", async () => {
    const { db } = makeDb();
    await expect(
      captureTipOnSale(db, {
        sale_id: 103,
        draft_order_id: null,
        tip_amount: 50,
        tip_method: "Wallet",
        server_id: 1,
      })
    ).rejects.toMatchObject({
      code: "INVALID_TIP_METHOD",
      statusCode: 400,
    });
    // No INSERT should have been issued for the rejected call.
    const insertCall = db.query.mock.calls.find((c) =>
      /INSERT INTO tip_captures/.test(c[0])
    );
    expect(insertCall).toBeUndefined();
  });

  it("rejects garbage / mistyped tip_method", async () => {
    const { db } = makeDb();
    await expect(
      captureTipOnSale(db, {
        sale_id: 104,
        draft_order_id: null,
        tip_amount: 10,
        tip_method: "cassh",
        server_id: 1,
      })
    ).rejects.toThrow(/cassh/);
  });

  it("still returns null for tip_amount <= 0 (existing behaviour)", async () => {
    const { db } = makeDb();
    const captured = await captureTipOnSale(db, {
      sale_id: 105,
      draft_order_id: null,
      tip_amount: 0,
      tip_method: "Cash",
      server_id: 1,
    });
    expect(captured).toBeNull();
    // Nothing should have been queried beyond the early-return guard.
    expect(db.query).not.toHaveBeenCalled();
  });
});
