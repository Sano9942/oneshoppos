import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

export default function PortalInvoiceDetail() {
  const { tenantSlug, invoiceId } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payError, setPayError] = useState(null);
  const [paying, setPaying] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const inv = await portalApi.get(tenantSlug, `/api/portal/me/invoices/${invoiceId}`);
      setInvoice(inv);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug, invoiceId]);

  async function startPayment() {
    setPaying(true);
    setPayError(null);
    try {
      const res = await portalApi.post(
        tenantSlug,
        `/api/portal/me/invoices/${invoiceId}/pay`,
        {}
      );
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        setPayError("Payment link unavailable");
        setPaying(false);
      }
    } catch (err) {
      setPayError(err.message || "Payment failed to start");
      setPaying(false);
    }
  }

  if (loading) return <div className="text-slate-500">Loading…</div>;
  if (!invoice) return <div className="text-slate-500">Invoice not found.</div>;

  const canPay =
    invoice.status !== "paid" &&
    invoice.status !== "void" &&
    Number(invoice.balance_due) > 0;

  return (
    <div className="space-y-6">
      <Link to={`/portal/${tenantSlug}/invoices`} className="text-emerald-700 hover:underline text-sm">
        ← Back to invoices
      </Link>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{invoice.invoice_number}</h1>
            <p className="text-slate-500 text-sm">
              Status: <span className="font-medium">{invoice.status}</span>
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-500">Balance due</div>
            <div className="text-3xl font-semibold text-emerald-700">
              {Number(invoice.balance_due).toLocaleString()}
            </div>
          </div>
        </div>

        {canPay && (
          <div className="mt-6">
            <button
              type="button"
              disabled={paying}
              onClick={startPayment}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded font-medium disabled:opacity-50"
            >
              {paying ? "Starting payment…" : "Pay now"}
            </button>
            {payError && <div className="text-sm text-red-600 mt-2">{payError}</div>}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-semibold mb-3">Line items</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left font-medium px-3 py-2">Description</th>
              <th className="text-right font-medium px-3 py-2">Qty</th>
              <th className="text-right font-medium px-3 py-2">Unit</th>
              <th className="text-right font-medium px-3 py-2">Line total</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.items || []).map((it) => (
              <tr key={it.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2">{it.description}</td>
                <td className="px-3 py-2 text-right">{it.quantity}</td>
                <td className="px-3 py-2 text-right">{Number(it.unit_price).toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{Number(it.line_total).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-semibold mb-3">Payments</h2>
        {(invoice.payments || []).length === 0 ? (
          <div className="text-sm text-slate-500">No payments recorded yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invoice.payments.map((p) => (
              <li key={p.id} className="py-2 flex justify-between text-sm">
                <span>
                  {new Date(p.created_at).toLocaleString()} — {p.payment_method}
                </span>
                <span className="font-medium">{Number(p.amount).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
