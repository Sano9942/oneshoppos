// Thin re-export barrel — all tab components live in domain-specific files.
// Kept for backward-compat so existing `import { … } from "./ReportsInventory"` still works.

export { SalesStockTab, InventoryDumpTab, OnHandTab, StockValueTab } from "./ReportsInventoryCore";
export { ProductPerformanceTab, BrandWiseTab, MerchandisingWorkspaceTab } from "./ReportsInventoryAnalytics";
export { PricingMarginTab, DeadStockTab, StockAgingTab, ShrinkageTab } from "./ReportsInventoryHealth";
export { ReplenishmentTab, StockoutRiskTab, ForecastDemandTab, ReplenishmentSmartTab } from "./ReportsInventoryReplenishment";
