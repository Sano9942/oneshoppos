import React, { useState } from "react";
import { CheckCircle2, Mail, MessageCircle, X } from "lucide-react";
import { usePOS } from "./POSContext";
import { buildReceiptSections, formatPaymentMethodLabel } from "../../../utils/receipt";
import { buildWhatsAppShareUrl } from "../../../utils/publicReceipt";
import POSEmailReceiptModal from "./POSEmailReceiptModal";

export default function POSReceiptModal() {
  const { slipOpen, setSlipOpen, slip, money, printSlip, receiptTemplate, currencySymbol, presetLabels } = usePOS();

  const [showEmailModal, setShowEmailModal] = useState(false);

  const sections = slip ? buildReceiptSections(slip, receiptTemplate, currencySymbol) : null;

  function shareWhatsApp() {
    const total = money(slip.balanceDue != null ? Math.max(0, slip.balanceDue) : slip.total);
    const url = buildWhatsAppShareUrl({
      invoiceNumber: slip.invoiceNumber,
      totalLabel: total,
      outletName: slip.outlet?.name,
      // sections.storeName falls back to template.header_text, which is a
      // print-format greeting (e.g. "Thank you for shopping!") — only used
      // here as a tertiary fallback when outlet name is missing.
      fallbackName: sections.storeName,
    });
    window.open(url, "_blank");
  }

  if (!slipOpen || !slip) return null;

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-(--ui-surface) rounded-3xl shadow-(--ui-shadow-lg) w-full max-w-sm flex flex-col border border-(--ui-border) max-h-[92vh]">
        <div className="px-5 py-4 border-b border-(--ui-border) flex items-center justify-between bg-(--ui-muted-surface) rounded-t-3xl shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-(--ui-success-fg)" />
            <h2 className="text-base font-bold text-(--ui-text)">
              Sale Complete
            </h2>
          </div>
          <button
            onClick={() => setSlipOpen(false)}
            className="text-(--ui-text-muted) hover:text-(--ui-text) p-1.5 rounded-full hover:bg-(--ui-border-strong) transition"
          >
            <X size={17} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 font-mono text-sm space-y-3">
          <div className="text-center space-y-0.5">
            <p className="font-bold text-base">
              {sections.storeName}
            </p>
            <p className="text-xs text-(--ui-text-muted)">{slip.timestamp}</p>
            <p className="text-xs text-(--ui-text-muted)">
              Invoice:{" "}
              <span className="font-bold text-(--ui-text)">
                {slip.invoiceNumber}
              </span>
            </p>
            {slip.returnedFrom && (
              <p className="text-xs text-(--ui-text-muted)">
                Exchange for:{" "}
                <span className="font-bold text-(--ui-text)">{slip.returnedFrom}</span>
              </p>
            )}
            {slip.employee && (
              <p className="text-xs text-(--ui-text-muted)">
                Staff: {slip.employee.name}
              </p>
            )}
            {slip.customer && (
              <p className="text-xs text-(--ui-success-fg) font-semibold">
                {presetLabels?.customer || "Customer"}: {slip.customer.name}
                {slip.customer.mobile ? ` · ${slip.customer.mobile}` : ""}
              </p>
            )}
          </div>

          {/* Returned items section — only shown on exchange receipts */}
          {slip.returnedItems?.length > 0 && (
            <>
              <div className="border-t border-dashed border-(--ui-border-strong)" />
              <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide">Returned</p>
              <div className="space-y-1">
                {slip.returnedItems.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs text-(--ui-danger-fg)">
                    <span className="flex-1 truncate">
                      {item.name} x{item.quantity}
                    </span>
                    <span className="ml-2">− {money(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-dashed border-(--ui-border-strong)" />
          {slip.returnedItems?.length > 0 && (
            <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide">New Items</p>
          )}
          <div className="space-y-1">
            {slip.cart.map((item, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="flex-1 truncate">
                  {item.name} x{item.quantity}
                </span>
                <span className="ml-2 font-semibold">
                  {money(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-(--ui-border-strong)" />
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>
                {money(slip.cart.reduce((s, i) => s + i.price * i.quantity, 0))}
              </span>
            </div>
            {slip.taxAmount > 0 && (
              <div className="flex justify-between text-(--ui-text-muted)">
                <span>GST (incl.)</span>
                <span>{money(slip.taxAmount)}</span>
              </div>
            )}
            {/* Exchange receipt: show return credit instead of generic discount */}
            {slip.exchangeCredit > 0 ? (
              <>
                <div className="flex justify-between text-(--ui-danger-fg)">
                  <span>Return Credit</span>
                  <span>− {money(slip.exchangeCredit)}</span>
                </div>
                {slip.exchangeDiscount > 0 && (
                  <div className="flex justify-between text-(--ui-danger-fg)">
                    <span>Discount</span>
                    <span>− {money(slip.exchangeDiscount)}</span>
                  </div>
                )}
              </>
            ) : slip.discountAmount > 0 && (
              <div className="flex justify-between text-(--ui-danger-fg)">
                <span>{slip.discountType === "percent" ? `Discount (${slip.discountInput}%)` : "Discount"}</span>
                <span>− {money(slip.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-sm pt-1 border-t border-(--ui-border-strong)">
              <span>{slip.returnedItems?.length > 0 ? "Balance Due" : "Total"}</span>
              <span>{money(slip.balanceDue != null ? Math.max(0, slip.balanceDue) : slip.total)}</span>
            </div>
            {slip.payments
              .filter((p) => p.method !== "Return Credit")
              .map((p, i) => (
                <div key={i} className="flex justify-between text-(--ui-text-muted)">
                  <span>{formatPaymentMethodLabel(p.method)}</span>
                  <span>{money(p.amount)}</span>
                </div>
              ))}
            {slip.refundNote && (
              <div className="flex justify-between text-(--ui-danger-fg) font-medium">
                <span>Refund to Customer</span>
                <span>{money(Math.abs(slip.balanceDue || 0))}</span>
              </div>
            )}
            {slip.change > 0 && (
              <div className="flex justify-between font-bold text-(--ui-success-fg)">
                <span>Change</span>
                <span>{money(slip.change)}</span>
              </div>
            )}
          </div>
          {/* Phase 2-G Wave 2 (2-G.2) — codes generated on this sale. */}
          {Array.isArray(slip.issuedGiftCards) && slip.issuedGiftCards.length > 0 && (
            <>
              <div className="border-t border-dashed border-(--ui-border-strong)" />
              <p className="text-xs font-bold text-(--ui-success-fg) uppercase tracking-wide">
                Gift Cards Issued
              </p>
              <div className="space-y-1">
                {slip.issuedGiftCards.map((gc) => (
                  <div
                    key={gc.id || gc.code}
                    className="flex justify-between items-center text-xs bg-(--ui-success-bg) border border-(--ui-success-fg)/30 rounded-md px-2 py-1.5"
                  >
                    <span className="font-mono font-bold tracking-widest text-(--ui-success-fg)">
                      {gc.code}
                    </span>
                    <span className="font-semibold text-(--ui-success-fg)">
                      {money(gc.initial_value)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-(--ui-text-muted) text-center">
                Keep the code safe — it's required at checkout to redeem.
              </p>
            </>
          )}
          {/* Tier 0.1 wholesale — A/R details for on-account sales. Shows the
              auto-generated customer_invoice number + due date so the buyer
              knows their reference and when payment is due. */}
          {slip.arInvoice && (
            <>
              <div className="border-t border-dashed border-(--ui-border-strong)" />
              <div className="bg-(--ui-muted-surface) border border-(--ui-border-strong) rounded-lg px-2.5 py-2 space-y-1">
                <p className="text-[10px] font-bold text-(--ui-text) uppercase tracking-wide">
                  On Account
                </p>
                <div className="flex justify-between text-xs">
                  <span className="text-(--ui-text-muted)">A/R Invoice</span>
                  <span className="font-mono font-bold text-(--ui-text)">
                    {slip.arInvoice.invoice_number}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-(--ui-text-muted)">Due Date</span>
                  <span className="font-semibold text-(--ui-text)">
                    {slip.arInvoice.due_date
                      ? new Date(slip.arInvoice.due_date).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                    {slip.arInvoice.payment_terms_days > 0 && (
                      <span className="text-(--ui-text-muted) ml-1">
                        (Net {slip.arInvoice.payment_terms_days})
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </>
          )}
          {slip.orderNote && (
            <>
              <div className="border-t border-dashed border-(--ui-border-strong)" />
              <p className="text-center text-xs text-(--ui-text-muted) italic">Note: {slip.orderNote}</p>
            </>
          )}
          {sections.showBarcode && (
            <>
              <div className="border-t border-dashed border-(--ui-border-strong)" />
              <p className="text-center text-xs tracking-widest text-(--ui-text-muted) font-mono">
                {sections.invoiceNumber}
              </p>
            </>
          )}
          <div className="border-t border-dashed border-(--ui-border-strong)" />
          <p className="text-center text-xs text-(--ui-text-muted)">
            {sections.footerText}
          </p>
        </div>

        <div className="p-4 border-t border-(--ui-border) flex gap-3 shrink-0">
          <button
            onClick={() => setSlipOpen(false)}
            className="flex-1 py-2.5 border-2 border-(--ui-border-strong) rounded-xl text-sm font-bold text-(--ui-text-muted) hover:bg-(--ui-muted-surface) transition"
          >
            Close
          </button>
          <button
            onClick={() => setShowEmailModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-(--ui-border-strong) text-(--ui-text) hover:bg-(--ui-muted-surface) text-sm font-medium"
          >
            <Mail size={14} /> Email
          </button>
          <button
            onClick={shareWhatsApp}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-(--ui-border-strong) text-(--ui-text) hover:bg-(--ui-muted-surface) text-sm font-medium"
          >
            <MessageCircle size={14} /> WhatsApp
          </button>
          <button
            onClick={() => printSlip(slip)}
            className="flex-1 py-2.5 bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white rounded-xl text-sm font-bold transition"
          >
            Print
          </button>
        </div>
      </div>
      {showEmailModal && slip?.saleId && (
        <POSEmailReceiptModal
          saleId={slip.saleId}
          customerEmail={slip.customer?.email || ""}
          onClose={() => setShowEmailModal(false)}
        />
      )}
    </div>
  );
}
