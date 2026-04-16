import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
} from "lucide-react";

import { api } from "../api";
import { useAuth } from "../auth/AuthProvider";
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
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:sticky sm:top-0 sm:z-10">
      {/* Search */}
      <div className="relative min-w-0 flex-1 basis-full md:basis-auto">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          placeholder="Global search..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium"
        />
      </div>

      <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 sm:w-auto">
        <Clock size={14} className="text-slate-400" />
        <input
          type="time"
          value={filters.timeFrom}
          onChange={(e) => setFilters({ ...filters, timeFrom: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 w-20"
          title="Time From"
        />
        <span className="text-slate-300">|</span>
        <input
          type="time"
          value={filters.timeTo}
          onChange={(e) => setFilters({ ...filters, timeTo: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 w-20"
          title="Time To"
        />
      </div>

      {/* Date Range */}
      <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 sm:w-auto">
        <Clock size={14} className="text-slate-400" />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 w-28"
          title="Date From"
        />
        <span className="text-slate-300">|</span>
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
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-w-35"
        >
          <Building2 size={14} className="text-slate-400 shrink-0" />
          <span className="truncate">
            {filters.outletIds.length === 0
              ? "All Outlets"
              : filters.outletIds.length === 1
                ? outlets.find((o) => o.id === filters.outletIds[0])?.name ?? "1 outlet"
                : `${filters.outletIds.length} outlets`}
          </span>
        </button>
        {outletOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <button
                className="text-xs text-blue-600 hover:underline"
                onClick={() => setFilters({ ...filters, outletIds: outlets.map((o) => o.id) })}
              >
                Select All
              </button>
              <button
                className="text-xs text-slate-500 hover:underline"
                onClick={() => setFilters({ ...filters, outletIds: [] })}
              >
                Clear
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {outlets.map((o) => (
                <label key={o.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={filters.outletIds.includes(o.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...filters.outletIds, o.id]
                        : filters.outletIds.filter((id) => id !== o.id);
                      setFilters({ ...filters, outletIds: next });
                    }}
                    className="accent-blue-600"
                  />
                  <span className="text-xs font-medium text-slate-700">{o.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Category Selector */}
      <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 sm:min-w-35 sm:w-auto">
        <LayoutGrid size={14} className="text-slate-400" />
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
      <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 sm:min-w-30 sm:w-auto">
        <Tag size={14} className="text-slate-400" />
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

      <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 sm:min-w-35 sm:w-auto">
        <Truck size={14} className="text-slate-400" />
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
      <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 sm:min-w-30 sm:w-auto">
        <Users size={14} className="text-slate-400" />
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
      <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 sm:min-w-40 sm:w-auto">
        <ClipboardList size={14} className="text-slate-400" />
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
          className="flex items-center gap-1.5 rounded-xl border border-red-100 px-3 py-1.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 sm:ml-auto"
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
      { id: "stockout-risk", label: "Stockout Risk", icon: TrendingDown },
      { id: "forecast-demand", label: "Forecast Demand", icon: TrendingUp },
      { id: "replenishment-smart", label: "Replenishment Smart", icon: ShoppingCart },
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
      { id: "supplier-payments-invoices", label: "Supplier Payments", icon: Truck },
      { id: "finance-payment-mix", label: "Finance Payment Mix", icon: Calculator },
      { id: "gst-output", label: "GST Output", icon: BadgePercent },
      { id: "gst-type-summary", label: "GST Type", icon: FileSpreadsheet },
      { id: "fbr-export", label: "FBR Export", icon: FileSpreadsheet },
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
];

function TabBreadcrumb({ activeTab }) {
  for (const group of GROUPS) {
    const tab = group.tabs.find((t) => t.id === activeTab);
    if (!tab) continue;
    const GroupIcon = group.tabs[0].icon;
    const TabIcon = tab.icon;
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-4 shrink-0">
        <GroupIcon size={13} className="text-slate-400" />
        <span className="font-medium text-slate-500">{group.label}</span>
        <span className="text-slate-300">/</span>
        <TabIcon size={13} className="text-blue-500" />
        <span className="font-semibold text-slate-700">{tab.label}</span>
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
    default:
      return null;
  }
}

export function ReportTabStandalone({ tabId }) {
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
  const { isBootstrapping } = useAuth();
  const toast = useToast();
  const { visible_report_groups } = usePreset();
  // Filter groups for sidebar — null = show all, array = show only listed groups
  const sidebarGroups = visible_report_groups
    ? GROUPS.filter((g) => visible_report_groups.includes(g.label))
    : GROUPS;
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
      const today = new Date().toISOString().slice(0, 10);
      setFilters((f) => ({ ...f, dateFrom: today, dateTo: today }));
    }
    didApplyParams.current = true;
  }, [searchParams]);

  const activeGroup = GROUPS.find((g) =>
    g.tabs.some((t) => t.id === activeTab),
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Reports
          </h1>
          <p className="text-slate-500">
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
        <div className="flex shrink-0 gap-1 overflow-x-auto py-1 lg:w-18 lg:flex-col lg:overflow-visible lg:border-r lg:border-slate-200 lg:pr-2">
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
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
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
            <div className="flex w-full flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
              {activeGroup.tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                    activeTab === id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
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
