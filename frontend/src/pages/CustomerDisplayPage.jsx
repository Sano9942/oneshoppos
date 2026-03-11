import { useState, useEffect, useRef } from "react";
import { API_BASE, IS_MULTI_TENANT } from "../config";
import { useCurrency } from "../contexts/CurrencyContext";

/**
 * Customer-Facing Display — standalone full-screen page for secondary monitor.
 * Polls GET /api/pos/customer-display?shift_id=X every 2 seconds.
 * No auth, no sidebar, no header.
 *
 * Usage: open /customer-display?shift_id=123 on the customer-facing screen.
 */
export default function CustomerDisplayPage() {
  const [data, setData] = useState({
    items: [],
    subtotal: 0,
    tax: 0,
    total: 0,
    status: "idle",
  });
  const { fmt: money } = useCurrency();
  const [storeName, setStoreName] = useState("SanoPOS");
  const prevItemCountRef = useRef(0);
  const [animateIdx, setAnimateIdx] = useState(-1);

  // Read shift_id and tenant from URL query params
  const params = new URLSearchParams(window.location.search);
  const shiftId = params.get("shift_id");
  const tenantSlug = params.get("tenant");

  // Fetch store name once
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .catch(() => null);
    // Try to get company name from company profile (public endpoint may not exist)
    // Fallback to "SanoPOS"
  }, []);

  // Poll for display data every 2 seconds
  useEffect(() => {
    if (!shiftId) return;

    const poll = () => {
      const tenantParam = IS_MULTI_TENANT && tenantSlug ? `&tenant=${tenantSlug}` : "";
      fetch(`${API_BASE}/api/pos/customer-display?shift_id=${shiftId}${tenantParam}`)
        .then((r) => r.json())
        .then((d) => {
          setData((prev) => {
            // Detect new item added
            if (d.items.length > prev.items.length) {
              setAnimateIdx(d.items.length - 1);
              setTimeout(() => setAnimateIdx(-1), 600);
            }
            return d;
          });
        })
        .catch(() => {});
    };

    poll(); // immediate first poll
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [shiftId]);

  const statusLabel =
    data.status === "paid"
      ? "Payment Complete"
      : data.status === "active"
        ? "Scanning items..."
        : "Ready";

  const statusColor =
    data.status === "paid"
      ? "text-emerald-400"
      : data.status === "active"
        ? "text-sky-400"
        : "text-slate-500";

  if (!shiftId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        <div className="text-center">
          <h1 className="mb-4 text-3xl font-bold">Customer Display</h1>
          <p className="text-lg text-slate-400">
            Missing shift_id parameter. Open this page with:
          </p>
          <code className="mt-2 block rounded bg-slate-800 px-4 py-2 text-sm text-sky-400">
            /customer-display?shift_id=YOUR_SHIFT_ID
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-700 bg-slate-800 px-8 py-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-wide">{storeName}</h1>
          <div className={`text-lg font-semibold ${statusColor}`}>
            {data.status === "paid" && (
              <span className="mr-2 inline-block animate-bounce text-emerald-400">
                &#10003;
              </span>
            )}
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex grow flex-col">
        {/* Items list */}
        <div className="grow overflow-y-auto px-8 py-6">
          {data.items.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-2xl text-slate-600">
                {data.status === "idle"
                  ? "Welcome! Your items will appear here."
                  : "No items yet"}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 text-left text-sm uppercase tracking-wider text-slate-500">
                  <th className="pb-3 pl-2">#</th>
                  <th className="pb-3">Item</th>
                  <th className="pb-3 text-center">Qty</th>
                  <th className="pb-3 text-right">Price</th>
                  <th className="pb-3 pr-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-slate-800 transition-all duration-500 ${
                      idx === animateIdx
                        ? "bg-sky-900/40 scale-[1.01]"
                        : "hover:bg-slate-800/50"
                    }`}
                  >
                    <td className="py-4 pl-2 text-lg text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="py-4 text-xl font-medium">{item.name}</td>
                    <td className="py-4 text-center text-xl">{item.qty}</td>
                    <td className="py-4 text-right text-xl tabular-nums">
                      {money(item.price)}
                    </td>
                    <td className="py-4 pr-2 text-right text-xl font-semibold tabular-nums">
                      {money(item.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Totals bar */}
        <div className="shrink-0 border-t border-slate-700 bg-slate-800 px-8 py-6">
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-sm uppercase tracking-wider text-slate-500">
                Subtotal
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {money(data.subtotal)}
              </p>
            </div>
            <div>
              <p className="text-sm uppercase tracking-wider text-slate-500">
                Tax
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {money(data.tax)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm uppercase tracking-wider text-slate-500">
                Total
              </p>
              <p className="text-4xl font-bold tabular-nums text-emerald-400">
                {money(data.total)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
