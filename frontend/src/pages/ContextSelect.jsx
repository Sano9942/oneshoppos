import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Building2, MapPin, ChevronRight } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { readContext, writeContext } from "../auth/authStore";
import { API_BASE as API } from "../config";
import useFeatureFlags from "../hooks/useFeatureFlags";

export default function ContextSelect() {
  const { employee, isAuthenticated, authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const navigate = useNavigate();

  const [bootstrap, setBootstrap] = useState(null);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [scopeMode, setScopeMode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Check for existing context and skip conditions
  const existingCtx = readContext();
  const hasExistingContext =
    existingCtx &&
    (existingCtx.scope_mode === "all_branches" || existingCtx.active_outlet_id);
  const flagOff = !flagsLoading && !flags.context_selection_required;
  const shouldSkip = !isAuthenticated || hasExistingContext || flagOff;

  useEffect(() => {
    if (shouldSkip) return;
    fetch(`${API}/api/context/bootstrap`, { headers: authHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load context");
        return r.json();
      })
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

  // Redirect conditions (after hooks)
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (hasExistingContext) return <Navigate to="/dashboard" replace />;
  if (flagOff) return <Navigate to="/dashboard" replace />;

  const isAdmin = bootstrap?.scope_mode_default === "all_branches";
  const outlets = bootstrap?.outlets || [];
  const canContinue =
    scopeMode === "all_branches" || (scopeMode === "single_branch" && selectedOutletId);

  const handleContinue = () => {
    if (!canContinue) return;

    const isAllBranches = scopeMode === "all_branches";
    const context = {
      active_company_id: bootstrap?.companies?.[0]?.id || 1,
      active_outlet_id: isAllBranches ? null : Number(selectedOutletId),
      scope_mode: scopeMode,
      allowed_outlet_ids: bootstrap?.allowed_outlet_ids || [],
    };

    writeContext(context);
    navigate("/dashboard", { replace: true });
  };

  if (flagsLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-medium text-slate-500 shadow-sm">
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 shadow-lg">
          <p className="text-sm font-medium text-red-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 w-full rounded-lg bg-slate-800 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <Building2 size={24} className="text-emerald-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Select Your Branch</h1>
          <p className="mt-1 text-sm text-slate-500">
            Choose the branch you&apos;re working at today
          </p>
        </div>

        {/* Employee info */}
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Signed in as
          </p>
          <p className="mt-0.5 text-sm font-medium text-slate-700">
            {employee?.name}{" "}
            <span className="text-slate-400">
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
            className={`mb-3 flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition ${
              scopeMode === "all_branches"
                ? "border-emerald-500 bg-emerald-50"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                scopeMode === "all_branches"
                  ? "bg-emerald-500 text-white"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              <Building2 size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-700">
                All Branches
              </p>
              <p className="text-xs text-slate-400">
                Consolidated view across all locations
              </p>
            </div>
            {scopeMode === "all_branches" && (
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            )}
          </button>
        )}

        {/* Divider for admin */}
        {isAdmin && (
          <div className="mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium text-slate-400">
              or select a branch
            </span>
            <div className="h-px flex-1 bg-slate-200" />
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
              className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition ${
                scopeMode === "single_branch" &&
                selectedOutletId === String(outlet.id)
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                  scopeMode === "single_branch" &&
                  selectedOutletId === String(outlet.id)
                    ? "bg-emerald-500 text-white"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                <MapPin size={18} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-700">
                  {outlet.name}
                </p>
                {outlet.address && (
                  <p className="text-xs text-slate-400">{outlet.address}</p>
                )}
              </div>
              {scopeMode === "single_branch" &&
                selectedOutletId === String(outlet.id) && (
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                )}
            </button>
          ))}
        </div>

        {outlets.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            No branches assigned. Contact your administrator.
          </div>
        )}

        {/* Continue button */}
        <button
          onClick={handleContinue}
          disabled={!canContinue}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#7B61FF] py-2.5 text-sm font-semibold text-white hover:bg-[#6A50E5] disabled:opacity-50"
        >
          Continue
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
