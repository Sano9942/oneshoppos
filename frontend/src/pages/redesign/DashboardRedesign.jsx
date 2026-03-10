import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { API_BASE as API } from "../../config";
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
import { DashboardTopProducts } from "../dashboard/DashboardTopProducts";
import { DashboardOnboarding } from "../dashboard/DashboardOnboarding";

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

  const fetchDashboard = useCallback((silent = false) => {
    let mounted = true;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    Promise.all([
      fetch(`${API}/api/reports/dashboard`, { headers: authHeaders() }).then((r) => r.json()),
      fetch(`${API}/api/sales?limit=10`, { headers: authHeaders() })
        .then((r) => r.json())
        .catch(() => ({ sales: [] })),
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
  }, [authHeaders]);

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
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
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
        <SectionCard className="mb-4 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      )}

      {/* Onboarding checklist — shown to admin/manager until dismissed or all steps complete */}
      {(isAdmin || isManager) && (
        <DashboardOnboarding data={data} onNavigate={onNavigate} />
      )}

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

      {/* KPI cards */}
      <div className="mb-4">
        <DashboardKPICards data={data} isCashier={isCashier} onNavigate={onNavigate} />
      </div>

      {/* Outlet ranking — all-branches only, admin/manager only */}
      {!isSingleBranch && !isCashier && (
        <div className="mb-4">
          <DashboardOutletRanking data={data} onNavigate={onNavigate} />
        </div>
      )}

      {/* Exceptions — hidden for cashier */}
      {!isCashier && (
        <div className="mb-4">
          <DashboardExceptions data={data} onNavigate={onNavigate} />
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

      {/* Inventory alerts — hidden for cashier */}
      {!isCashier && (
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
