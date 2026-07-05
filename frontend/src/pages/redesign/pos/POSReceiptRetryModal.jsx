import { useState, useMemo } from "react";
import { Printer, Mail, MessageCircle, SkipForward, X, AlertTriangle } from "lucide-react";
import { buildReceiptHtml, buildReceiptSections, printToHardware } from "../../../utils/receipt";
import { logErrorState } from "../../../utils/errorLog";
import POSEmailReceiptModal from "./POSEmailReceiptModal";

/**
 * Receipt print retry modal (2-G.15 Day 2).
 *
 * Shown when `POSContext.printSlip` detects a hardware print failure.
 * Offers Print Again / Email / WhatsApp / Skip with action_history logging.
 *
 * Props:
 *  - open:      boolean
 *  - slip:      object — the slip payload (same shape passed to printSlip)
 *  - template:  object — active receipt template (nullable)
 *  - labels:    object — preset labels
 *  - currencySymbol: string
 *  - storeName: string — used for WhatsApp share text
 *  - error:     string — the hardware error that triggered the modal
 *  - onClose:   () => void
 */
export default function POSReceiptRetryModal({
  open,
  slip,
  template,
  labels,
  currencySymbol = "$",
  storeName = "",
  error,
  onClose,
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [showEmail, setShowEmail] = useState(false);

  // Store name resolution — prefer template-derived via buildReceiptSections,
  // fallback to the prop the caller passed in.
  const resolvedStoreName = useMemo(() => {
    if (!slip) return storeName;
    try {
      const sections = buildReceiptSections(slip, template, currencySymbol);
      return sections?.storeName || storeName || "";
    } catch {
      return storeName || "";
    }
  }, [slip, template, currencySymbol, storeName]);

  if (!open || !slip) return null;

  const retry = async () => {
    setRetrying(true);
    setRetryError("");
    try {
      const res = await printToHardware(slip, template, labels);
      if (res.ok) {
        logErrorState("pos_receipt_retry_success", `Receipt retry succeeded for ${slip.invoiceNumber || "unknown"}`, {
          sale_id: slip.saleId,
          invoice_number: slip.invoiceNumber,
        });
        onClose?.();
      } else {
        setRetryError(res.error || "Print failed again");
      }
    } catch (e) {
      setRetryError(e.message || "Print failed");
    } finally {
      setRetrying(false);
    }
  };

  const browserFallback = () => {
    try {
      buildReceiptHtml(slip, template, currencySymbol, labels);
      logErrorState("pos_receipt_browser_fallback", `Receipt printed via browser popup for ${slip.invoiceNumber || "unknown"}`, {
        sale_id: slip.saleId,
        invoice_number: slip.invoiceNumber,
      });
      onClose?.();
    } catch (e) {
      setRetryError(e.message || "Browser print failed");
    }
  };

  const shareWhatsApp = () => {
    const total = slip.balanceDue != null ? Math.max(0, slip.balanceDue) : slip.total;
    const receiptUrl = `${window.location.origin}/receipt/${slip.invoiceNumber || ""}`;
    const text = [
      `Receipt from ${resolvedStoreName || "our store"}`,
      `Invoice: ${slip.invoiceNumber || "—"}`,
      `Total: ${currencySymbol}${Number(total || 0).toLocaleString()}`,
      `View: ${receiptUrl}`,
    ].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    logErrorState("pos_receipt_whatsapp", `Receipt shared via WhatsApp for ${slip.invoiceNumber || "unknown"}`, {
      sale_id: slip.saleId,
      invoice_number: slip.invoiceNumber,
    });
    onClose?.();
  };

  const skip = () => {
    logErrorState("pos_receipt_skipped", `Receipt skipped for ${slip.invoiceNumber || "unknown"}`, {
      sale_id: slip.saleId,
      invoice_number: slip.invoiceNumber,
      reason: error || "print failure",
    });
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <div className="bg-(--ui-surface) rounded-xl shadow-(--ui-shadow-lg) w-full max-w-md p-6 text-(--ui-text)">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-(--ui-warning-fg)" />
            <h3 className="text-lg font-semibold">Print failed</h3>
          </div>
          <button onClick={skip} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-(--ui-text-muted) mb-1">
          The receipt printer didn't respond for invoice{" "}
          <span className="font-semibold text-(--ui-text)">
            {slip.invoiceNumber || "—"}
          </span>.
        </p>
        {error && <p className="text-xs text-(--ui-warning-fg) mb-3">{error}</p>}
        {retryError && <p className="text-xs text-(--ui-danger-fg) mb-3">{retryError}</p>}

        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="flex items-center justify-center gap-2 rounded-lg bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white disabled:opacity-50 px-3 py-3 text-sm font-semibold transition"
          >
            <Printer className="h-4 w-4" />
            {retrying ? "Retrying…" : "Print Again"}
          </button>
          {slip?.saleId && (
            <button
              type="button"
              onClick={() => setShowEmail(true)}
              className="flex items-center justify-center gap-2 rounded-lg border border-(--ui-border-strong) text-(--ui-text) hover:bg-(--ui-muted-surface) px-3 py-3 text-sm font-semibold transition"
            >
              <Mail className="h-4 w-4" />
              Email
            </button>
          )}
          <button
            type="button"
            onClick={shareWhatsApp}
            className="flex items-center justify-center gap-2 rounded-lg border border-(--ui-border-strong) text-(--ui-text) hover:bg-(--ui-muted-surface) px-3 py-3 text-sm font-semibold transition"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </button>
          <button
            type="button"
            onClick={browserFallback}
            className="flex items-center justify-center gap-2 rounded-lg border border-(--ui-border-strong) text-(--ui-text) hover:bg-(--ui-muted-surface) px-3 py-3 text-sm font-semibold transition"
          >
            <Printer className="h-4 w-4" />
            Browser
          </button>
        </div>

        <button
          type="button"
          onClick={skip}
          className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border border-(--ui-border-strong) text-(--ui-text-muted) hover:bg-(--ui-muted-surface) px-3 py-2 text-sm font-medium transition"
        >
          <SkipForward className="h-4 w-4" />
          Skip
        </button>
      </div>

      {showEmail && slip?.saleId && (
        <POSEmailReceiptModal
          saleId={slip.saleId}
          customerEmail={slip.customer?.email || ""}
          onClose={() => {
            setShowEmail(false);
            logErrorState("pos_receipt_emailed", `Receipt emailed for ${slip.invoiceNumber || "unknown"}`, {
              sale_id: slip.saleId,
              invoice_number: slip.invoiceNumber,
            });
            onClose?.();
          }}
        />
      )}
    </div>
  );
}
