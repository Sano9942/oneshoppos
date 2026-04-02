// Thin re-export barrel — all tab components live in domain-specific files.
// Kept for backward-compat so existing `import { … } from "./ReportsSales"` still works.

export { OverviewTab } from "./ReportsSalesOverview";
export { SalesSummaryTab, MonthlyMOPMatrixTab, SubcategoryWiseTab } from "./ReportsSalesCore";
export { SalesDetailTab, OrderWiseTab, ItemWiseTab } from "./ReportsSalesDetail";
export { RefundsVoidsTab, CashierWiseTab, DailyOperationsTab } from "./ReportsSalesOperations";
