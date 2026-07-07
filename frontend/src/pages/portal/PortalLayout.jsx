import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams, useNavigate, useLocation } from "react-router-dom";
import { PortalAuthProvider, usePortalAuth } from "./PortalAuthProvider";
import { portalApi } from "../../api/portalApi";

const TAB_LABEL_KEYS = {
  invoices: "invoices_tab",
  orders: "orders_tab",
  appointments: "appointments_tab",
  subscriptions: "subscriptions_tab",
  contracts: "contracts_tab",
  tickets: "tickets_tab",
  loyalty: "loyalty_tab",
  wallet: "wallet_tab",
  profile: "profile_tab",
  stays: "stays_tab",
  treatments: "treatments_tab",
  packages: "packages_tab",
  gallery: "gallery_tab",
};

const TAB_PATHS = {
  invoices: "invoices",
  orders: "orders",
  appointments: "appointments",
  subscriptions: "subscriptions",
  contracts: "contracts",
  tickets: "tickets",
  loyalty: "loyalty",
  wallet: "wallet",
  profile: "profile",
  stays: "stays",
  treatments: "treatments",
  packages: "packages",
  gallery: "gallery",
};

function PortalShell() {
  const { tenantSlug } = useParams();
  const auth = usePortalAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [config, setConfig] = useState(null);
  const [configErr, setConfigErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .get(tenantSlug, "/api/portal/config")
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch((err) => {
        if (!cancelled) setConfigErr(err.message || "Store not found");
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  // Guard: unauth → send to login sub-route, preserving the target.
  useEffect(() => {
    if (auth.bootstrapping) return;
    const publicPaths = ["login", "signup", "forgot", "reset", "verify-otp"];
    const seg = location.pathname.split("/").filter(Boolean);
    // /portal/:slug/<seg>
    const tail = seg[2] || "";
    if (!auth.isAuthenticated && !publicPaths.includes(tail)) {
      navigate(`/portal/${tenantSlug}/login`, { replace: true });
    }
    if (auth.isAuthenticated && publicPaths.includes(tail)) {
      navigate(`/portal/${tenantSlug}`, { replace: true });
    }
  }, [auth.isAuthenticated, auth.bootstrapping, location.pathname, tenantSlug, navigate]);

  if (configErr) {
    return (
      <div className="min-h-screen grid place-items-center p-6 bg-(--ui-bg)">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-bold text-(--ui-text)">Portal unavailable</h1>
          <p className="text-(--ui-text-muted)">{configErr}</p>
        </div>
      </div>
    );
  }

  if (!config || auth.bootstrapping) {
    return (
      <div className="min-h-screen grid place-items-center bg-(--ui-bg) text-(--ui-text-muted)">
        Loading portal…
      </div>
    );
  }

  const labels = config.portal_labels || {};
  const storeName = config.tenant?.name || tenantSlug;
  const logoUrl = config.branding?.logo_url;
  const enabledTabs = Array.isArray(config.enabled_tabs) ? config.enabled_tabs : [];

  const needsChrome = auth.isAuthenticated;

  return (
    <div className="min-h-screen bg-(--ui-bg) text-(--ui-text)">
      <header className="bg-(--ui-surface) border-b border-(--ui-border)">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to={`/portal/${tenantSlug}`} className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={storeName} className="h-9 w-9 rounded-(--ui-radius-sm) object-cover" />
            ) : (
              <div className="h-9 w-9 rounded-(--ui-radius-sm) bg-(--ui-primary) text-(--ui-on-primary) grid place-items-center font-bold">
                {storeName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="text-sm text-(--ui-text-muted)">{labels.portal_title || "Customer Portal"}</div>
              <div className="text-lg font-semibold">{storeName}</div>
            </div>
          </Link>
          {auth.isAuthenticated && (
            <div className="flex items-center gap-3">
              <div className="text-sm text-(--ui-text-muted) hidden sm:block">
                {auth.customer?.name || auth.customer?.email}
              </div>
              <button
                type="button"
                onClick={auth.logout}
                className="text-sm text-(--ui-text) hover:bg-(--ui-muted-surface) px-3 py-1.5 border border-(--ui-border-strong) rounded-full"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {needsChrome && (
        <nav className="bg-(--ui-surface) border-b border-(--ui-border)">
          <div className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
            <NavLink
              end
              to={`/portal/${tenantSlug}`}
              className={({ isActive }) =>
                `px-4 py-3 text-sm font-medium border-b-2 ${
                  isActive ? "border-(--ui-primary) text-(--ui-text)" : "border-transparent text-(--ui-text-muted)"
                }`
              }
            >
              Dashboard
            </NavLink>
            {enabledTabs.map((tab) => {
              const label = labels[TAB_LABEL_KEYS[tab]] || tab;
              return (
                <NavLink
                  key={tab}
                  to={`/portal/${tenantSlug}/${TAB_PATHS[tab] || tab}`}
                  className={({ isActive }) =>
                    `px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
                      isActive
                        ? "border-(--ui-primary) text-(--ui-text)"
                        : "border-transparent text-(--ui-text-muted)"
                    }`
                  }
                >
                  {label}
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Outlet context={{ config, enabledTabs, labels, storeName, tenantSlug }} />
      </main>
    </div>
  );
}

export default function PortalLayout() {
  const { tenantSlug } = useParams();
  return (
    <PortalAuthProvider tenantSlug={tenantSlug}>
      <PortalShell />
    </PortalAuthProvider>
  );
}
