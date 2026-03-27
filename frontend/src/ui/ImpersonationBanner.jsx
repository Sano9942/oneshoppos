import { useAuth } from "../auth/AuthProvider";
import { API_BASE as API } from "../config";

export default function ImpersonationBanner() {
  const { impersonationTenantName, impersonationSessionId } = useAuth();

  const handleExit = async () => {
    try {
      // End the impersonation session via admin API
      const adminSession = JSON.parse(localStorage.getItem("adminSession") || "null");
      const adminToken = adminSession?.token;
      if (adminToken && impersonationSessionId) {
        await (window._nativeFetch || window.fetch)(
          `${API}/api/admin/impersonate/${impersonationSessionId}/end`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${adminToken}`,
              "Content-Type": "application/json",
            },
          }
        );
      }
    } catch {
      // Best-effort — proceed with closing regardless
    }

    // Clear the impersonation session data
    localStorage.removeItem("authSession");
    localStorage.removeItem("currentEmployee");

    // Try to close the tab; if blocked by browser, redirect to admin panel
    window.close();
    setTimeout(() => {
      window.location.href = "/admin";
    }, 300);
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-100 flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-md">
      <span>
        You are viewing as <strong>{impersonationTenantName || "tenant"}</strong>
      </span>
      <button
        onClick={handleExit}
        className="rounded-md bg-white/20 px-3 py-0.5 text-xs font-bold text-white transition-colors hover:bg-white/30"
      >
        Exit Impersonation
      </button>
    </div>
  );
}
