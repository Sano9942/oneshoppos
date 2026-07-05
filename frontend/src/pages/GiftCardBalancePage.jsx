import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { API_BASE, IS_MULTI_TENANT } from "../config";

/**
 * Phase 2-G Wave 2 (2-G.2) — public gift-card balance page.
 *
 * Route: /gift-card/:code
 *
 * Reads an optional ?tenant=<slug> for multi-tenant lookups. Hits
 * GET /api/gift-cards/public/:code — same pattern as
 * ReceiptPublicPage.jsx: no auth, minimal layout, safe payload only.
 */
export default function GiftCardBalancePage() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const tenantSlug = params.get("tenant");

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const q = IS_MULTI_TENANT && tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : "";
        const res = await fetch(
          `${API_BASE}/api/gift-cards/public/${encodeURIComponent(code)}${q}`,
        );
        const body = await res.json();
        if (!mounted) return;
        if (!res.ok) {
          setError(body.error || "Gift card not found");
        } else {
          setData(body);
        }
      } catch (err) {
        if (mounted) setError(err.message || "Network error");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [code, tenantSlug]);

  const symbol = data?.currency_symbol || "";
  const fmt = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    // Render with two-decimal precision so "500" reads as "Rs 500.00" — the
    // bare integer was misleading on a customer-facing surface (M13).
    return `${symbol}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="min-h-screen bg-(--ui-muted-surface) flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="bg-linear-to-br from-(--ui-primary) to-(--ui-primary-strong) rounded-t-2xl p-6 text-(--ui-on-primary) shadow-lg">
          <h1 className="text-lg font-semibold opacity-90">Gift Card</h1>
          <p className="text-sm opacity-75 mt-1">Balance check</p>
        </div>

        <div className="bg-(--ui-surface) rounded-b-2xl shadow-lg p-6">
          {loading && (
            <div className="text-center text-(--ui-text-muted) text-sm py-8">Looking up card…</div>
          )}

          {!loading && error && (
            <div className="text-center py-8">
              <div className="text-(--ui-text) font-medium">{error}</div>
              <p className="text-xs text-(--ui-text-muted) mt-2">
                Double-check the code on your card. If it still doesn't work, contact
                the store where you received it.
              </p>
            </div>
          )}

          {!loading && data && (
            <div>
              <div className="text-center mb-6">
                <p className="text-xs uppercase tracking-wider text-(--ui-text-muted) mb-1">Code</p>
                <p className="font-mono text-lg font-bold tracking-widest text-(--ui-text)">
                  {data.code}
                </p>
              </div>

              <div className="rounded-xl bg-(--ui-success-bg) border border-(--ui-success-bg) p-5 text-center">
                <p className="text-xs uppercase tracking-wider text-(--ui-success-fg) mb-1">Remaining</p>
                <p className="text-4xl font-bold text-(--ui-success-fg)">
                  {fmt(data.remaining_value)}
                </p>
                <p className="text-xs text-(--ui-success-fg) mt-2">
                  of {fmt(data.initial_value)} initial
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-(--ui-muted-surface) p-3 text-center">
                  <p className="uppercase tracking-wider text-(--ui-text-muted)">Type</p>
                  <p className="mt-1 font-semibold capitalize text-(--ui-text)">
                    {data.card_type}
                  </p>
                </div>
                <div className="rounded-lg bg-(--ui-muted-surface) p-3 text-center">
                  <p className="uppercase tracking-wider text-(--ui-text-muted)">Status</p>
                  <p className="mt-1 font-semibold capitalize text-(--ui-text)">
                    {String(data.activation_status).replace("_", " ")}
                  </p>
                </div>
              </div>

              {data.activation_status === "depleted" && (
                <div className="mt-4 text-center text-xs text-(--ui-danger-fg) bg-(--ui-danger-bg) border border-(--ui-danger-bg) rounded-lg p-3">
                  This card has been fully redeemed.
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-(--ui-text-muted) mt-4">
          Present the code at the store to redeem.
        </p>
      </div>
    </div>
  );
}
