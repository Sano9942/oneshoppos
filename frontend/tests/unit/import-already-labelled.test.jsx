// One Toy Store pilot, Phase B step 6: the product import has a tick box
// "These items already have shelf labels" (the iPOS switchover), which keeps
// the imported items off "Labels to reprint". Off by default.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { apiState } = vi.hoisted(() => ({ apiState: { upload: vi.fn(), raw: vi.fn(), get: vi.fn() } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), toast: vi.fn() }) }));

const ok = (body) => ({ ok: true, json: async () => body });

async function uploadAndPreview() {
  const { default: ImportRedesign } = await import("../../src/pages/redesign/ImportRedesign");
  const { container } = render(<ImportRedesign />);
  const input = container.querySelector('input[type="file"][accept=".csv,text/csv"]');
  fireEvent.change(input, { target: { files: [new File(["name,selling_price\nKite,300\n"], "p.csv", { type: "text/csv" })] } });
  await screen.findByRole("button", { name: /Import 1 row/ });
}

describe("product import: already-labelled tick box", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.upload.mockImplementation(async (url) =>
      url.includes("preview=1")
        ? ok({ rows: [{ name: "Kite", price: 300 }], valid: 1, errors: [] })
        : ok({ imported: 1, errors: [] }));
  });

  it("unticked: imports without the flag", async () => {
    await uploadAndPreview();
    fireEvent.click(screen.getByRole("button", { name: /Import 1 row/ }));
    await waitFor(() => expect(apiState.upload).toHaveBeenCalledTimes(2));
    expect(apiState.upload.mock.calls[1][0]).toBe("/api/import/products");
  });

  it("ticked: imports with already_labelled=1", async () => {
    await uploadAndPreview();
    fireEvent.click(screen.getByLabelText(/already have shelf labels/i));
    fireEvent.click(screen.getByRole("button", { name: /Import 1 row/ }));
    await waitFor(() => expect(apiState.upload).toHaveBeenCalledTimes(2));
    expect(apiState.upload.mock.calls[1][0]).toBe("/api/import/products?already_labelled=1");
  });
});
