import { useEffect, useRef, useState } from "react";
import { X, QrCode, CheckCircle2, Clock } from "lucide-react";
import { api } from "../../../../api";

// Phase 2-R.3 — Staff-facing "Request QR Payment" modal.
//
// Opens when staff clicks the Pay-at-table action. POSTs to
// /api/restaurant/checks/:id/payment-session to mint a session + token.
// Shows a scannable QR code of the public /pay/:token URL + live status.
// Polls /status every 3s; when the session flips to paid, the modal
// announces success and closes.

export default function PayAtTableQRModal({
  open,
  onClose,
  onSuccess,
  draftOrderId,
  tableLabel,
  moneyFormat,
}) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const pollRef = useRef(null);
  const timerRef = useRef(null);

  // Mint the session when opened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus("idle");
    setError(null);
    setSession(null);
    (async () => {
      try {
        const data = await api.post(
          `/api/restaurant/checks/${draftOrderId}/payment-session`,
          { tip_amount: 0 }
        );
        if (cancelled) return;
        setSession(data);
        setStatus("waiting");
      } catch (e) {
        if (cancelled) return;
        setError(e.message || "Could not create payment session");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [open, draftOrderId]);

  // Poll status every 3s; flip to paid when backend confirms.
  useEffect(() => {
    if (!open || !session?.id || status === "paid") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.get(`/api/restaurant/payment-sessions/${session.id}/status`);
        if (data.status === "paid") {
          setStatus("paid");
          clearInterval(pollRef.current);
          pollRef.current = null;
          onSuccess?.({ saleId: data.sale_id });
        } else if (data.status === "failed" || data.status === "expired") {
          setStatus(data.status);
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch { /* transient network — keep polling */ }
    }, 3000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [open, session?.id, status, onSuccess]);

  // Countdown tick for the 15-min expiry.
  useEffect(() => {
    if (!session?.expires_at) return;
    const tick = () => {
      const ms = Math.max(0, new Date(session.expires_at).getTime() - Date.now());
      setRemaining(Math.floor(ms / 1000));
      if (ms === 0 && status === "waiting") setStatus("expired");
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [session?.expires_at, status]);

  if (!open) return null;

  const payUrl = session?.pay_url || session?.qr_url || null;
  const qrSrc = payUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(payUrl)}`
    : null;

  const money = (n) => (moneyFormat ? moneyFormat(n) : `Rs ${Number(n).toFixed(2)}`);
  const mmss = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <QrCode size={20} className="text-[#8066FF]" />
            <h2 className="text-lg font-bold text-slate-900">Request QR Payment</h2>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {tableLabel && (
            <p className="text-sm text-slate-500 mb-3 text-center">
              Table <span className="font-semibold text-slate-800">{tableLabel}</span>
            </p>
          )}

          {status === "paid" ? (
            <div className="text-center py-6">
              <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                <CheckCircle2 size={40} className="text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-1">Payment received</h3>
              <p className="text-sm text-slate-600">Table is cleared for busser.</p>
            </div>
          ) : status === "error" ? (
            <div className="text-center py-6">
              <div className="mx-auto h-16 w-16 rounded-full bg-rose-100 flex items-center justify-center mb-3 text-rose-600 text-2xl font-bold">!</div>
              <h3 className="text-xl font-bold text-slate-900 mb-1">Couldn't start</h3>
              <p className="text-sm text-slate-600">{error}</p>
            </div>
          ) : status === "expired" || status === "failed" ? (
            <div className="text-center py-6">
              <div className="mx-auto h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center mb-3 text-amber-600 text-2xl">
                <Clock />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-1">
                {status === "expired" ? "Session expired" : "Payment failed"}
              </h3>
              <p className="text-sm text-slate-600">Try again or take payment at the terminal.</p>
            </div>
          ) : (
            <>
              {qrSrc ? (
                <div className="flex flex-col items-center">
                  <div className="p-3 bg-white border border-slate-200 rounded-xl">
                    <img src={qrSrc} alt="Scan to pay" className="h-52 w-52" />
                  </div>
                  <p className="mt-4 text-sm text-slate-700 text-center">
                    Ask the guest to scan this code with their phone camera.
                  </p>
                  {session?.amount != null && (
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {money(Number(session.amount) + Number(session.tip_amount || 0))}
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full">
                    <div className="h-2 w-2 rounded-full bg-[#8066FF] animate-pulse" />
                    <span className="text-xs font-semibold text-slate-700">
                      Waiting for guest · expires in {mmss}
                    </span>
                  </div>
                  {payUrl && (
                    <a
                      href={payUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 text-[11px] text-slate-400 hover:text-[#8066FF] break-all text-center"
                    >
                      {payUrl}
                    </a>
                  )}
                </div>
              ) : (
                <div className="text-center py-10 text-sm text-slate-500">Generating code…</div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 h-10 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-200"
          >
            {status === "paid" ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
