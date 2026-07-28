import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Building2, MapPin, ChevronRight } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { readContext, writeContext, writeToken } from "../auth/authStore";
import { IS_MULTI_TENANT } from "../config";
import { api } from "../api";
import useFeatureFlags, { refreshFeatureFlags } from "../hooks/useFeatureFlags";
import { usePreset } from "../contexts/PresetContext";

export default function ContextSelect() {
  const { employee, isAuthenticated, isBootstrapping, authHeaders, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { refreshPreset } = usePreset();
  const navigate = useNavigate();

  const [bootstrap, setBootstrap] = useState(null);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [scopeMode, setScopeMode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Check for existing context and skip conditions
  const existingCtx = readContext();
  const allBranchesAllowed = hasPerm("all_access");
  const hasExistingContext =
    existingCtx &&
    ((existingCtx.scope_mode === "all_branches" && allBranchesAllowed) ||
      existingCtx.active_outlet_id);
  const flagOff = !flagsLoading && !flags.context_selection_required;
  const shouldSkip = !isAuthenticated || hasExistingContext || flagOff;

  useEffect(() => {
    if (shouldSkip) return;

    // Transient 503s — typically SETUP_REQUIRED races on a cold company-profile
    // cache after a backend restart — self-recover within a few hundred ms.
    // Auto-retry once silently before surfacing the error card to the user.
    const fetchWithRetry = async () => {
      try {
        return await api.get("/api/context/bootstrap");
      } catch (err) {
        const isTransient =
          err?.status === 503 || err?.body?.code === "SETUP_REQUIRED";
        if (!isTransient) throw err;
        await new Promise((r) => setTimeout(r, 600));
        return api.get("/api/context/bootstrap");
      }
    };

    fetchWithRetry()
      .then((data) => {
        setBootstrap(data);

        // Auto-select defaults
        setScopeMode(data.scope_mode_default || "single_branch");

        if (data.scope_mode_default === "single_branch" && data.primary_outlet_id) {
          setSelectedOutletId(String(data.primary_outlet_id));
        }

        // Auto-select if only one outlet for non-admin
        if (
          data.scope_mode_default === "single_branch" &&
          data.outlets?.length === 1
        ) {
          setSelectedOutletId(String(data.outlets[0].id));
        }

        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load context data");
        setLoading(false);
      });
  }, [shouldSkip]);

  // Wait for session restore before deciding redirects
  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-(--ui-muted-surface)">
        <div className="rounded-(--ui-radius-lg) border border-(--ui-border-strong) bg-(--ui-surface) px-6 py-4 text-sm font-medium text-(--ui-text-muted)">
          Loading...
        </div>
      </div>
    );
  }

  // Redirect conditions (after hooks)
  // Tier 1.1 wholesale field sales: field reps go straight to /field/today
  // regardless of home_page preference — the mobile screen IS their home.
  // Otherwise (2-G.16 Merchant home) honour the employee's home_page preference
  // (`retail_home` → `/retail/home`) if set, else land on /dashboard.
  const preferredHome =
    employee?.employee_type === "field_rep"
      ? "/field/today"
      : employee?.home_page === "retail_home"
        ? "/retail/home"
        : "/dashboard";
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (hasExistingContext) return <Navigate to={preferredHome} replace />;
  if (flagOff) return <Navigate to={preferredHome} replace />;

  const isAdmin = bootstrap?.scope_mode_default === "all_branches";
  const outlets = bootstrap?.outlets || [];
  const canContinue =
    scopeMode === "all_branches" || (scopeMode === "single_branch" && selectedOutletId);

  const handleContinue = async () => {
    if (!canContinue) return;

    const isAllBranches = scopeMode === "all_branches";
    const outletId = isAllBranches ? null : Number(selectedOutletId);
    const context = {
      active_company_id: bootstrap?.companies?.[0]?.id || 1,
      active_outlet_id: outletId,
      scope_mode: scopeMode,
      allowed_outlet_ids: bootstrap?.allowed_outlet_ids || [],
    };

    // In MT mode, re-sign the JWT with the selected outlet_id
    if (IS_MULTI_TENANT) {
      try {
        const data = await api.post("/api/auth/update-context", { outlet_id: outletId });
        if (data.token) writeToken(data.token);
      } catch {
        // Best-effort — context still works via headers
      }
    }

    writeContext(context);
    // Step 14 (D2b): flags, modes AND the effective permission set are all
    // outlet-context-dependent — refresh the gate sources in place (same as
    // ContextSwitcher) so nav/guards match the chosen outlet immediately.
    refreshFeatureFlags();
    refreshPreset?.();
    navigate(preferredHome, { replace: true });
  };

  if (flagsLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-(--ui-muted-surface)">
        <div className="rounded-(--ui-radius-lg) border border-(--ui-border-strong) bg-(--ui-surface) px-6 py-4 text-sm font-medium text-(--ui-text-muted)">
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-(--ui-muted-surface) px-4">
        <div className="w-full max-w-md rounded-(--ui-radius-lg) border border-(--ui-border-strong) bg-(--ui-surface) p-8">
          <p className="text-sm font-medium text-(--ui-danger)">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="ui-focus-ring mt-4 w-full rounded-(--ui-radius-pill) bg-(--ui-primary) py-2.5 text-sm font-semibold text-(--ui-on-primary) hover:bg-(--ui-primary-strong)"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-(--ui-muted-surface) px-4">
      <div className="w-full max-w-md rounded-(--ui-radius-lg) border border-(--ui-border-strong) bg-(--ui-surface) p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-(--ui-muted-surface)">
            <Building2 size={24} className="text-(--ui-text)" />
          </div>
          <h1 className="text-xl font-bold text-(--ui-text)">Select Your Branch</h1>
          <p className="mt-1 text-sm text-(--ui-text-muted)">
            Choose the branch you&apos;re working at today
          </p>
        </div>

        {/* Employee info */}
        <div className="mb-5 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Signed in as
          </p>
          <p className="mt-0.5 text-sm font-medium text-(--ui-text)">
            {employee?.name}{" "}
            <span className="text-(--ui-text-muted)">
              ({bootstrap?.employee?.role_name || "Employee"})
            </span>
          </p>
        </div>

        {/* All branches option (admin only) */}
        {isAdmin && (
          <button
            onClick={() => {
              setScopeMode("all_branches");
              setSelectedOutletId("");
            }}
            className={`ui-focus-ring mb-3 flex w-full items-center gap-3 rounded-(--ui-radius-md) border-2 px-4 py-3.5 text-left transition ${
              scopeMode === "all_branches"
                ? "border-(--ui-primary) bg-(--ui-muted-surface)"
                : "border-(--ui-border-strong) hover:bg-(--ui-muted-surface)"
            }`}
          >
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-(--ui-radius-sm) ${
                scopeMode === "all_branches"
                  ? "bg-(--ui-primary) text-(--ui-on-primary)"
                  : "bg-(--ui-muted-surface) text-(--ui-text-muted)"
              }`}
            >
              <Building2 size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-(--ui-text)">
                All Branches
              </p>
              <p className="text-xs text-(--ui-text-muted)">
                Consolidated view across all locations
              </p>
            </div>
            {scopeMode === "all_branches" && (
              <div className="h-2.5 w-2.5 rounded-full bg-(--ui-primary)" />
            )}
          </button>
        )}

        {/* Divider for admin */}
        {isAdmin && (
          <div className="mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-(--ui-border-strong)" />
            <span className="text-xs font-medium text-(--ui-text-muted)">
              or select a branch
            </span>
            <div className="h-px flex-1 bg-(--ui-border-strong)" />
          </div>
        )}

        {/* Outlet list */}
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {outlets.map((outlet) => (
            <button
              key={outlet.id}
              onClick={() => {
                setScopeMode("single_branch");
                setSelectedOutletId(String(outlet.id));
              }}
              className={`ui-focus-ring flex w-full items-center gap-3 rounded-(--ui-radius-md) border-2 px-4 py-3.5 text-left transition ${
                scopeMode === "single_branch" &&
                selectedOutletId === String(outlet.id)
                  ? "border-(--ui-primary) bg-(--ui-muted-surface)"
                  : "border-(--ui-border-strong) hover:bg-(--ui-muted-surface)"
              }`}
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-(--ui-radius-sm) ${
                  scopeMode === "single_branch" &&
                  selectedOutletId === String(outlet.id)
                    ? "bg-(--ui-primary) text-(--ui-on-primary)"
                    : "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                }`}
              >
                <MapPin size={18} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-(--ui-text)">
                  {outlet.name}
                </p>
                {outlet.address && (
                  <p className="text-xs text-(--ui-text-muted)">{outlet.address}</p>
                )}
              </div>
              {scopeMode === "single_branch" &&
                selectedOutletId === String(outlet.id) && (
                  <div className="h-2.5 w-2.5 rounded-full bg-(--ui-primary)" />
                )}
            </button>
          ))}
        </div>

        {outlets.length === 0 && (
          <div className="rounded-(--ui-radius-sm) bg-(--ui-warning-bg) px-4 py-3 text-sm text-(--ui-warning-fg)">
            No branches assigned. Contact your administrator.
          </div>
        )}

        {/* Continue button */}
        <button
          onClick={handleContinue}
          disabled={!canContinue}
          className="ui-focus-ring mt-5 flex w-full items-center justify-center gap-2 rounded-(--ui-radius-pill) bg-(--ui-primary) py-2.5 text-sm font-semibold text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
        >
          Continue
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
