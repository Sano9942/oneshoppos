import { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { API_BASE } from "../../config";

// Phase 2-R.3 — Guest-facing pay-at-table page.
//
// Mounted at /pay/:token. Loads the bill from the public endpoint, lets the
// guest pick a tip, confirms, then redirects to the SanoPay sandbox page.
// When the sandbox flow completes, the backend webhook flips the session
// to 'paid'; the modal on the staff side polls for that transition. This
// page just shows a thank-you screen when it sees status=paid.

const TIP_PRESETS = [
  { label: "No tip", pct: 0 },
  { label: "10%", pct: 10 },
  { label: "15%", pct: 15 },
  { label: "18%", pct: 18 },
  { label: "20%", pct: 20 },
];

export default function RestaurantPayPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const tenantSlug = searchParams.get("tenant");
  const statusParam = searchParams.get("status");

  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tipPct, setTipPct] = useState(15);
  const [customTip, setCustomTip] = useState("");
  const [confirming, setConfirming] = useState(false);

  const tenantQuery = tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/public/restaurant/pay/${encodeURIComponent(token)}${tenantQuery}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        return { status: r.status, data };
      })
      .then(({ status, data }) => {
        if (cancelled) return;
        if (status === 200) {
          setBill(data);
          setLoading(false);
        } else if (status === 410) {
          setError(data.error || "This payment link has expired");
          setLoading(false);
        } else if (status === 422) {
          setError(data.error || "Some items are no longer available");
          setLoading(false);
        } else {
          setError(data.error || "Bill not found");
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Unable to load bill. Please try again.");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [token, tenantQuery]);

  const subtotal = Number(bill?.amount || 0);
  const tipAmount = useMemo(() => {
    if (customTip !== "") {
      const n = Number(customTip);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }
    return Number((subtotal * tipPct / 100).toFixed(2));
  }, [subtotal, tipPct, customTip]);
  const grandTotal = subtotal + tipAmount;
  const currencySymbol = bill?.currency_symbol || "Rs";

  const onPay = async () => {
    setConfirming(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/public/restaurant/pay/${encodeURIComponent(token)}/confirm${tenantQuery}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tip_amount: tipAmount }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not initiate payment");
      if (data.redirect_url) {
        window.location.href = data.redirect_url;
      }
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    }
  };

  // Success screen — the sandbox page redirects back with ?status=success
  // once the simulate-webhook fires. The DB-side session is already 'paid'.
  if (statusParam === "success" || bill?.status === "paid") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-(--ui-primary) to-(--ui-primary-strong) flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-(--ui-surface) rounded-2xl shadow-lg p-8 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-(--ui-primary) flex items-center justify-center mb-4 text-(--ui-on-primary) text-3xl">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-(--ui-text) mb-2">Payment received</h1>
          <p className="text-(--ui-text-muted)">Thank you for dining with us.</p>
          {bill?.table_label && (
            <p className="text-sm text-(--ui-text-muted) mt-4">Table: <span className="font-medium">{bill.table_label}</span></p>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface)">
        <div className="text-(--ui-text-muted) text-sm">Loading bill…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) px-4">
        <div className="max-w-sm w-full bg-(--ui-surface) rounded-2xl shadow-lg p-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-(--ui-danger-bg) flex items-center justify-center mb-4 text-(--ui-danger-fg) text-2xl">!</div>
          <h1 className="text-xl font-bold text-(--ui-text) mb-2">Can't complete payment</h1>
          <p className="text-(--ui-text-muted) text-sm">{error}</p>
          <p className="mt-4 text-xs text-(--ui-text-muted)">Ask your server for a new payment link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-(--ui-muted-surface)">
      <header className="bg-(--ui-surface) border-b border-(--ui-border) sticky top-0 z-30">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-3">
          {bill?.logo_url ? (
            <img src={bill.logo_url} alt={bill.company_name} className="h-8 w-8 rounded object-cover" />
          ) : (
            <div className="h-8 w-8 rounded bg-(--ui-primary) text-(--ui-on-primary) flex items-center justify-center font-bold text-xs">
              {(bill?.company_name || "R").charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-(--ui-text) truncate">
              {bill?.company_name || "Restaurant"}
            </div>
            {bill?.table_label && (
              <div className="text-xs text-(--ui-text-muted)">Table {bill.table_label}</div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-5 pb-28">
        <div className="bg-(--ui-surface) rounded-2xl border border-(--ui-border) overflow-hidden">
          <div className="px-4 py-3 border-b border-(--ui-border) text-sm font-semibold text-(--ui-text)">
            Your Order
          </div>
          <ul className="divide-y divide-(--ui-border)">
            {(bill?.items || []).map((item) => (
              <li key={item.id} className="px-4 py-3 flex gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-(--ui-text) truncate">{item.name}</span>
                    {item.seat_number != null && (
                      <span className="text-[10px] bg-(--ui-warning-bg) text-(--ui-warning-fg) rounded px-1.5 py-0.5 font-bold">
                        Seat {item.seat_number}
                      </span>
                    )}
                  </div>
                  {item.notes && <div className="text-xs text-(--ui-text-muted) mt-0.5">{item.notes}</div>}
                  <div className="text-xs text-(--ui-text-muted)">Qty {item.quantity}</div>
                </div>
                <div className="text-sm font-semibold text-(--ui-text) shrink-0 text-right">
                  {currencySymbol} {Number(Number(item.price) * Number(item.quantity)).toFixed(2)}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-(--ui-surface) rounded-2xl border border-(--ui-border) mt-4 p-4">
          <div className="text-sm font-semibold text-(--ui-text) mb-3">Add a tip</div>
          <div className="grid grid-cols-5 gap-2 mb-3">
            {TIP_PRESETS.map((t) => (
              <button
                key={t.pct}
                type="button"
                onClick={() => { setTipPct(t.pct); setCustomTip(""); }}
                className={`h-10 rounded-lg text-xs font-semibold transition ${
                  customTip === "" && tipPct === t.pct
                    ? "bg-(--ui-primary) text-(--ui-on-primary) border border-(--ui-primary)"
                    : "bg-(--ui-muted-surface) text-(--ui-text) border border-(--ui-border) hover:bg-(--ui-muted-surface)"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="text-xs text-(--ui-text-muted) block mb-1">Custom tip ({currencySymbol})</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={customTip}
            onChange={(e) => setCustomTip(e.target.value)}
            placeholder="0.00"
            className="w-full h-10 px-3 border border-(--ui-border) rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-primary)/40"
          />
        </div>

        <div className="bg-(--ui-surface) rounded-2xl border border-(--ui-border) mt-4 p-4">
          <Row label="Subtotal" value={`${currencySymbol} ${subtotal.toFixed(2)}`} />
          <Row label="Tip" value={`${currencySymbol} ${tipAmount.toFixed(2)}`} />
          <div className="h-px bg-(--ui-muted-surface) my-2" />
          <Row label="Total" value={`${currencySymbol} ${grandTotal.toFixed(2)}`} bold />
        </div>
      </main>

      <div className="fixed bottom-0 inset-x-0 bg-(--ui-surface) border-t border-(--ui-border) px-4 py-3">
        <div className="max-w-md mx-auto">
          <button
            onClick={onPay}
            disabled={confirming || grandTotal <= 0}
            className="w-full h-12 rounded-xl bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) font-bold text-base shadow-[0_10px_20px_-10px_rgba(128,102,255,0.6)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {confirming ? "Redirecting…" : `Pay ${currencySymbol} ${grandTotal.toFixed(2)}`}
          </button>
          <p className="text-[10px] text-(--ui-text-muted) text-center mt-2">
            Powered by SanoPay · You'll complete payment on the next screen
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold = false }) {
  return (
    <div className="flex justify-between py-1">
      <span className={`text-sm ${bold ? "font-bold text-(--ui-text)" : "text-(--ui-text-muted)"}`}>{label}</span>
      <span className={`text-sm ${bold ? "font-bold text-(--ui-text)" : "text-(--ui-text)"}`}>{value}</span>
    </div>
  );
}
