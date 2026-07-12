import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  BarChart3,
  TrendingUp,
  ShoppingBag,
  AlertTriangle,
  TrendingDown,
  Users,
  ClipboardList,
  Search,
  X,
  Package,
  Truck,
  Archive,
  RotateCcw,
  Layers,
  Tag,
  ArrowLeftRight,
  ShoppingCart,
  Star,
  Recycle,
  BarChart2,
  FileText,
  Clock,
  Building2,
  Wallet,
  Receipt,
  Calculator,
  ListChecks,
  Shield,
  GitBranch,
  LayoutGrid,
  Target,
  Activity,
  ShieldAlert,
  SearchCheck,
  BadgePercent,
  FileSpreadsheet,
  PackageX,
  Boxes,
  Globe,
  Stethoscope,
} from "lucide-react";

import { api } from "../api";
import { todayLocalStr } from "../utils/dates";
import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import { readContext } from "../auth/authStore";
import { useToast } from "../contexts/ToastContext";
import { usePreset } from "../contexts/PresetContext";
import {
  fmtDate,
  ExportButton,
  TableShell,
  DateRangeFilter,
  CardShell,
} from "./reports/ReportShared";
import {
  OverviewTab,
  SalesSummaryTab,
  SalesDetailTab,
  OrderWiseTab,
  ItemWiseTab,
  SubcategoryWiseTab,
  RefundsVoidsTab,
  CashierWiseTab,
  DailyOperationsTab,
  MonthlyMOPMatrixTab,
} from "./reports/ReportsSales";
import {
  SalesStockTab,
  InventoryDumpTab,
  ProductPerformanceTab,
  BrandWiseTab,
  MerchandisingWorkspaceTab,
  OnHandTab,
  ReplenishmentTab,
  PricingMarginTab,
  DeadStockTab,
  StockAgingTab,
  StockoutRiskTab,
  ForecastDemandTab,
  ReplenishmentSmartTab,
  ShrinkageTab,
} from "./reports/ReportsInventory";
import {
  InventoryLossTab,
  WastageTab,
  ProductMovementTab,
  STRReportTab,
  OutletComparisonTab,
} from "./reports/ReportsOperations";
import {
  SupplierWiseTab,
  TotalPurchasesTab,
  ItemwisePurchasesTab,
  POWorkflowTab,
  ProcurementParityTab,
  PurchaseOrdersReportTab,
  GRNReportTab,
} from "./reports/ReportsPurchasing";
import {
  SettlementOverviewTab,
  PayablesReceivablesTab,
  SupplierPaymentsInvoicesTab,
  FinancePaymentMixTab,
  GSTOutputTab,
  GSTTypeSummaryTab,
} from "./reports/ReportsFinance";
import ARAgingTab from "./reports/ARAgingTab";
import {
  AttendanceTab,
  LaborPerformanceTab,
  LaborVsSalesTab,
  StaffAttributionTab,
  LossPreventionTab,
} from "./reports/ReportsStaff";
import {
  ShiftSummaryTab,
  ShiftSalesTab,
  PaymentSummaryTab,
  CashFlowTab,
  CurrentSessionZReportTab,
  CashAuditTab,
  DenominationsTab,
} from "./reports/ReportsShifts";
import {
  CustomerDetailsTab,
  CustomerWiseTab,
  CustomerRFMTab,
  CustomerRetentionTab,
  CustomerCaptureRateTab,
} from "./reports/ReportsCustomers";
import {
  ComparativeTrendsTab,
  HeatmapsTab,
  RevenueLeaksTab,
  ProductMixTab,
  RetailMatrixTab,
} from "./reports/ReportsAnalytics";
import {
  CategoryWiseTab,
  ProductSpecTab,
  HistoryCostTab,
  HistorySaleTab,
  ProductAuditTab,
} from "./reports/ReportsCatalog";
import GovernanceTab from "./reports/ReportsGovernance";
import {
  DiscountLeakageTab,
  ExceptionsTab,
} from "./reports/ReportsAudit";
import FBRExportTab from "./reports/FBRExportTab";
import MultichannelTab from "./reports/ReportsMultichannel";
import CommissionSummaryTab from "./reports/ReportsCommissions";
import KdsAnalyticsTab from "./reports/KdsAnalyticsTab";
import MenuEngineeringTab from "./reports/MenuEngineeringTab";
import ClinicalTab from "./reports/ClinicalTab";

function GlobalFilterBar({ filters, setFilters, meta }) {
  const {
    outlets = [],
    categories = [],
    brands = [],
    suppliers = [],
    employees = [],
    shifts = [],
  } = meta;

  const [outletOpen, setOutletOpen] = useState(false);

  useEffect(() => {
    if (!outletOpen) return;
    const handler = (e) => {
      if (!e.target.closest("[data-outlet-popover]")) setOutletOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [outletOpen]);

  const handleReset = () => {
    setFilters({
      dateFrom: "",
      dateTo: "",
      timeFrom: "",
      timeTo: "",
      outletIds: [],
      employeeId: "",
      shiftId: "",
      categoryId: "",
      brandId: "",
      supplierId: "",
      search: "",
    });
  };

  const hasActiveFilters = Object.entries(filters).some(([k, v]) =>
    Array.isArray(v) ? v.length > 0 : !!v,
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3 sm:sticky sm:top-0 sm:z-10">
      {/* Search */}
      <div className="relative min-w-0 flex-1 basis-full md:basis-auto">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)"
        />
        <input
          type="text"
          placeholder="Global search..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="w-full pl-9 pr-3 py-2 border border-(--ui-border) rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/10 focus:border-(--ui-focus) transition-all font-medium"
        />
      </div>

      <div className="flex w-full items-center gap-2 rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-1.5 sm:w-auto">
        <Clock size={14} className="text-(--ui-text-muted)" />
        <input
          type="time"
          value={filters.timeFrom}
          onChange={(e) => setFilters({ ...filters, timeFrom: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 w-20"
          title="Time From"
        />
        <span className="text-(--ui-text-muted)">|</span>
        <input
          type="time"
          value={filters.timeTo}
          onChange={(e) => setFilters({ ...filters, timeTo: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 w-20"
          title="Time To"
        />
      </div>

      {/* Date Range */}
      <div className="flex w-full items-center gap-2 rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-1.5 sm:w-auto">
        <Clock size={14} className="text-(--ui-text-muted)" />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 w-28"
          title="Date From"
        />
        <span className="text-(--ui-text-muted)">|</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 w-28"
          title="Date To"
        />
      </div>

      {/* Outlet Multi-Select */}
      <div className="relative" data-outlet-popover>
        <button
          onClick={() => setOutletOpen((v) => !v)}
          className="flex items-center gap-2 rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-1.5 text-xs font-semibold text-(--ui-text) hover:bg-(--ui-muted-surface) sm:min-w-35"
        >
          <Building2 size={14} className="text-(--ui-text-muted) shrink-0" />
          <span className="truncate">
            {filters.outletIds.length === 0
              ? "All Outlets"
              : filters.outletIds.length === 1
                ? outlets.find((o) => o.id === filters.outletIds[0])?.name ?? "1 outlet"
                : `${filters.outletIds.length} outlets`}
          </span>
        </button>
        {outletOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-(--ui-border) bg-(--ui-surface) shadow-lg">
            <div className="flex items-center justify-between border-b border-(--ui-border) px-3 py-2">
              <button
                className="text-xs text-(--ui-link) hover:underline"
                onClick={() => setFilters({ ...filters, outletIds: outlets.map((o) => o.id) })}
              >
                Select All
              </button>
              <button
                className="text-xs text-(--ui-text-muted) hover:underline"
                onClick={() => setFilters({ ...filters, outletIds: [] })}
              >
                Clear
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {outlets.map((o) => (
                <label key={o.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-(--ui-muted-surface)">
                  <input
                    type="checkbox"
                    checked={filters.outletIds.includes(o.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...filters.outletIds, o.id]
                        : filters.outletIds.filter((id) => id !== o.id);
                      setFilters({ ...filters, outletIds: next });
                    }}
                    className="accent-(--ui-primary)"
                  />
                  <span className="text-xs font-medium text-(--ui-text)">{o.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Category Selector */}
      <div className="flex w-full items-center gap-2 rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-1.5 sm:min-w-35 sm:w-auto">
        <LayoutGrid size={14} className="text-(--ui-text-muted)" />
        <select
          value={filters.categoryId}
          onChange={(e) =>
            setFilters({ ...filters, categoryId: e.target.value })
          }
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path_label || c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Brand Selector */}
      <div className="flex w-full items-center gap-2 rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-1.5 sm:min-w-30 sm:w-auto">
        <Tag size={14} className="text-(--ui-text-muted)" />
        <select
          value={filters.brandId}
          onChange={(e) => setFilters({ ...filters, brandId: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex w-full items-center gap-2 rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-1.5 sm:min-w-35 sm:w-auto">
        <Truck size={14} className="text-(--ui-text-muted)" />
        <select
          value={filters.supplierId}
          onChange={(e) =>
            setFilters({ ...filters, supplierId: e.target.value })
          }
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Employee Selector */}
      <div className="flex w-full items-center gap-2 rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-1.5 sm:min-w-30 sm:w-auto">
        <Users size={14} className="text-(--ui-text-muted)" />
        <select
          value={filters.employeeId}
          onChange={(e) =>
            setFilters({ ...filters, employeeId: e.target.value })
          }
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Staff</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {/* Shift Selector */}
      <div className="flex w-full items-center gap-2 rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-1.5 sm:min-w-40 sm:w-auto">
        <ClipboardList size={14} className="text-(--ui-text-muted)" />
        <select
          value={filters.shiftId}
          onChange={(e) => setFilters({ ...filters, shiftId: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Shifts</option>
          {shifts.map((shift) => (
            <option key={shift.id} value={shift.id}>
              {`${shift.outlet_name || "Outlet"} | ${fmtDate(shift.start_time)} | #${shift.id}`}
            </option>
          ))}
        </select>
      </div>

      {/* Reset */}
      {hasActiveFilters && (
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 rounded-xl border border-(--ui-danger-bg) px-3 py-1.5 text-xs font-bold text-(--ui-danger-fg) transition-colors hover:bg-(--ui-danger-bg) sm:ml-auto"
        >
          <RotateCcw size={12} /> Reset
        </button>
      )}
    </div>
  );
}

// --- Main Reports Page --------------------------------------------------------

// ==============================================================================
// ADVANCED REPORTING TABS
// ==============================================================================

const GROUPS = [
  {
    label: "Sales",
    tabs: [
      { id: "overview", label: "Overview", icon: BarChart3 },
      { id: "daily-operations", label: "Daily Operations", icon: Activity },
      {
        id: "comparative-trends",
        label: "Comparative Trends",
        icon: TrendingUp,
      },
      { id: "heatmaps", label: "Sales Heatmap", icon: Clock },
      { id: "revenue-leaks", label: "Revenue Leaks", icon: AlertTriangle },
      { id: "product-mix", label: "Product Mix", icon: ShoppingBag },
      { id: "sales-summary", label: "Sales Summary", icon: BarChart2 },
      { id: "sales-detail", label: "Sales Detail", icon: FileText },
      { id: "order-wise", label: "Order Wise", icon: ClipboardList },
      { id: "item-wise", label: "Item Wise", icon: ShoppingBag },
      { id: "category-wise", label: "Category Wise", icon: Tag },
      { id: "subcategory-wise", label: "Sub-Category Wise", icon: Tag },
      { id: "monthly-mop-matrix", label: "Monthly MOP Matrix", icon: Calculator },
      { id: "cashier-wise", label: "Cashier Wise", icon: Users },
      { id: "refunds-voids", label: "Refunds & Voids", icon: AlertTriangle },
      { id: "shift-summary", label: "Shift Summary", icon: Wallet },
      { id: "shift-sales", label: "Shift Sales", icon: Receipt },
      { id: "payment-summary", label: "Payment Summary", icon: Calculator },
      { id: "cash-flow", label: "Cash Flow", icon: ListChecks },
      { id: "cash-audit", label: "Cash Audit", icon: Shield },
      { id: "denominations", label: "Denominations", icon: Layers },
      { id: "current-session-zreport", label: "Session Z-Report", icon: Shield },
    ],
  },
  {
    label: "Customers",
    tabs: [
      { id: "customer-details", label: "Customer Details", icon: Users },
      { id: "customer-wise", label: "Customer Wise", icon: TrendingUp },
      { id: "customer-rfm", label: "RFM Analysis", icon: GitBranch },
      { id: "customer-retention", label: "Customer Retention", icon: Users },
      { id: "customer-capture", label: "Capture Rate", icon: Target },
    ],
  },
  {
    label: "Inventory",
    tabs: [
      { id: "performance-workspace", label: "Merchandising", icon: Target },
      { id: "product-performance", label: "Product Performance", icon: Star },
      { id: "brand-wise", label: "Brand Wise", icon: Tag },
      { id: "retail-matrix", label: "Retail Matrix", icon: LayoutGrid },
      { id: "pricing-margin", label: "Pricing Matrix", icon: Layers },
      { id: "sales-stock", label: "Sales & Stock", icon: Package },
      { id: "inventory-dump", label: "Inventory Dump", icon: Archive },
      { id: "on-hand", label: "On Hand", icon: Layers },
      { id: "product-spec", label: "Product Spec", icon: Package },
      { id: "history-cost", label: "History Cost", icon: Receipt },
      { id: "history-sale", label: "History Sale", icon: FileText },
      { id: "product-audit", label: "Product Audit", icon: SearchCheck },
      { id: "replenishment", label: "Replenishment", icon: RotateCcw },
      { id: "dead-stock", label: "Dead Stock", icon: PackageX },
      { id: "stock-aging", label: "Stock Aging", icon: AlertTriangle },
      {
        id: "stockout-risk",
        label: "Stockout Risk",
        icon: TrendingDown,
        flag: "reports_inventory_health_plus",
      },
      { id: "forecast-demand", label: "Forecast Demand", icon: TrendingUp },
      {
        id: "replenishment-smart",
        label: "Replenishment Smart",
        icon: ShoppingCart,
        flag: "reports_inventory_health_plus",
      },
      { id: "shrinkage", label: "Shrinkage", icon: TrendingDown },
    ],
  },
  {
    label: "Operations",
    tabs: [
      { id: "outlet-comparison", label: "Outlet Comparison", icon: Building2 },
      { id: "inventory-loss", label: "Inventory Loss", icon: TrendingDown },
      { id: "wastage", label: "Wastage", icon: Recycle },
      {
        id: "product-movement",
        label: "Product Movement",
        icon: ArrowLeftRight,
      },
      { id: "str-report", label: "STR Report", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Procurement",
    tabs: [
      { id: "total-purchases", label: "Total Purchases", icon: Boxes },
      { id: "itemwise-purchases", label: "Itemwise Purchases", icon: ClipboardList },
      { id: "po-workflow", label: "PO Workflow", icon: ListChecks },
      { id: "procurement-parity", label: "Procurement Parity", icon: ArrowLeftRight },
      { id: "supplier-wise", label: "Supplier Wise", icon: Truck },
      {
        id: "purchase-orders-report",
        label: "Purchase Orders",
        icon: ShoppingCart,
      },
      { id: "grn-report", label: "GRN Report", icon: Archive },
    ],
  },
  {
    label: "Finance",
    tabs: [
      { id: "settlement-overview", label: "Settlement Overview", icon: Wallet },
      { id: "payables-receivables", label: "Payables / Receivables", icon: Receipt },
      { id: "ar-aging", label: "A/R Aging", icon: Receipt },
      { id: "supplier-payments-invoices", label: "Supplier Payments", icon: Truck },
      { id: "finance-payment-mix", label: "Finance Payment Mix", icon: Calculator },
      { id: "gst-output", label: "GST Output", icon: BadgePercent },
      { id: "gst-type-summary", label: "GST Type", icon: FileSpreadsheet },
      { id: "fbr-export", label: "FBR Export", icon: FileSpreadsheet, flag: "fbr_integration" },
    ],
  },
  {
    label: "HR",
    tabs: [
      { id: "attendance", label: "Attendance", icon: Clock },
      { id: "labor-performance", label: "Labor Performance", icon: Activity },
      { id: "labor-vs-sales", label: "Labor vs Sales", icon: Activity },
      { id: "staff-attribution", label: "Staff Attribution", icon: Activity },
      { id: "loss-prevention", label: "Loss Prevention", icon: ShieldAlert },
      { id: "commission-summary", label: "Commission Summary", icon: Activity },
    ],
  },
  {
    label: "Governance",
    tabs: [
      { id: "governance", label: "Audit Controls", icon: ShieldAlert },
      { id: "discount-leakage", label: "Discount Leakage", icon: AlertTriangle },
      { id: "exceptions", label: "Exceptions", icon: SearchCheck },
    ],
  },
  {
    label: "Multi-Channel",
    tabs: [
      { id: "multichannel", label: "Multi-Channel", icon: Globe },
    ],
  },
  {
    label: "Restaurant",
    mode: "restaurant",
    tabs: [
      { id: "kds-analytics", label: "KDS Analytics", icon: Activity, flag: "phase4_restaurant_kds_analytics" },
      { id: "menu-engineering", label: "Menu Engineering", icon: LayoutGrid, flag: "phase4_restaurant_menu_engineering" },
    ],
  },
  {
    label: "Clinical",
    mode: "treatment_plans",
    tabs: [
      { id: "clinical", label: "Clinical Overview", icon: Stethoscope, flag: "phase4_treatment_plans" },
    ],
  },
];

// D4 split (PLAN-V2 Step 4, REPORT-PERMS.md §4) — per-tab required permission,
// mirroring each tab's backend route guard exactly so a token that lacks the
// class never sees a tab it would 403 on. Value is a single perm or an any-of
// array (hasPerm accepts both). Unmapped tab ids fall through as visible (no
// tab-level gate) — matches pre-split behavior for anything added later.
const TAB_PERMS = {
  // Sales / shifts / POS-operational → view_sales_reports
  overview: "view_sales_reports",
  "daily-operations": "view_sales_reports",
  "comparative-trends": "view_sales_reports",
  heatmaps: "view_sales_reports",
  "revenue-leaks": "view_sales_reports",
  "product-mix": "view_sales_reports",
  "sales-summary": "view_sales_reports",
  "sales-detail": "view_sales_reports",
  "order-wise": "view_sales_reports",
  "item-wise": "view_sales_reports",
  "category-wise": "view_sales_reports",
  "subcategory-wise": "view_sales_reports",
  "monthly-mop-matrix": "view_sales_reports",
  "cashier-wise": "view_sales_reports",
  "refunds-voids": "view_sales_reports",
  "shift-summary": "view_sales_reports",
  "shift-sales": "view_sales_reports",
  "payment-summary": "view_sales_reports",
  "cash-flow": "view_sales_reports",
  "cash-audit": "view_sales_reports",
  denominations: "view_sales_reports",
  "current-session-zreport": "view_sales_reports",
  multichannel: "view_sales_reports",
  "kds-analytics": "view_sales_reports",
  // Customers → view_customer_reports (customer-wise lives in the sales route)
  "customer-details": "view_customer_reports",
  "customer-wise": ["view_customer_reports", "view_sales_reports"],
  "customer-rfm": "view_customer_reports",
  "customer-retention": "view_customer_reports",
  "customer-capture": "view_customer_reports",
  clinical: ["view_customer_reports", "manage_treatment_plans"],
  // Inventory → view_inventory_reports (with margin/sales exceptions)
  "performance-workspace": "view_sales_reports",
  "product-performance": "view_sales_reports",
  "brand-wise": "view_sales_reports",
  "retail-matrix": "view_financial_reports",
  "pricing-margin": "view_financial_reports",
  "sales-stock": "view_inventory_reports",
  "inventory-dump": "view_inventory_reports",
  "on-hand": "view_inventory_reports",
  "product-spec": "view_inventory_reports",
  "history-cost": "view_inventory_reports",
  "history-sale": "view_inventory_reports",
  "product-audit": "view_inventory_reports",
  replenishment: "view_inventory_reports",
  "dead-stock": "view_inventory_reports",
  "stock-aging": "view_inventory_reports",
  "stockout-risk": "view_inventory_reports",
  "forecast-demand": "view_inventory_reports",
  "replenishment-smart": "view_inventory_reports",
  shrinkage: "view_inventory_reports",
  "inventory-loss": "view_inventory_reports",
  wastage: "view_inventory_reports",
  "product-movement": "view_inventory_reports",
  "str-report": "view_inventory_reports",
  "grn-report": "view_inventory_reports",
  "outlet-comparison": "view_sales_reports",
  // Procurement / finance → view_financial_reports
  "total-purchases": "view_financial_reports",
  "itemwise-purchases": "view_financial_reports",
  "po-workflow": "view_financial_reports",
  "procurement-parity": "view_financial_reports",
  "purchase-orders-report": "view_financial_reports",
  "supplier-wise": "view_sales_reports",
  "settlement-overview": "view_financial_reports",
  "payables-receivables": "view_financial_reports",
  "ar-aging": "view_financial_reports",
  "supplier-payments-invoices": "view_financial_reports",
  "finance-payment-mix": "view_financial_reports",
  "gst-output": "view_financial_reports",
  "gst-type-summary": "view_financial_reports",
  "fbr-export": "all_access",
  "menu-engineering": "view_financial_reports",
  // Staff / HR → view_hr_reports
  attendance: "view_hr_reports",
  "labor-performance": "view_hr_reports",
  "labor-vs-sales": "view_hr_reports",
  "staff-attribution": "view_hr_reports",
  "loss-prevention": "view_hr_reports",
  "commission-summary": "view_hr_reports",
  // Governance / audit
  governance: "manage_reports",
  "discount-leakage": "view_sales_reports",
  exceptions: "view_financial_reports",
};

function TabBreadcrumb({ activeTab }) {
  for (const group of GROUPS) {
    const tab = group.tabs.find((t) => t.id === activeTab);
    if (!tab) continue;
    const GroupIcon = group.tabs[0].icon;
    const TabIcon = tab.icon;
    return (
      <div className="flex items-center gap-2 text-xs text-(--ui-text-muted) mb-4 shrink-0">
        <GroupIcon size={13} className="text-(--ui-text-muted)" />
        <span className="font-medium text-(--ui-text-muted)">{group.label}</span>
        <span className="text-(--ui-text-muted)">/</span>
        <TabIcon size={13} className="text-(--ui-link)" />
        <span className="font-semibold text-(--ui-text)">{tab.label}</span>
      </div>
    );
  }
  return null;
}

function TabContent({ activeTab, filters, setFilters, setActiveTab }) {
  switch (activeTab) {
    case "comparative-trends":
      return <ComparativeTrendsTab filters={filters} />;
    case "heatmaps":
      return <HeatmapsTab filters={filters} />;
    case "revenue-leaks":
      return <RevenueLeaksTab filters={filters} />;
    case "product-mix":
      return <ProductMixTab filters={filters} />;
    case "retail-matrix":
      return <RetailMatrixTab filters={filters} />;
    case "customer-retention":
      return <CustomerRetentionTab filters={filters} />;
    case "customer-capture":
      return <CustomerCaptureRateTab filters={filters} />;
    case "labor-performance":
      return <LaborPerformanceTab filters={filters} />;
    case "loss-prevention":
      return <LossPreventionTab filters={filters} />;
    case "labor-vs-sales":
      return <LaborVsSalesTab filters={filters} />;
    case "staff-attribution":
      return <StaffAttributionTab filters={filters} />;
    case "commission-summary":
      return <CommissionSummaryTab filters={filters} />;
    case "overview":
      return <OverviewTab filters={filters} />;
    case "daily-operations":
      return <DailyOperationsTab filters={filters} />;
    case "sales-summary":
      return <SalesSummaryTab filters={filters} />;
    case "sales-detail":
      return <SalesDetailTab filters={filters} />;
    case "refunds-voids":
      return <RefundsVoidsTab filters={filters} />;
    case "shift-summary":
      return <ShiftSummaryTab filters={filters} />;
    case "shift-sales":
      return <ShiftSalesTab filters={filters} />;
    case "payment-summary":
      return <PaymentSummaryTab filters={filters} />;
    case "cash-flow":
      return <CashFlowTab filters={filters} />;
    case "cash-audit":
      return <CashAuditTab filters={filters} />;
    case "denominations":
      return <DenominationsTab filters={filters} />;
    case "current-session-zreport":
      return <CurrentSessionZReportTab filters={filters} />;
    case "sales-stock":
      return <SalesStockTab filters={filters} />;
    case "inventory-dump":
      return <InventoryDumpTab filters={filters} />;
    case "category-wise":
      return <CategoryWiseTab filters={filters} />;
    case "customer-details":
      return <CustomerDetailsTab filters={filters} />;
    case "customer-wise":
      return <CustomerWiseTab filters={filters} />;
    case "customer-rfm":
      return <CustomerRFMTab filters={filters} />;
    case "outlet-comparison":
      return <OutletComparisonTab filters={filters} />;
    case "order-wise":
      return <OrderWiseTab filters={filters} />;
    case "item-wise":
      return <ItemWiseTab filters={filters} />;
    case "subcategory-wise":
      return <SubcategoryWiseTab filters={filters} />;
    case "monthly-mop-matrix":
      return <MonthlyMOPMatrixTab filters={filters} />;
    case "cashier-wise":
      return <CashierWiseTab filters={filters} />;
    case "product-performance":
      return <ProductPerformanceTab filters={filters} />;
    case "performance-workspace":
      return (
        <MerchandisingWorkspaceTab
          filters={filters}
          setFilters={setFilters}
          setActiveTab={setActiveTab}
        />
      );
    case "brand-wise":
      return <BrandWiseTab filters={filters} />;
    case "product-spec":
      return <ProductSpecTab filters={filters} />;
    case "history-cost":
      return <HistoryCostTab filters={filters} />;
    case "history-sale":
      return <HistorySaleTab filters={filters} />;
    case "product-audit":
      return <ProductAuditTab filters={filters} />;
    case "on-hand":
      return <OnHandTab filters={filters} />;
    case "inventory-loss":
      return <InventoryLossTab filters={filters} />;
    case "wastage":
      return <WastageTab filters={filters} />;
    case "product-movement":
      return <ProductMovementTab filters={filters} />;
    case "str-report":
      return <STRReportTab filters={filters} />;
    case "replenishment":
      return <ReplenishmentTab filters={filters} />;
    case "dead-stock":
      return <DeadStockTab filters={filters} />;
    case "stock-aging":
      return <StockAgingTab filters={filters} />;
    case "stockout-risk":
      return <StockoutRiskTab filters={filters} />;
    case "forecast-demand":
      return <ForecastDemandTab filters={filters} />;
    case "replenishment-smart":
      return <ReplenishmentSmartTab filters={filters} />;
    case "shrinkage":
      return <ShrinkageTab filters={filters} />;
    case "supplier-wise":
      return <SupplierWiseTab filters={filters} />;
    case "total-purchases":
      return <TotalPurchasesTab filters={filters} />;
    case "itemwise-purchases":
      return <ItemwisePurchasesTab filters={filters} />;
    case "po-workflow":
      return <POWorkflowTab filters={filters} />;
    case "procurement-parity":
      return <ProcurementParityTab filters={filters} />;
    case "purchase-orders-report":
      return <PurchaseOrdersReportTab filters={filters} />;
    case "grn-report":
      return <GRNReportTab filters={filters} />;
    case "settlement-overview":
      return <SettlementOverviewTab filters={filters} />;
    case "payables-receivables":
      return <PayablesReceivablesTab filters={filters} />;
    case "ar-aging":
      return <ARAgingTab filters={filters} />;
    case "supplier-payments-invoices":
      return <SupplierPaymentsInvoicesTab filters={filters} />;
    case "finance-payment-mix":
      return <FinancePaymentMixTab filters={filters} />;
    case "gst-output":
      return <GSTOutputTab filters={filters} />;
    case "gst-type-summary":
      return <GSTTypeSummaryTab filters={filters} />;
    case "pricing-margin":
      return <PricingMarginTab filters={filters} />;
    case "attendance":
      return <AttendanceTab filters={filters} />;
    case "governance":
      return <GovernanceTab filters={filters} />;
    case "discount-leakage":
      return <DiscountLeakageTab filters={filters} />;
    case "exceptions":
      return <ExceptionsTab filters={filters} />;
    case "fbr-export":
      return <FBRExportTab />;
    case "multichannel":
      return <MultichannelTab filters={filters} />;
    case "kds-analytics":
      return <KdsAnalyticsTab />;
    case "menu-engineering":
      return <MenuEngineeringTab />;
    case "clinical":
      return <ClinicalTab />;
    default:
      return null;
  }
}

export function ReportTabStandalone({ tabId }) {
  const { authHeaders, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);

  // Inline self-guard (Business Modules): flag-gated tabs (registry `flag`
  // field in GROUPS) must not render via deep link with the flag off — the
  // backend 403s anyway, but the page shouldn't paint at all.
  const registryTab = GROUPS.flatMap((g) => g.tabs).find((t) => t.id === tabId);
  if (registryTab?.flag) {
    if (flagsLoading) return null;
    if (!flags[registryTab.flag]) return <Navigate to="/" replace />;
  }
  // D4 split (Step 4): same guard for the tab's data-class permission on the
  // deep-link path — don't paint a tab the API will 403.
  if (TAB_PERMS[tabId] && !hasPerm(TAB_PERMS[tabId])) {
    return <Navigate to="/" replace />;
  }

  const standaloneFilters = {
    dateFrom: "",
    dateTo: "",
    timeFrom: "",
    timeTo: "",
    outletIds: [],
    employeeId: "",
    shiftId: "",
    categoryId: "",
    brandId: "",
    supplierId: "",
    search: "",
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent">
      <div className="flex-1 overflow-auto min-h-0">
        <TabContent
          activeTab={tabId}
          filters={standaloneFilters}
          setFilters={() => {}}
          setActiveTab={() => {}}
        />
      </div>
    </div>
  );
}

// Maps dashboard URL shorthand → actual tab IDs
const TAB_ALIASES = {
  sales: "sales-summary",
  finance: "profit-loss",
  governance: "governance",
  inventory: "inventory-dump",
  analytics: "heatmaps",
};

export default function Reports() {
  const { isBootstrapping, authHeaders, hasPerm } = useAuth();
  const toast = useToast();
  const { visible_report_groups, hasMode } = usePreset();
  const { flags } = useFeatureFlags(authHeaders);
  // Filter groups for sidebar — null = show all, array = show only listed groups.
  // A group with a `mode` is vertical-specific (Restaurant, Clinical): only show
  // it when the tenant runs that mode, so null-group retailers stop inheriting
  // F&B / clinical analytics they never enabled.
  const presetGroups = (visible_report_groups
    ? GROUPS.filter((g) => visible_report_groups.includes(g.label))
    : GROUPS
  ).filter((g) => !g.mode || hasMode(g.mode));
  // Drop tabs the caller can't see: feature-flagged tabs whose flag is off
  // (e.g. reports_inventory_health_plus premium tabs) AND — D4 split (Step 4) —
  // tabs whose data-class permission the caller lacks, so a sales-only Cashier
  // sees only sales tabs instead of a wall of 403s. Then drop empty groups.
  const sidebarGroups = presetGroups
    .map((g) => ({
      ...g,
      tabs: g.tabs.filter(
        (t) =>
          (!t.flag || flags?.[t.flag]) &&
          (!TAB_PERMS[t.id] || hasPerm(TAB_PERMS[t.id])),
      ),
    }))
    .filter((g) => g.tabs.length > 0);
  const _ctx = readContext();
  const ctxOutletIdNum = _ctx?.active_outlet_id && _ctx?.scope_mode !== "all_branches"
    ? Number(_ctx.active_outlet_id)
    : null;
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get("tab");
    return (tab && TAB_ALIASES[tab]) || tab || "overview";
  });
  const didApplyParams = useRef(false);
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    timeFrom: "",
    timeTo: "",
    outletIds: ctxOutletIdNum ? [ctxOutletIdNum] : [],
    employeeId: "",
    shiftId: "",
    categoryId: "",
    brandId: "",
    supplierId: "",
    search: "",
  });

  const [meta, setMeta] = useState({
    outlets: [],
    categories: [],
    brands: [],
    suppliers: [],
    employees: [],
    shifts: [],
  });

  useEffect(() => {
    if (isBootstrapping) return;
    // Basic meta loader for dropdowns — use allSettled so one 403 doesn't kill all filters
    const loadMeta = async () => {
      try {
        const results = await Promise.allSettled([
          api.get("/api/outlets"),
          api.get("/api/categories"),
          api.get("/api/brands"),
          api.get("/api/suppliers"),
          api.get("/api/employees").catch(() => ({ employees: [] })),
          api.get("/api/reports/cash-flow", {
            date_from: filters.dateFrom,
            date_to: filters.dateTo,
          }),
        ]);
        const val = (i, fallback = []) => results[i].status === "fulfilled" ? results[i].value : fallback;
        const outlets = val(0, { outlets: [] });
        const categories = val(1, { categories: [] });
        const brands = val(2, { brands: [] });
        const suppliers = val(3, { suppliers: [] });
        const employees = val(4, { employees: [] });
        const cashFlow = val(5, { sessions: [] });
        setMeta({
          outlets: outlets.outlets || outlets || [],
          categories: categories.categories || categories || [],
          brands: brands.brands || brands || [],
          suppliers: suppliers.suppliers || suppliers || [],
          employees: employees.employees || employees || [],
          shifts: (cashFlow.sessions || []).filter((session) =>
            filters.outletIds.length
              ? filters.outletIds.includes(Number(session.outlet_id))
              : true,
          ),
        });
      } catch (err) {
        console.error("Failed to load metadata", err);
        toast.error(`Failed to load reports metadata — ${err.message || "Unknown error"}`);
      }
    };
    loadMeta();
  }, [isBootstrapping, filters.outletIds, filters.dateFrom, filters.dateTo, toast]);

  // Apply URL params once after meta loads (need outlet list to validate outlet_id)
  useEffect(() => {
    if (didApplyParams.current) return;
    const outletId = searchParams.get("outlet_id");
    const date = searchParams.get("date");
    if (outletId) {
      setFilters((f) => ({ ...f, outletIds: [Number(outletId)] }));
    }
    if (date === "today") {
      const today = todayLocalStr();
      setFilters((f) => ({ ...f, dateFrom: today, dateTo: today }));
    }
    didApplyParams.current = true;
  }, [searchParams]);

  const activeGroup = sidebarGroups.find((g) =>
    g.tabs.some((t) => t.id === activeTab),
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-(--ui-text) mb-1">
            Reports
          </h1>
          <p className="text-(--ui-text-muted)">
            {sidebarGroups.reduce((n, g) => n + g.tabs.length, 0)} reports across
            {sidebarGroups.map((g) => g.label.toLowerCase()).join(", ")}.
          </p>
        </div>
      </div>

      {/* Global Filter Bar */}
      <GlobalFilterBar filters={filters} setFilters={setFilters} meta={meta} />

      {/* Two-panel layout: group sidebar + sub-tabs + content */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-0">
        {/* Left: group icon sidebar */}
        <div className="flex shrink-0 gap-1 overflow-x-auto py-1 lg:w-18 lg:flex-col lg:overflow-visible lg:border-r lg:border-(--ui-border) lg:pr-2">
          {sidebarGroups.map((group) => {
            const isActive = group === activeGroup;
            const GroupIcon = group.tabs[0].icon;
            return (
              <button
                key={group.label}
                onClick={() => setActiveTab(group.tabs[0].id)}
                title={group.label}
                className={`flex min-w-20 flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs font-medium transition-all lg:min-w-0 ${
                  isActive
                    ? "bg-(--ui-muted-surface) text-(--ui-link)"
                    : "text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-muted-surface)"
                }`}
              >
                <GroupIcon size={18} />
                <span className="text-[10px] leading-tight text-center">
                  {group.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: sub-tab strip + content */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 lg:pl-4">
          {/* Sub-tab pill strip for the active group */}
          {activeGroup && (
            <div className="flex w-full flex-wrap gap-1 rounded-xl bg-(--ui-muted-surface) p-1">
              {activeGroup.tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                    activeTab === id
                      ? "bg-(--ui-surface) text-(--ui-text)"
                      : "text-(--ui-text-muted) hover:text-(--ui-text)"
                  }`}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 overflow-auto min-h-0 flex flex-col">
            <TabBreadcrumb activeTab={activeTab} />
            <div className="flex-1 min-h-0">
              <TabContent
                activeTab={activeTab}
                filters={filters}
                setFilters={setFilters}
                setActiveTab={setActiveTab}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
