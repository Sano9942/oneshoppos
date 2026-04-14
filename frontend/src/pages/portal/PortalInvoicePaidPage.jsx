import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

// Polls the invoice for up to ~12s after webhook-triggered payment.
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 8;

export default function PortalInvoicePaidPage() {
  const { tenantSlug } = useParams();
  const [searchParams] = useSearchParams();
  const invoiceId = searchParams.get("invoice");
  const [invoice, setInvoice] = useState(null);
  const [status, setStatus] = useState("polling");

  useEffect(() => {
    if (!invoiceId) {
      setStatus("error");
      return undefined;
    }
    let cancelled = false;
    let attempts = 0;
    let timer;

    async function tick() {
      if (cancelled) return;
      attempts += 1;
      try {
        const inv = await portalApi.get(tenantSlug, `/api/portal/me/invoices/${invoiceId}`);
        if (cancelled) return;
        setInvoice(inv);
        if (inv.status === "paid" || Number(inv.balance_due) === 0) {
          setStatus("paid");
          return;
        }
      } catch {
        // ignore and retry
      }
      if (attempts >= MAX_POLLS) {
        setStatus("timeout");
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tenantSlug, invoiceId]);

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl border border-slate-200 p-8 shadow-sm text-center">
      {status === "polling" && (
        <>
          <div className="text-slate-500">Confirming your payment…</div>
          <div className="mt-2 text-xs text-slate-400">This usually takes a few seconds.</div>
        </>
      )}
      {status === "paid" && invoice && (
        <>
          <div className="text-4xl mb-2">✅</div>
          <h1 className="text-2xl font-semibold">Payment received</h1>
          <p className="text-slate-600 mt-2">
            Invoice {invoice.invoice_number} is now marked as paid.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link
              to={`/portal/${tenantSlug}/invoices/${invoice.id}`}
              className="text-emerald-700 hover:underline"
            >
              View receipt
            </Link>
            <Link to={`/portal/${tenantSlug}`} className="text-slate-500 hover:text-slate-800">
              Back to dashboard
            </Link>
          </div>
        </>
      )}
      {status === "timeout" && (
        <>
          <div className="text-4xl mb-2">⏳</div>
          <h1 className="text-xl font-semibold">Still processing</h1>
          <p className="text-slate-600 mt-2">
            Your bank is taking a little longer to confirm. Refresh the invoice in a moment.
          </p>
          {invoiceId && (
            <Link
              to={`/portal/${tenantSlug}/invoices/${invoiceId}`}
              className="mt-4 inline-block text-emerald-700 hover:underline"
            >
              View invoice
            </Link>
          )}
        </>
      )}
      {status === "error" && <div className="text-red-600">Missing invoice reference.</div>}
    </div>
  );
}
