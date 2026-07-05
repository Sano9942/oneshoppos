import { useCallback, useEffect, useRef, useState } from "react";
import { Check, PenLine, RotateCcw, X } from "lucide-react";
import { usePOS } from "../POSContext";

// Phase 2-R.0 Day 8 — Full-viewport "hand to guest" overlay.
// Three panels: tip preset → signature canvas → receipt choice.
//
// Tip: reuses tipAmount / tipMethod from POSContext so the value the
//   guest confirms feeds straight into the existing POSCheckoutModal
//   flow (completeSale already forwards tip_amount + tip_method).
// Signature: HTML5 <canvas> captures pointer strokes, converts each
//   stroke to an SVG path, and stashes the resulting SVG string on
//   POSContext.signatureSvg. useCheckout JSON-encodes it into the sale
//   notes column (DB column for signatures lands in a later wave).
// Receipt choice: print / email / SMS. Print triggers the existing
//   slipOpen flow; email/SMS are stubs for 2-R.0 (show a notice so the
//   operator can fall back to the printed slip).
//
// Z-index: z-40 (lower than POSSessionExpiredModal at z-60) so session
// expiry can interrupt a signed handoff.

const TIP_PRESETS = [10, 15, 18, 20];

export default function RestaurantGuestModeModal() {
  const {
    showGuestMode,
    setShowGuestMode,
    total,
    money,
    tipAmount,
    setTipAmount,
    tipMethod,
    setTipMethod,
    signatureSvg,
    setSignatureSvg,
    showNotice,
  } = usePOS();

  const canvasRef = useRef(null);
  const strokesRef = useRef([]); // array of arrays of {x, y}
  const currentStrokeRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [receiptChoice, setReceiptChoice] = useState("print");

  // Resize canvas to match rendered size (for crisp lines + accurate coords).
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 2;
  }, []);

  useEffect(() => {
    if (!showGuestMode) return;
    // Defer to next frame so layout is settled before we read dimensions.
    const id = requestAnimationFrame(resizeCanvas);
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
    };
  }, [showGuestMode, resizeCanvas]);

  const pointerPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Capture subsequent moves even if the pointer leaves the canvas.
    if (canvas.setPointerCapture && e.pointerId !== undefined) {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    e.preventDefault();
    setDrawing(true);
    const p = pointerPos(e);
    currentStrokeRef.current = [p];
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const handlePointerMove = (e) => {
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const p = pointerPos(e);
    currentStrokeRef.current?.push(p);
    const ctx = canvas.getContext("2d");
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const endStroke = () => {
    if (!drawing) return;
    setDrawing(false);
    const stroke = currentStrokeRef.current;
    if (stroke && stroke.length > 0) {
      strokesRef.current.push(stroke);
      setHasInk(true);
    }
    currentStrokeRef.current = null;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current = [];
    setHasInk(false);
    setSignatureSvg?.(null);
  };

  const buildSvg = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const paths = strokesRef.current
      .filter((s) => s.length > 0)
      .map((stroke) => {
        const [first, ...rest] = stroke;
        const segs = rest.map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
        return `M${first.x.toFixed(1)} ${first.y.toFixed(1)} ${segs}`.trim();
      })
      .join(" ");
    if (!paths) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${paths}" fill="none" stroke="#101010" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };

  const onDone = () => {
    const svg = buildSvg();
    setSignatureSvg?.(svg);
    setShowGuestMode(false);
    if (receiptChoice === "email") {
      showNotice?.("Email the receipt from the slip after Complete Sale.");
    } else if (receiptChoice === "sms") {
      showNotice?.("SMS receipt is queued for 2-R.x — use print or email instead.");
    }
  };

  const onCancel = () => {
    clearSignature();
    setShowGuestMode(false);
  };

  if (!showGuestMode) return null;

  const numericTip = Number(tipAmount || 0);
  const grandTotal = total + numericTip;

  return (
    <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm flex items-stretch justify-stretch">
      <div className="flex-1 flex flex-col bg-(--ui-surface)">
        {/* Header — large + readable across a counter */}
        <div className="px-8 py-5 border-b border-(--ui-border) flex items-center justify-between bg-(--ui-muted-surface)">
          <div>
            <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-widest">
              Confirm with Guest
            </p>
            <h2 className="text-2xl font-black text-(--ui-text) mt-1">
              Review and sign
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="h-14 px-5 rounded-2xl bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) text-(--ui-text) font-bold text-sm flex items-center gap-2 transition"
          >
            <X size={16} /> Cancel
          </button>
        </div>

        {/* Body — stacked panels */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-6 sm:p-10 space-y-8">
            {/* Totals */}
            <div className="rounded-3xl bg-(--ui-muted-surface) border border-(--ui-border) p-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-widest">
                  Subtotal
                </p>
                <p className="text-xl font-black text-(--ui-text) mt-0.5">
                  {money(total)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-widest">
                  Total with tip
                </p>
                <p className="text-3xl font-black text-(--ui-text) mt-0.5">
                  {money(grandTotal)}
                </p>
              </div>
            </div>

            {/* Tip presets — large tap targets */}
            <div>
              <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-widest mb-3">
                Add a tip
              </p>
              <div className="grid grid-cols-4 gap-3">
                {TIP_PRESETS.map((pct) => {
                  const amt = Number(((total || 0) * pct) / 100).toFixed(2);
                  const active = Number(tipAmount) === Number(amt) && Number(amt) > 0;
                  return (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setTipAmount(amt)}
                      className={`min-h-[72px] rounded-2xl border-2 font-bold text-base transition ${
                        active
                          ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                          : "border-(--ui-border-strong) bg-(--ui-surface) text-(--ui-text) hover:border-(--ui-border-strong)"
                      }`}
                    >
                      <div className="text-xl font-black">{pct}%</div>
                      <div className="text-xs opacity-70 mt-0.5">{money(amt)}</div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="Custom tip"
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value)}
                  className="flex-1 min-h-[56px] px-4 bg-(--ui-surface) border-2 border-(--ui-border-strong) rounded-2xl focus:border-(--ui-focus) focus:ring-0 outline-none text-lg font-semibold"
                />
                {Number(tipAmount) > 0 && (
                  <button
                    type="button"
                    onClick={() => setTipAmount("")}
                    className="min-h-[56px] px-5 rounded-2xl bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) text-(--ui-text-muted) text-sm font-bold"
                  >
                    Clear
                  </button>
                )}
              </div>
              {Number(tipAmount) > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {["Cash", "Card", "Wallet"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTipMethod(m)}
                      className={`min-h-[56px] rounded-xl text-sm font-bold border-2 transition ${
                        tipMethod === m
                          ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                          : "border-(--ui-border-strong) bg-(--ui-surface) text-(--ui-text-muted) hover:border-(--ui-border-strong)"
                      }`}
                    >
                      Tip via {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Signature */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-widest flex items-center gap-1.5">
                  <PenLine size={14} className="text-(--ui-text-muted)" />
                  Signature
                </p>
                {hasInk && (
                  <button
                    type="button"
                    onClick={clearSignature}
                    className="text-xs font-bold text-(--ui-text-muted) hover:text-(--ui-danger) flex items-center gap-1"
                  >
                    <RotateCcw size={13} /> Clear
                  </button>
                )}
              </div>
              <div className="rounded-3xl border-2 border-dashed border-(--ui-border-strong) bg-(--ui-muted-surface) overflow-hidden">
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endStroke}
                  onPointerLeave={endStroke}
                  onPointerCancel={endStroke}
                  className="block w-full h-56 touch-none cursor-crosshair"
                  style={{ touchAction: "none" }}
                />
              </div>
              {!hasInk && (
                <p className="text-xs text-(--ui-text-muted) mt-2 text-center">
                  Sign above with your finger or stylus.
                </p>
              )}
            </div>

            {/* Receipt choice */}
            <div>
              <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-widest mb-3">
                Send receipt by
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: "print", label: "Print" },
                  { id: "email", label: "Email" },
                  { id: "sms", label: "SMS" },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setReceiptChoice(id)}
                    className={`min-h-[64px] rounded-2xl border-2 font-bold text-sm transition ${
                      receiptChoice === id
                        ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                        : "border-(--ui-border-strong) bg-(--ui-surface) text-(--ui-text) hover:border-(--ui-border-strong)"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer — Done */}
        <div className="px-8 py-5 border-t border-(--ui-border) bg-(--ui-muted-surface) flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[56px] px-6 rounded-2xl bg-(--ui-surface) border-2 border-(--ui-border-strong) text-(--ui-text) font-bold text-sm hover:bg-(--ui-muted-surface) transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDone}
            className="min-h-[56px] px-8 rounded-2xl bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-black text-base flex items-center gap-2 transition"
          >
            <Check size={18} /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
