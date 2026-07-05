import { useEffect } from "react";
import { Link, NavLink, Outlet, useParams, useNavigate, useLocation } from "react-router-dom";
import {
  ManufacturerPortalAuthProvider,
  useMfgPortalAuth,
} from "./ManufacturerPortalAuthProvider";

// Tier 1.4 manufacturer portal shell. Public routes (login / setup) render
// without the nav chrome; authenticated routes get the header + nav.
//
// Unlike the customer portal there's no /api/manufacturer-portal/config
// endpoint — the manufacturer portal is a thin reporting surface and
// branding doesn't matter at the same level. Tenant identity comes from
// the URL slug; partner identity comes from /me after auth.

const PUBLIC_TAILS = new Set(["login", "setup"]);

function ManufacturerPortalShell() {
  const { tenantSlug } = useParams();
  const auth = useMfgPortalAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Auth guard: route public tails to anon-only pages, all others require auth.
  useEffect(() => {
    if (auth.bootstrapping) return;
    const seg = location.pathname.split("/").filter(Boolean);
    // /manufacturer-portal/:slug/<tail>
    const tail = seg[2] || "";
    if (!auth.isAuthenticated && !PUBLIC_TAILS.has(tail)) {
      navigate(`/manufacturer-portal/${tenantSlug}/login`, { replace: true });
    }
    if (auth.isAuthenticated && PUBLIC_TAILS.has(tail)) {
      navigate(`/manufacturer-portal/${tenantSlug}`, { replace: true });
    }
  }, [auth.isAuthenticated, auth.bootstrapping, location.pathname, tenantSlug, navigate]);

  if (auth.bootstrapping) {
    return (
      <div className="min-h-screen grid place-items-center bg-(--ui-bg) text-(--ui-text-muted)">
        Loading portal…
      </div>
    );
  }

  const isAuthed = auth.isAuthenticated;

  // Manufacturer portal wears DARK top-chrome (black header + nav) to keep it
  // visually distinct from the light-chrome customer portal — both stay fully
  // monochrome (no hues), so a partner never confuses the two surfaces.
  return (
    <div className="min-h-screen bg-(--ui-bg) text-(--ui-text)">
      <header className="bg-(--ui-primary) text-(--ui-on-primary)">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            to={`/manufacturer-portal/${tenantSlug}`}
            className="flex items-center gap-3"
          >
            <div className="h-9 w-9 rounded-(--ui-radius-sm) bg-(--ui-on-primary) text-(--ui-primary) grid place-items-center font-bold">
              {tenantSlug.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-(--ui-on-primary)/55">Manufacturer Portal</div>
              <div className="text-lg font-semibold">{tenantSlug}</div>
            </div>
          </Link>
          {isAuthed && (
            <div className="flex items-center gap-3">
              <div className="text-sm text-(--ui-on-primary)/70 hidden sm:block">
                {auth.partner?.name || auth.partner?.email}
              </div>
              <button
                type="button"
                onClick={auth.logout}
                className="text-sm text-(--ui-on-primary)/85 hover:text-(--ui-on-primary) px-3 py-1.5 border border-(--ui-on-primary)/25 rounded-full"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {isAuthed && (
        <nav className="bg-(--ui-primary) border-t border-(--ui-on-primary)/10">
          <div className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
            <NavLink
              end
              to={`/manufacturer-portal/${tenantSlug}`}
              className={({ isActive }) =>
                `px-4 py-3 text-sm font-medium border-b-2 ${
                  isActive
                    ? "border-(--ui-on-primary) text-(--ui-on-primary)"
                    : "border-transparent text-(--ui-on-primary)/55"
                }`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to={`/manufacturer-portal/${tenantSlug}/sales`}
              className={({ isActive }) =>
                `px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
                  isActive
                    ? "border-(--ui-on-primary) text-(--ui-on-primary)"
                    : "border-transparent text-(--ui-on-primary)/55"
                }`
              }
            >
              Sales
            </NavLink>
            <NavLink
              to={`/manufacturer-portal/${tenantSlug}/promotions`}
              className={({ isActive }) =>
                `px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
                  isActive
                    ? "border-(--ui-on-primary) text-(--ui-on-primary)"
                    : "border-transparent text-(--ui-on-primary)/55"
                }`
              }
            >
              Schemes
            </NavLink>
          </div>
        </nav>
      )}

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Outlet context={{ tenantSlug }} />
      </main>
    </div>
  );
}

export default function ManufacturerPortalLayout() {
  const { tenantSlug } = useParams();
  return (
    <ManufacturerPortalAuthProvider tenantSlug={tenantSlug}>
      <ManufacturerPortalShell />
    </ManufacturerPortalAuthProvider>
  );
}
