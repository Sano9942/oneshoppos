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
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="bg-white border border-red-200 rounded-xl p-6 text-center max-w-md">
        <h1 className="text-xl font-bold text-slate-800">Access Denied</h1>
        <p className="text-sm text-slate-600 mt-2">
          You do not have permission for this page.
        </p>
        <p className="text-xs text-slate-400 mt-3">
          Redirecting to a safe page...
        </p>
      </div>
    </div>
  );
}
