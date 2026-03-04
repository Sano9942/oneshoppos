import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { readContext } from "../auth/authStore";
import useFeatureFlags from "../hooks/useFeatureFlags";

export default function RequireContext({ children }) {
  const { authHeaders } = useAuth();
  const { flags, loading } = useFeatureFlags(authHeaders);
  const location = useLocation();

  // While loading flags, render children to avoid flash
  if (loading) return children;

  // If feature flag is off, pass through — backward compatible
  if (!flags.context_selection_required) return children;

  // Check for valid context
  const context = readContext();
  const hasContext =
    context &&
    (context.scope_mode === "all_branches" || context.active_outlet_id);

  if (hasContext) return children;

  return <Navigate to="/context-select" replace state={{ from: location }} />;
}
