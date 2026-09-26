// One Toy Store pilot, blocker 3a: the POS keeps its offline catalogue copy fresh.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../src/api", () => ({ api: { raw: vi.fn() } }));
vi.mock("../../src/auth/authStore", () => ({ readTenantSlug: () => "otsshop" }));

import { api } from "../../src/api";
import { resetCatalogueForTests, getCatalogueIndex } from "../../src/utils/offlineCatalogue";
import { useOfflineCatalogue, CATALOGUE_REFRESH_MS } from "../../src/pages/redesign/pos/hooks/useOfflineCatalogue";

const CATALOGUE = { products: [{ id: 1, name: "LEGO", barcode: "1", price: "1" }], variants: [] };
const ok = () => ({ ok: true, status: 200, headers: { get: () => '"v1"' }, json: async () => CATALOGUE });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  await resetCatalogueForTests();
});

describe("useOfflineCatalogue", () => {
  it("downloads the copy when the POS opens and reports how many items it holds", async () => {
    api.raw.mockResolvedValue(ok());
    const { result } = renderHook(() => useOfflineCatalogue());
    await waitFor(() => expect(result.current.productCount).toBe(1));
    expect(api.raw.mock.calls[0][0]).toBe("/api/products/catalogue");
    expect(getCatalogueIndex()).not.toBeNull();
  });

  it("refreshes again every few minutes and when the internet comes back", async () => {
    const spy = vi.spyOn(window, "setInterval");
    api.raw.mockResolvedValue(ok());
    renderHook(() => useOfflineCatalogue());
    await waitFor(() => expect(api.raw).toHaveBeenCalledTimes(1));
    const tick = spy.mock.calls.find(([, ms]) => ms === CATALOGUE_REFRESH_MS)?.[0];
    spy.mockRestore();
    expect(tick).toBeTypeOf("function");
    await act(async () => { tick(); });
    await waitFor(() => expect(api.raw).toHaveBeenCalledTimes(2));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(api.raw).toHaveBeenCalledTimes(3));
  });
});
