import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { readContext } from "../auth/authStore";
import useFeatureFlags from "../hooks/useFeatureFlags";

export default function RequireContext({ children }) {
  const { authHeaders, hasPerm } = useAuth();
  const { flags, loading } = useFeatureFlags(authHeaders);
  const location = useLocation();

  // Do not render protected pages until context policy flags are known.
  // Rendering early can trigger API calls before context checks settle.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) text-(--ui-text-muted) text-sm font-medium">
        Loading context...
      </div>
    );
  }

  // If feature flag is off, pass through — backward compatible
  if (!flags.context_selection_required) return children;

  // Check for valid context
  const context = readContext();
  const allBranchesAllowed = hasPerm("all_access");
  const hasContext =
    context &&
    ((context.scope_mode === "all_branches" && allBranchesAllowed) ||
      context.active_outlet_id);

  if (hasContext) return children;

  return <Navigate to="/context-select" replace state={{ from: location }} />;
}
