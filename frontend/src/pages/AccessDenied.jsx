import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function AccessDenied() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const t = setTimeout(() => {
      navigate(location.state?.redirectTo || "/dashboard", { replace: true });
    }, 1200);
    return () => clearTimeout(t);
  }, [navigate, location.state]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) px-4">
      <div className="bg-(--ui-surface) border border-(--ui-border-strong) rounded-(--ui-radius-md) p-6 text-center max-w-md">
        <h1 className="text-xl font-bold text-(--ui-text)">Access Denied</h1>
        <p className="text-sm text-(--ui-text-muted) mt-2">
          You do not have permission for this page.
        </p>
        <p className="text-xs text-(--ui-text-muted) mt-3">
          Redirecting to a safe page...
        </p>
      </div>
    </div>
  );
}
