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
import { AIChatPanel } from "../dashboard/AIChatPanel";
import { BackupStatusCard } from "../dashboard/BackupStatusCard";
import { FieldSummaryCards } from "../dashboard/FieldSummaryCards";
import DashboardWholesale from "../dashboard/DashboardWholesale";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { usePreset } from "../../contexts/PresetContext";

export default function DashboardRedesign() {
  const navigate = useNavigate();
  const { authHeaders, hasPerm } = useAuth();
  const [data, setData] = useState(null);
  const [recentSales, setRecentSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Role detection
  const isAdmin = hasPerm("all_access");
  const isManager = !isAdmin && hasPerm("view_reports");
  const isCashier = !isAdmin && !isManager;

  // Scope detection
  const ctx = readContext();
  const isSingleBranch = ctx?.scope_mode !== "all_branches";

  // Current employee id (for cashier attendance filtering)
  const currentEmployeeId = readSession()?.employee?.id;

  // Feature flags (for AI chat panel)
  const { flags } = useFeatureFlags(authHeaders);
  const { dashboard_widgets, presetLoaded, hasMode, business_model } = usePreset();
  // 2-G.16 Merchant home cards (staff-of-day + cash-position) — only for the
  // buy/sell retail family. No preset ever declared a "retail" mode, so the old
  // hasMode("retail") gate was dead: it fail-opened to true pre-load (flashing
  // the cards for everyone) then went false for every tenant once the preset
  // loaded. Gate on the real signal — the buy_sell / b2b_distribution business
  // models — and wait for presetLoaded so nothing flashes. Service / food /
  // clinical / rental / subscription tenants keep the original dashboard.
  const RETAIL_BUSINESS_MODELS = ["buy_sell", "b2b_distribution"];
  const showRetailCards = !isCashier && presetLoaded && RETAIL_BUSINESS_MODELS.includes(business_model);
  // Tier 0.5 — wholesale dashboard cards. Render when the tenant has the
  // `wholesale` mode set. Cashiers don't see A/R surfaces.
  const showWholesaleCards = !isCashier && typeof hasMode === "function" && hasMode("wholesale");

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
      {(isAdmin || isManager) && <PlanUsageBanner />}

      {/* Multi-outlet enabled banner — fires once after 1→2 outlet transition */}
      {(isAdmin || isManager) && <MultiOutletEnabledBanner />}

      {/* FBR prompt banner — PK tenants only, until set up or dismissed */}
      {(isAdmin || isManager) && data && (
        <FBRPromptBanner
          countryCode={data.countryCode}
          fbrBannerDismissed={data.fbrBannerDismissed}
          fbrIntegrationEnabled={data.fbrIntegrationEnabled}
        />
      )}

      {/* Onboarding checklist — shown to admin/manager until dismissed or all steps complete */}
      {(isAdmin || isManager) && (
        <DashboardOnboarding data={data} onNavigate={onNavigate} />
      )}

      {/* AI Insight cards — pre-built analytics */}
      {!isCashier && <InsightCards />}

      {/* Tier 1.1 wholesale: per-rep field sales summary. Renders nothing
          unless wholesale_field_sales flag is on AND tenant has field reps. */}
      {!isCashier && <FieldSummaryCards />}

      {/* Quick actions — role-aware horizontal button bar */}
      <div className="mb-4">
        <DashboardQuickActions isAdmin={isAdmin} isManager={isManager} />
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

      {/* KPI cards */}
      <div className="mb-4">
        <DashboardKPICards data={data} isCashier={isCashier} onNavigate={onNavigate} />
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

      {/* Outlet ranking — all-branches only, admin/manager only */}
      {!isSingleBranch && !isCashier && (
        <div className="mb-4">
          <DashboardOutletRanking data={data} onNavigate={onNavigate} />
        </div>
      )}

      {/* Exceptions — hidden for cashier */}
      {!isCashier && (
        <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <DashboardExceptions data={data} onNavigate={onNavigate} />
          <DashboardRiskSummary />
        </div>
      )}

      {/* Trends — hidden for cashier */}
      {!isCashier && (
        <div className="mb-4">
          <DashboardTrends data={data} />
        </div>
      )}

      {/* Payment + category contribution — hidden for cashier */}
      {!isCashier && (
        <div className="mb-4">
          <DashboardContribution data={data} />
        </div>
      )}

      {/* Top products — hidden for cashier */}
      {!isCashier && (
        <div className="mb-4">
          <DashboardTopProducts data={data} />
        </div>
      )}

      {/* Inventory alerts — hidden for cashier + hidden if preset disables it */}
      {!isCashier && (!presetLoaded || dashboard_widgets.inventory_alerts) && (
        <div className="mb-4">
          <DashboardInventoryAlerts data={data} />
        </div>
      )}

      {/* Attendance */}
      <div className="mb-4">
        <DashboardAttendance
          data={data}
          isCashier={isCashier}
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

      {/* AI Chat Panel — floating widget, feature-flag gated */}
      <AIChatPanel flagEnabled={!!flags.ai_insights} />
    </PageShell>
  );
}
