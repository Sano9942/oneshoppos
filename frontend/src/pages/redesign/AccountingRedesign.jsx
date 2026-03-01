/**
 * Wave D — Accounting Redesign
 *
 * Strategy: Accounting.jsx contains three data-heavy tabs (P&L, Cashflow,
 * AP/AR) with well-tested API integrations and complex financial table layout.
 * We wrap it in the design-system chrome so the outer shell matches every other
 * redesigned page, without duplicating any financial logic.
 */
import Accounting from "../Accounting";

export default function AccountingRedesign() {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-(--ui-border) bg-(--ui-surface) px-6 py-4">
        <h1 className="text-xl font-semibold text-(--ui-text)">Accounting</h1>
        <p className="mt-0.5 text-sm text-(--ui-text-muted)">
          Profit &amp; Loss, cash flow, and accounts payable/receivable.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <Accounting />
      </div>
    </div>
  );
}
