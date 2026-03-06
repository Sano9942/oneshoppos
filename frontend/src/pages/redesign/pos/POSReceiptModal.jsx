import React from "react";
import { CheckCircle2, X } from "lucide-react";
import { usePOS } from "./POSContext";
import { buildReceiptSections } from "../../../utils/receipt";

export default function POSReceiptModal() {
  const { slipOpen, setSlipOpen, slip, money, printSlip, receiptTemplate } = usePOS();

  const sections = slip ? buildReceiptSections(slip, receiptTemplate) : null;

  if (!slipOpen || !slip) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm flex flex-col border border-slate-100/20 max-h-[92vh]">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-3xl shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-500" />
            <h2 className="text-base font-bold text-slate-800">
              Sale Complete
            </h2>
          </div>
          <button
            onClick={() => setSlipOpen(false)}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200 transition"
          >
            <X size={17} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 font-mono text-sm space-y-3">
          <div className="text-center space-y-0.5">
            <p className="font-bold text-base">
              {sections.storeName}
            </p>
            <p className="text-xs text-slate-500">{slip.timestamp}</p>
            <p className="text-xs text-slate-500">
              Invoice:{" "}
              <span className="font-bold text-slate-700">
                {slip.invoiceNumber}
              </span>
            </p>
            {slip.returnedFrom && (
              <p className="text-xs text-slate-500">
                Exchange for:{" "}
                <span className="font-bold text-slate-700">{slip.returnedFrom}</span>
              </p>
            )}
            {slip.employee && (
              <p className="text-xs text-slate-500">
                Staff: {slip.employee.name}
              </p>
            )}
            {slip.customer && (
              <p className="text-xs text-emerald-700 font-semibold">
                Customer: {slip.customer.name}
                {slip.customer.mobile ? ` · ${slip.customer.mobile}` : ""}
              </p>
            )}
          </div>

          {/* Returned items section — only shown on exchange receipts */}
          {slip.returnedItems?.length > 0 && (
            <>
              <div className="border-t border-dashed border-slate-300" />
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Returned</p>
              <div className="space-y-1">
                {slip.returnedItems.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs text-rose-600">
                    <span className="flex-1 truncate">
                      {item.name} x{item.quantity}
                    </span>
                    <span className="ml-2">− {money(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-dashed border-slate-300" />
          {slip.returnedItems?.length > 0 && (
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">New Items</p>
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

          <div className="border-t border-dashed border-slate-300" />
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>
                {money(slip.cart.reduce((s, i) => s + i.price * i.quantity, 0))}
              </span>
            </div>
            {slip.taxAmount > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>GST (incl.)</span>
                <span>{money(slip.taxAmount)}</span>
              </div>
            )}
            {/* Exchange receipt: show return credit instead of generic discount */}
            {slip.exchangeCredit > 0 ? (
              <div className="flex justify-between text-rose-500">
                <span>Return Credit</span>
                <span>− {money(slip.exchangeCredit)}</span>
              </div>
            ) : slip.discountAmount > 0 && (
              <div className="flex justify-between text-red-500">
                <span>{slip.discountType === "percentage" ? `Discount (${slip.discountAmount}%)` : "Discount"}</span>
                <span>− {money(slip.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-sm pt-1 border-t border-slate-200">
              <span>{slip.returnedItems?.length > 0 ? "Balance Due" : "Total"}</span>
              <span>{money(slip.balanceDue != null ? Math.max(0, slip.balanceDue) : slip.total)}</span>
            </div>
            {slip.payments
              .filter((p) => p.method !== "Return Credit")
              .map((p, i) => (
                <div key={i} className="flex justify-between text-slate-600">
                  <span>{p.method}</span>
                  <span>{money(p.amount)}</span>
                </div>
              ))}
            {slip.refundNote && (
              <div className="flex justify-between text-rose-500 font-medium">
                <span>Refund to Customer</span>
                <span>{money(Math.abs(slip.balanceDue || 0))}</span>
              </div>
            )}
            {slip.change > 0 && (
              <div className="flex justify-between font-bold text-emerald-600">
                <span>Change</span>
                <span>{money(slip.change)}</span>
              </div>
            )}
          </div>
          {slip.orderNote && (
            <>
              <div className="border-t border-dashed border-slate-300" />
              <p className="text-center text-xs text-slate-500 italic">Note: {slip.orderNote}</p>
            </>
          )}
          {sections.showBarcode && (
            <>
              <div className="border-t border-dashed border-slate-300" />
              <p className="text-center text-xs tracking-widest text-slate-400 font-mono">
                {sections.invoiceNumber}
              </p>
            </>
          )}
          <div className="border-t border-dashed border-slate-300" />
          <p className="text-center text-xs text-slate-400">
            {sections.footerText}
          </p>
        </div>

        <div className="p-4 border-t border-slate-100 flex gap-3 shrink-0">
          <button
            onClick={() => setSlipOpen(false)}
            className="flex-1 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
          >
            Close
          </button>
          <button
            onClick={() => printSlip(slip)}
            className="flex-1 py-2.5 bg-[#8066FF] hover:bg-[#7055E6] text-white rounded-xl text-sm font-bold shadow transition"
          >
            Print Receipt
          </button>
        </div>
      </div>
    </div>
  );
}
