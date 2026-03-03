import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  GitBranch,
  LayoutGrid,
  Target,
  Activity,
  ShieldAlert,
} from "lucide-react";

import { API_BASE as API } from "../config";
import {
  fmt,
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
} from "./reports/ReportsSales";
import {
  SalesStockTab,
  InventoryDumpTab,
  ProductPerformanceTab,
  OnHandTab,
  ReplenishmentTab,
  PricingMarginTab,
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
  PurchaseOrdersReportTab,
  GRNReportTab,
} from "./reports/ReportsPurchasing";
import {
  AttendanceTab,
  LaborPerformanceTab,
  LossPreventionTab,
} from "./reports/ReportsStaff";
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
import { CategoryWiseTab, ProductSpecTab } from "./reports/ReportsCatalog";

function GlobalFilterBar({ filters, setFilters, meta }) {
  const { outlets = [], categories = [], brands = [], employees = [] } = meta;

  const handleReset = () => {
    setFilters({
      dateFrom: "",
      dateTo: "",
      outletId: "",
      employeeId: "",
      categoryId: "",
      brandId: "",
      search: "",
    });
  };

  const hasActiveFilters = Object.values(filters).some((v) => !!v);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 mb-4 flex flex-wrap gap-3 items-center sticky top-0 z-10">
      {/* Search */}
      <div className="relative min-w-50 flex-1">
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

      {/* Date Range */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
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

      {/* Outlet Selector */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 min-w-35">
        <Building2 size={14} className="text-slate-400" />
        <select
          value={filters.outletId}
          onChange={(e) => setFilters({ ...filters, outletId: e.target.value })}
          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 flex-1 cursor-pointer"
        >
          <option value="">All Outlets</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {/* Category Selector */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 min-w-35">
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
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 min-w-30">
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

      {/* Employee Selector */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 min-w-30">
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

      {/* Reset */}
      {hasActiveFilters && (
        <button
          onClick={handleReset}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors border border-red-100"
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
      { id: "product-performance", label: "Product Performance", icon: Star },
      { id: "retail-matrix", label: "Retail Matrix", icon: LayoutGrid },
      { id: "pricing-margin", label: "Pricing Matrix", icon: Layers },
      { id: "sales-stock", label: "Sales & Stock", icon: Package },
      { id: "inventory-dump", label: "Inventory Dump", icon: Archive },
      { id: "on-hand", label: "On Hand", icon: Layers },
      { id: "product-spec", label: "Product Spec", icon: Package },
      { id: "replenishment", label: "Replenishment", icon: RotateCcw },
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
    label: "HR",
    tabs: [
      { id: "attendance", label: "Attendance", icon: Clock },
      { id: "labor-performance", label: "Labor Performance", icon: Activity },
      { id: "loss-prevention", label: "Loss Prevention", icon: ShieldAlert },
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

function TabContent({ activeTab, filters }) {
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
    case "overview":
      return <OverviewTab filters={filters} />;
    case "sales-summary":
      return <SalesSummaryTab filters={filters} />;
    case "sales-detail":
      return <SalesDetailTab filters={filters} />;
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
    case "product-performance":
      return <ProductPerformanceTab filters={filters} />;
    case "product-spec":
      return <ProductSpecTab filters={filters} />;
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
    case "supplier-wise":
      return <SupplierWiseTab filters={filters} />;
    case "purchase-orders-report":
      return <PurchaseOrdersReportTab filters={filters} />;
    case "grn-report":
      return <GRNReportTab filters={filters} />;
    case "pricing-margin":
      return <PricingMarginTab filters={filters} />;
    case "attendance":
      return <AttendanceTab filters={filters} />;
    default:
      return null;
  }
}

export function ReportTabStandalone({ tabId }) {
  return (
    <div className="flex-1 flex flex-col h-full bg-transparent">
      <div className="flex-1 overflow-auto min-h-0">
        <TabContent activeTab={tabId} />
      </div>
    </div>
  );
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState("overview");
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    outletId: "",
    employeeId: "",
    categoryId: "",
    brandId: "",
    search: "",
  });

  const [meta, setMeta] = useState({
    outlets: [],
    categories: [],
    brands: [],
    employees: [],
  });

  useEffect(() => {
    // Basic meta loader for dropdowns
    const loadMeta = async () => {
      try {
        const [outlets, categories, brands, employees] = await Promise.all([
          fetch(`${API}/api/outlets`).then((r) => r.json()),
          fetch(`${API}/api/categories`).then((r) => r.json()),
          fetch(`${API}/api/brands`).then((r) => r.json()),
          fetch(`${API}/api/employees`).then((r) => r.json()),
        ]);
        setMeta({
          outlets: outlets.outlets || outlets || [],
          categories: categories.categories || categories || [],
          brands: brands.brands || brands || [],
          employees: employees.employees || employees || [],
        });
      } catch (err) {
        console.error("Failed to load metadata", err);
      }
    };
    loadMeta();
  }, []);

  const activeGroup = GROUPS.find((g) =>
    g.tabs.some((t) => t.id === activeTab),
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Reports
          </h1>
          <p className="text-slate-500">
            {GROUPS.reduce((n, g) => n + g.tabs.length, 0)} reports across
            sales, inventory, operations, and procurement.
          </p>
        </div>
      </div>

      {/* Global Filter Bar */}
      <GlobalFilterBar filters={filters} setFilters={setFilters} meta={meta} />

      {/* Two-panel layout: group sidebar + sub-tabs + content */}
      <div className="flex flex-1 min-h-0 gap-0">
        {/* Left: group icon sidebar */}
        <div className="flex flex-col gap-1 shrink-0 w-18 py-1 pr-2 border-r border-slate-200">
          {GROUPS.map((group) => {
            const isActive = group === activeGroup;
            const GroupIcon = group.tabs[0].icon;
            return (
              <button
                key={group.label}
                onClick={() => setActiveTab(group.tabs[0].id)}
                title={group.label}
                className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl text-xs font-medium transition-all ${
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
        <div className="flex flex-col flex-1 min-w-0 pl-4 gap-3">
          {/* Sub-tab pill strip for the active group */}
          {activeGroup && (
            <div className="flex gap-1 shrink-0 bg-slate-100 rounded-xl p-1 w-fit">
              {activeGroup.tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
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
              <TabContent activeTab={activeTab} filters={filters} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
