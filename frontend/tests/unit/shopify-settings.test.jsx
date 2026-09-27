// One Toy Store pilot, Phase C / D29: the Shopify Settings tab sent Save as POST
// to a PUT-only route, Disconnect as DELETE, and five more buttons to addresses
// the backend never had, so no store could be connected from the screen. New
// connections are Dev Dashboard apps (Client ID + secret): Shopify no longer
// lets anyone create the old permanent-token apps.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The backend's Shopify routes (backend/routes/shopify/*.js) the screen may use.
const REAL_ROUTES = new Set([
  "PUT /api/integrations/shopify/config",
  "POST /api/integrations/shopify/disconnect",
  "POST /api/integrations/shopify/verify",
  "POST /api/integrations/shopify/live-validation",
  "POST /api/integrations/shopify/sync/process-pending",
  "POST /api/integrations/shopify/sync/retry-failed",
]);

const state = vi.hoisted(() => ({ config: null, calls: [], setConfig: null }));
const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });

vi.mock("../../src/pages/shopify/ShopifyContext", async () => {
  const React = await import("react");
  return {
    useShopify: () => {
      const [config, setConfig] = React.useState(state.config);
      return {
        config,
        setConfig,
        status: null,
        loadAll: vi.fn(async () => {}),
        setError: vi.fn(),
        setSuccess: vi.fn(),
        apiFetch: vi.fn(async (path, opts = {}) => {
          state.calls.push({ route: `${opts.method || "GET"} ${path}`, body: opts.body ? JSON.parse(opts.body) : null });
          return ok({ ok: true, checks: {}, queued: 0 });
        }),
      };
    },
  };
});

const blank = {
  connected: false, shop_domain: "", api_version: "2025-10", default_location_id: "",
  auth_mode: "app", saved_auth_mode: null, client_id: "", client_secret: "",
  access_token: "", webhook_secret: "", access_token_expires_at: null, last_error: null,
};

async function renderSettings(config) {
  state.config = config;
  const { default: ShopifySettings } = await import("../../src/pages/shopify/ShopifySettings");
  return render(<ShopifySettings />);
}

beforeEach(() => {
  state.calls = [];
});

describe("Shopify Settings", () => {
  it("a new connection is a Dev Dashboard app, saved with PUT and the client ID + secret", async () => {
    const { container } = await renderSettings(blank);
    fireEvent.change(screen.getByPlaceholderText("your-store.myshopify.com"), { target: { value: "ots-sanopos-test.myshopify.com" } });
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "cid-1" } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "sec-1" } });
    fireEvent.submit(container.querySelector("form"));
    await waitFor(() => expect(state.calls).toHaveLength(1));
    expect(state.calls[0].route).toBe("PUT /api/integrations/shopify/config");
    expect(state.calls[0].body).toMatchObject({ shop_domain: "ots-sanopos-test.myshopify.com", client_id: "cid-1", client_secret: "sec-1" });
    expect(state.calls[0].body).not.toHaveProperty("access_token");
  });

  it("every button on a connected store calls a route the backend has", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderSettings({ ...blank, connected: true, shop_domain: "s.myshopify.com", saved_auth_mode: "app", client_id: "cid-1" });
    const buttons = [/Verify Connection/, /Run Live Check/, /Send waiting stock changes/, /Retry failed stock changes/, /Disconnect/, /Save Connection/];
    for (const [i, name] of buttons.entries()) {
      await waitFor(() => expect(screen.getByRole("button", { name }).disabled).toBe(false));
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(state.calls).toHaveLength(i + 1));
    }
    for (const c of state.calls) expect(REAL_ROUTES.has(c.route), c.route).toBe(true);
    // Saving again without re-typing the secret sends it empty: the backend keeps the saved one.
    const save = state.calls.find((c) => c.route.startsWith("PUT"));
    expect(save.body.client_secret).toBe("");
  }, 20000);

  it("no mislabelled 'Dry Run' buttons: they pushed real counts and pulled real orders", async () => {
    await renderSettings({ ...blank, connected: true, saved_auth_mode: "app" });
    expect(screen.queryByText(/Dry Run/)).toBeNull();
  });

  it("an old permanent-token connection still shows the token fields", async () => {
    await renderSettings({ ...blank, connected: true, auth_mode: "token", saved_auth_mode: "token" });
    expect(screen.getByLabelText("Admin Access Token")).toBeTruthy();
    expect(screen.queryByLabelText("Client ID")).toBeNull();
  });
});
