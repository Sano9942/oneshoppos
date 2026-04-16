import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  looksLikeChunkLoadFailure,
  reloadOnceForChunkFailure,
} from "../../src/utils/chunkReload";

// Stale-chunk recovery is one of those things that's silent until it isn't.
// These tests guard the message-matching predicate (so we don't quietly stop
// catching the real after-deploy errors that show up in Sentry) and the
// once-per-window reload guard (so a network outage can't infinite-loop).

describe("looksLikeChunkLoadFailure", () => {
  it("matches 'Failed to fetch dynamically imported module' (Chrome/Firefox)", () => {
    const err = new TypeError(
      "Failed to fetch dynamically imported module: https://sanopos.com/assets/FulfillmentRedesign-D0gpE-fY.js"
    );
    expect(looksLikeChunkLoadFailure(err)).toBe(true);
  });

  it("matches 'error loading dynamically imported module' (Safari)", () => {
    const err = new TypeError(
      "error loading dynamically imported module: https://sanopos.com/assets/POSRoute-x.js"
    );
    expect(looksLikeChunkLoadFailure(err)).toBe(true);
  });

  it("matches webpack-style 'Loading chunk N failed'", () => {
    expect(looksLikeChunkLoadFailure(new Error("Loading chunk 42 failed"))).toBe(true);
  });

  it("matches Vite CSS preload failures", () => {
    expect(looksLikeChunkLoadFailure(new Error("Loading CSS chunk 7 failed"))).toBe(true);
  });

  it("matches 'Importing a module script failed' (Safari)", () => {
    expect(
      looksLikeChunkLoadFailure(new Error("Importing a module script failed."))
    ).toBe(true);
  });

  it("returns false for unrelated runtime errors", () => {
    expect(looksLikeChunkLoadFailure(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(looksLikeChunkLoadFailure(new TypeError("Cannot redefine property"))).toBe(false);
    expect(looksLikeChunkLoadFailure(new Error("user is not authenticated"))).toBe(false);
  });

  it("returns false for null/undefined/no-message values", () => {
    expect(looksLikeChunkLoadFailure(null)).toBe(false);
    expect(looksLikeChunkLoadFailure(undefined)).toBe(false);
    expect(looksLikeChunkLoadFailure({})).toBe(false);
  });
});

describe("reloadOnceForChunkFailure", () => {
  let storage;
  let reload;
  let now;

  beforeEach(() => {
    const data = new Map();
    storage = {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
    };
    reload = vi.fn();
    now = vi.fn(() => 1_000_000);
  });

  it("triggers reload on first call within a fresh session", () => {
    const result = reloadOnceForChunkFailure({ storage, reload, now });
    expect(result).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("suppresses a second reload inside the 30s guard window", () => {
    reloadOnceForChunkFailure({ storage, reload, now });
    now.mockReturnValue(1_000_000 + 5_000);
    const second = reloadOnceForChunkFailure({ storage, reload, now });
    expect(second).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows another reload after the guard window expires", () => {
    reloadOnceForChunkFailure({ storage, reload, now });
    now.mockReturnValue(1_000_000 + 31_000);
    const third = reloadOnceForChunkFailure({ storage, reload, now });
    expect(third).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("returns false when no storage is available", () => {
    const result = reloadOnceForChunkFailure({ storage: null, reload, now });
    expect(result).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
