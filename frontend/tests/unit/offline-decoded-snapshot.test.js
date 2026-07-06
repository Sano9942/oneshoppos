import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  enqueueSale,
  getSalesQueue,
  clearQueue,
} from "../../src/utils/offlineQueue";

// V01 grocery harden — offline queue + decoded barcodes. A price-embedded line
// carries a FINAL, decoded price; when the lane is offline the queued payload
// must replay with that exact price and its price_locked flag, NOT re-resolve
// the product's shelf price on sync (which would re-open it to promos / lose
// the counter price). The queue snapshots the whole payload verbatim, so this
// asserts the decoded fields survive the round-trip unchanged.

const EMP = 909;

beforeEach(async () => { await clearQueue(EMP); });
afterEach(async () => { await clearQueue(EMP); });

function makeDecodedSale(key) {
  return {
    idempotency_key: key,
    cartItems: [
      // A scale price-embedded deli pack: final price 137.45, locked.
      {
        id: 42,
        name: "Chicken pack",
        price: 137.45,
        quantity: 1,
        price_locked: true,
        decoded: true,
        decoded_embed: "price",
        tare_locked: true,
      },
      // A normal line alongside it.
      { id: 7, name: "Bread", price: 90, quantity: 2 },
    ],
    payments: [{ method: "Cash", amount: 317.45 }],
    total: 317.45,
  };
}

describe("offline queue snapshots decoded price-locked lines", () => {
  it("replays the decoded final price + price_locked flag unchanged", async () => {
    await enqueueSale(EMP, makeDecodedSale("dec-1"));
    const rows = await getSalesQueue(EMP);
    expect(rows).toHaveLength(1);

    const line = rows[0].payload.cartItems.find((i) => i.id === 42);
    expect(line.price).toBe(137.45); // exact decoded price, not re-resolved
    expect(line.price_locked).toBe(true);
    expect(line.decoded).toBe(true);
    expect(line.tare_locked).toBe(true);

    // The normal line is untouched and NOT locked.
    const normal = rows[0].payload.cartItems.find((i) => i.id === 7);
    expect(normal.price).toBe(90);
    expect(normal.price_locked).toBeUndefined();
  });
});
