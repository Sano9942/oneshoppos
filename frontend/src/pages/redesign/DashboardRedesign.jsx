import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { readContext, readSession } from "../../auth/authStore";
import { PageShell, SectionCard, Skeleton } from "../../ui/primitives";

import { DashboardOpsReadiness } from "../dashboard/DashboardOpsReadiness";
import { DashboardKPICards } from "../dashboard/DashboardKPICards";
import { DashboardQuickActions } from "../dashboard/DashboardQuickActions";
import { DashboardExceptions } from "../dashboard/DashboardExceptions";
import { DashboardOutletRanking } from "../dashboard/DashboardOutletRanking";
import { DashboardContribution } from "../dashboard/DashboardContribution";
import { DashboardTrends } from "../dashboard/DashboardTrends";
import { DashboardInventoryAlerts } from "../dashboard/DashboardInventoryAlerts";
import { DashboardAttendance } from "../dashboard/DashboardAttendance";
import { DashboardRecentSales } from "../dashboard/DashboardRecentSales";
import { DashboardAttention } from "../dashboard/DashboardAttention";
import DashboardHoldsExpiring from "../dashboard/DashboardHoldsExpiring";
import DashboardRiskSummary from "../dashboard/DashboardRiskSummary";
import { DashboardTopProducts } from "../dashboard/DashboardTopProducts";
import DashboardStaffOfDay from "../dashboard/DashboardStaffOfDay";
import DashboardCashPosition from "../dashboard/DashboardCashPosition";
import { DashboardOnboarding } from "../dashboard/DashboardOnboarding";
import PlanUsageBanner from "../dashboard/PlanUsageBanner";
import MultiOutletEnabledBanner from "../../ui/MultiOutletEnabledBanner";
import FBRPromptBanner from "../../ui/FBRPromptBanner";
import { InsightCards } from "../dashboard/InsightCards";
import { BackupStatusCard } from "../dashboard/BackupStatusCard";
import { FieldSummaryCards } from "../dashboard/FieldSummaryCards";
import DashboardWholesale from "../dashboard/DashboardWholesale";
import { usePreset } from "../../contexts/PresetContext";

export default function DashboardRedesign() {
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const [data, setData] = useState(null);
  const [recentSales, setRecentSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // W0b C3 (role audit) + PLAN-V2 Step 4 (D4 split): permission gating, no
  // role inference. view_reports was split into five data-classed perms, so
  // each widget now gates on the split that guards its own data — mirroring
  // the server-side /api/reports/dashboard segment filter (REPORT-PERMS.md
  // §7 mixed #1), so the UI never shows a card the API will blank:
  //  - account/config banners (plan usage, multi-outlet, FBR setup,
  //    onboarding, backup) → all_access
  //  - sales widgets (insights, sales KPIs, trends, contribution, top
  //    products, exceptions, retail cards, outlet ranking) → view_sales_reports
  //  - profit/margin KPIs → view_financial_reports (KPICards reduced view
  //    when absent); wholesale A/R cards → view_financial_reports
  //  - inventory alerts → view_inventory_reports
  //  - team attendance + risk summary → view_hr_reports (own-attendance row
  //    stays for everyone; the server always includes the caller's own row)
  //  - field summary → manage_field_sales (routes/field.js guard)
  const isAdmin = hasPerm("all_access");
  const canSales = hasPerm("view_sales_reports");
  const canFinancial = hasPerm("view_financial_reports");
  const canInventory = hasPerm("view_inventory_reports");
  const canHr = hasPerm("view_hr_reports");
  const canFieldSales = hasPerm("manage_field_sales");

  // Scope detection
  const ctx = readContext();
  const isSingleBranch = ctx?.scope_mode !== "all_branches";

  // Current employee id (for cashier attendance filtering)
  const currentEmployeeId = readSession()?.employee?.id;

  const { dashboard_widgets, presetLoaded, hasMode, business_model } = usePreset();
  // 2-G.16 Merchant home cards (staff-of-day + cash-position) — only for the
  // buy/sell retail family. No preset ever declared a "retail" mode, so the old
  // hasMode("retail") gate was dead: it fail-opened to true pre-load (flashing
  // the cards for everyone) then went false for every tenant once the preset
  // loaded. Gate on the real signal — the buy_sell / b2b_distribution business
  // models — and wait for presetLoaded so nothing flashes. Service / food /
  // clinical / rental / subscription tenants keep the original dashboard.
  const RETAIL_BUSINESS_MODELS = ["buy_sell", "b2b_distribution"];
  const showRetailCards = canSales && presetLoaded && RETAIL_BUSINESS_MODELS.includes(business_model);
  // Tier 0.5 — wholesale dashboard cards. Render when the tenant has the
  // `wholesale` mode set. A/R surfaces are financial-class (§7 mixed #2).
  const showWholesaleCards = canFinancial && typeof hasMode === "function" && hasMode("wholesale");

  const fetchDashboard = useCallback((silent = false) => {
    let mounted = true;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    Promise.all([
      api.get("/api/reports/dashboard"),
      api.get("/api/sales?limit=10").catch(() => ({ sales: [] })),
    ])
      .then(([dash, salesData]) => {
        if (!mounted) return;
        setData(dash);
        setRecentSales(salesData.sales || []);
        setLastRefreshed(new Date());
        setError("");
      })
      .catch((e) => {
        if (mounted) setError(e.message || "Failed to load dashboard");
      })
      .finally(() => {
        if (mounted) { setLoading(false); setRefreshing(false); }
      });
    return () => { mounted = false; };
  }, []);

  // Initial load + re-fetch when refreshKey changes
  useEffect(() => {
    return fetchDashboard(refreshKey > 0);
  }, [fetchDashboard, refreshKey]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const timer = setInterval(() => setRefreshKey((k) => k + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const onNavigate = (path) => navigate(path);
  const handleManualRefresh = () => setRefreshKey((k) => k + 1);

  if (loading) {
    return (
      <PageShell title="Dashboard" subtitle="Loading operational data...">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Dashboard"
      subtitle={
        <span className="flex items-center gap-3">
          <span>Operations at a glance.</span>
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="flex cursor-pointer items-center gap-1.5 text-xs text-(--ui-text-muted) transition-colors hover:text-(--ui-text) disabled:opacity-50"
            title="Refresh dashboard"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {lastRefreshed
              ? `Updated ${lastRefreshed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
              : "Refresh"}
          </button>
        </span>
      }
    >
      {error && (
        <SectionCard className="mb-4 border-transparent bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">
          {error}
        </SectionCard>
      )}

      {/* Plan-usage banner — admin/manager only; hidden if all dimensions <80% or all unlimited */}
      {isAdmin && <PlanUsageBanner />}

      {/* Multi-outlet enabled banner — fires once after 1→2 outlet transition */}
      {isAdmin && <MultiOutletEnabledBanner />}

      {/* FBR prompt banner — PK tenants only, until set up or dismissed */}
      {isAdmin && data && (
        <FBRPromptBanner
          countryCode={data.countryCode}
          fbrBannerDismissed={data.fbrBannerDismissed}
          fbrIntegrationEnabled={data.fbrIntegrationEnabled}
        />
      )}

      {/* Onboarding checklist — shown to admin/manager until dismissed or all steps complete */}
      {isAdmin && (
        <DashboardOnboarding data={data} onNavigate={onNavigate} />
      )}

      {/* AI Insight cards — pre-built analytics (sales-class payload) */}
      {canSales && <InsightCards />}

      {/* Tier 1.1 wholesale: per-rep field sales summary. Renders nothing
          unless wholesale_field_sales flag is on AND tenant has field reps. */}
      {canFieldSales && <FieldSummaryCards />}

      {/* Quick actions — role-aware horizontal button bar */}
      <div className="mb-4">
        <DashboardQuickActions hasPerm={hasPerm} />
      </div>

      {/* Ops readiness — shift status, staff, last sale */}
      <div className="mb-4">
        <DashboardOpsReadiness data={data} isSingleBranch={isSingleBranch} />
      </div>

      {/* Prescriptive attention queue */}
      <div className="mb-4">
        <DashboardAttention data={data} onNavigate={onNavigate} />
      </div>

      {/* 2-G.9 holds expiring this week (flag-gated inside widget) */}
      <div className="mb-4">
        <DashboardHoldsExpiring />
      </div>

      {/* KPI cards — reduced view (Revenue + Avg Bill only) when the caller
          lacks the financial split, since the full grid exposes Net Profit +
          Month Gross Margin (server strips those fields too). */}
      <div className="mb-4">
        <DashboardKPICards data={data} isCashier={!canFinancial} onNavigate={onNavigate} />
      </div>

      {/* Tier 0.5 — wholesale A/R cards (mode-gated) */}
      {showWholesaleCards && (
        <div className="mb-4">
          <DashboardWholesale refreshKey={refreshKey} />
        </div>
      )}

      {/* 2-G.16 Merchant home — staff-of-day + cash-position side-by-side (retail only) */}
      {showRetailCards && (
        <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <DashboardStaffOfDay data={data} />
          <DashboardCashPosition data={data} />
        </div>
      )}

      {/* Outlet ranking — all-branches only, sales-class */}
      {!isSingleBranch && canSales && (
        <div className="mb-4">
          <DashboardOutletRanking data={data} onNavigate={onNavigate} />
        </div>
      )}

      {/* Exceptions (refund/void/discount — sales-class) + risk summary
          (conduct — HR-class). Each gated on its own data class. */}
      {(canSales || canHr) && (
        <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {canSales && <DashboardExceptions data={data} onNavigate={onNavigate} />}
          {canHr && <DashboardRiskSummary />}
        </div>
      )}

      {/* Trends — sales-class */}
      {canSales && (
        <div className="mb-4">
          <DashboardTrends data={data} />
        </div>
      )}

      {/* Payment + category contribution — sales-class */}
      {canSales && (
        <div className="mb-4">
          <DashboardContribution data={data} />
        </div>
      )}

      {/* Top products — sales-class */}
      {canSales && (
        <div className="mb-4">
          <DashboardTopProducts data={data} />
        </div>
      )}

      {/* Inventory alerts — inventory-class + hidden if preset disables it */}
      {canInventory && (!presetLoaded || dashboard_widgets.inventory_alerts) && (
        <div className="mb-4">
          <DashboardInventoryAlerts data={data} />
        </div>
      )}

      {/* Attendance — team view is HR-class; a non-HR caller sees only their
          own row (server includes it regardless via the own-row carve-out). */}
      <div className="mb-4">
        <DashboardAttendance
          data={data}
          isCashier={!canHr}
          currentEmployeeId={currentEmployeeId}
        />
      </div>

      {/* Backup status — admin only */}
      {isAdmin && (
        <div className="mb-4">
          <BackupStatusCard />
        </div>
      )}

      {/* Recent sales */}
      <div className="mb-4">
        <DashboardRecentSales
          recentSales={recentSales}
          data={data}
          isSingleBranch={isSingleBranch}
          onNavigate={onNavigate}
        />
      </div>
    </PageShell>
  );
}
