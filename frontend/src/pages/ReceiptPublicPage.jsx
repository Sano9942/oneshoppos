import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { formatPaymentMethodLabel } from "../utils/receipt";

// Lightweight wrapper around the `qrcode` package for the public receipt.
// Sniffs the stored value: a data: or http: URL is an <img src> directly;
// a raw payload string gets encoded client-side via dynamic import.
function FbrQrImage({ value }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!value) return;
    const raw = String(value);
    if (raw.startsWith("data:") || raw.startsWith("http")) {
      setDataUrl(raw);
      return;
    }
    let cancelled = false;
    import("qrcode")
      .then((mod) => (mod.default || mod).toDataURL(raw, { margin: 1, width: 140 }))
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [value]);

  if (failed || !dataUrl) return null;
  return (
    <img
      src={dataUrl}
      alt="FBR QR code"
      className="mx-auto mt-2 h-28 w-28 border border-gray-200 bg-white p-1"
    />
  );
}

function fmtMoney(amount, symbol = "") {
  const n = Number(amount) || 0;
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReceiptPublicPage() {
  const { invoiceNumber } = useParams();
  const [sp] = useSearchParams();
  const tenant = sp.get("tenant") || "";

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const path = `/api/receipts/${encodeURIComponent(invoiceNumber)}/public${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`;
    api.raw(path)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Receipt not found" : "Failed to load receipt");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [invoiceNumber, tenant]);

  // Bucket F: OG meta for WhatsApp + social preview cards. Inject via plain
  // DOM so we don't pull in react-helmet for four tags. Cleans up on unmount
  // so navigating away leaves the document title alone.
  useEffect(() => {
    if (!data) return;
    const storeName = data.store?.name || "Receipt";
    const invoice = data.sale?.invoice_number || invoiceNumber;
    const total = data.sale?.total_amount;
    const sym = data.sale?.currency_symbol || "";
    const logo = data.template?.logo_url || data.store?.logo || "";
    const prevTitle = document.title;
    document.title = `Receipt ${invoice} — ${storeName}`;

    const metas = [
      ["og:title", `Receipt ${invoice} — ${storeName}`],
      ["og:description", total != null ? `Total: ${sym}${Number(total).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : `Thank you for your purchase at ${storeName}.`],
      ["og:type", "website"],
      ...(logo ? [["og:image", logo]] : []),
      ["twitter:card", "summary"],
    ];

    const nodes = metas.map(([prop, content]) => {
      const m = document.createElement("meta");
      // Twitter uses `name`, OG uses `property` — browsers tolerate both but
      // WhatsApp crawlers are strict about OG using `property=`.
      if (prop.startsWith("og:")) m.setAttribute("property", prop);
      else m.setAttribute("name", prop);
      m.setAttribute("content", content);
      m.setAttribute("data-bucket-f", "1");
      document.head.appendChild(m);
      return m;
    });

    return () => {
      document.title = prevTitle;
      nodes.forEach((n) => n.remove());
    };
  }, [data, invoiceNumber]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-emerald-600" />
          <p className="mt-3 text-sm text-gray-500">Loading receipt...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <svg className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Receipt Not Found</h2>
          <p className="mt-2 text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  const { store, sale, items, payments, fbr, template } = data;
  const sym = sale.currency_symbol || "";
  // Template overrides — null-safe across tenants that haven't run v76 yet.
  const headerLogo = template?.logo_url || store.logo || null;
  const footerText = template?.footer_text || null;
  const showFbr = template?.show_fbr !== false;
  const showQr = template?.show_qr !== false;

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .receipt-card { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="receipt-card mx-auto max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* Store header — prefers template logo over global company logo (Bucket F) */}
          <div className="bg-emerald-600 px-6 py-5 text-center text-white">
            {headerLogo && (
              <img
                src={headerLogo}
                alt={store.name}
                className="mx-auto mb-3 h-14 w-14 rounded-full border-2 border-white/30 bg-white object-contain p-1"
              />
            )}
            <h1 className="text-xl font-bold">{store.name || "Store"}</h1>
            {store.address && <p className="mt-1 text-sm text-emerald-100">{store.address}</p>}
            {store.phone && <p className="mt-0.5 text-sm text-emerald-100">{store.phone}</p>}
          </div>

          <div className="px-6 py-5">
            {/* Invoice info */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Invoice</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-gray-900">{sale.invoice_number}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Date</p>
                <p className="mt-0.5 text-sm text-gray-700">{fmtDate(sale.timestamp)}</p>
              </div>
            </div>

            {/* Customer / served by */}
            {(sale.customer_name || sale.employee_name) && (
              <div className="flex items-center justify-between border-b border-gray-100 py-3">
                {sale.customer_name && (
                  <div>
                    <p className="text-xs text-gray-400">Customer</p>
                    <p className="text-sm font-medium text-gray-800">{sale.customer_name}</p>
                  </div>
                )}
                {sale.employee_name && (
                  <div className={sale.customer_name ? "text-right" : ""}>
                    <p className="text-xs text-gray-400">Served by</p>
                    <p className="text-sm font-medium text-gray-800">{sale.employee_name}</p>
                  </div>
                )}
              </div>
            )}

            {/* Items table */}
            <div className="mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs font-medium uppercase tracking-wide text-gray-400">
                    <th className="pb-2 text-left">Item</th>
                    <th className="pb-2 text-center">Qty</th>
                    <th className="pb-2 text-right">Price</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2 pr-2 text-gray-800">{item.name}</td>
                      <td className="py-2 text-center text-gray-600">{item.quantity}</td>
                      <td className="py-2 text-right text-gray-600">{fmtMoney(item.price, sym)}</td>
                      <td className="py-2 text-right font-medium text-gray-800">{fmtMoney(item.total, sym)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Discount */}
            {Number(sale.discount_amount) > 0 && (
              <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="text-sm text-gray-500">Discount</span>
                <span className="text-sm font-medium text-red-600">-{fmtMoney(sale.discount_amount, sym)}</span>
              </div>
            )}

            {/* Total */}
            <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <span className="text-base font-semibold text-gray-700">Total</span>
              <span className="text-xl font-bold text-gray-900">{fmtMoney(sale.total_amount, sym)}</span>
            </div>

            {/* Payments */}
            {payments.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Payment</p>
                {payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-600">{formatPaymentMethodLabel(p.method)}</span>
                    <span className="text-sm font-medium text-gray-800">{fmtMoney(p.amount, sym)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* FBR digital invoice (Bucket F) — only when sale has an IRN and
                template has show_fbr !== false. QR shown only when show_qr too. */}
            {fbr?.irn && showFbr && (
              <div className="mt-4 border-t border-gray-100 pt-4 text-center">
                <p className="text-xs uppercase tracking-wide text-gray-400">FBR Digital Invoice</p>
                <p className="mt-1 font-mono text-xs font-semibold text-gray-800 break-all">{fbr.irn}</p>
                {showQr && fbr.qr_code && <FbrQrImage value={fbr.qr_code} />}
              </div>
            )}

            {/* Template footer override (Bucket F) — sits inside the card,
                distinct from the fixed "Powered by SanoPOS" strip below. */}
            {footerText && (
              <div className="mt-4 border-t border-gray-100 pt-3 text-center">
                <p className="whitespace-pre-wrap text-xs text-gray-500">{footerText}</p>
              </div>
            )}

            {/* Print button */}
            <button
              onClick={() => window.print()}
              className="no-print mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              Print Receipt
            </button>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 py-3 text-center">
            <p className="text-xs text-gray-400">Powered by <span className="font-medium text-gray-500">SanoPOS</span></p>
          </div>
        </div>
      </div>
    </>
  );
}
