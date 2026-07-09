import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  CircleHelp,
  LogOut,
  Menu,
  MonitorPlay,
  Search,
  User,
  UserCircle,
  X,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { useAuth } from "../auth/AuthProvider";
import { readTenantSlug } from "../auth/authStore";
import { SHOPIFY_NAV_GROUPS } from "../ui/nav-config";
import { Drawer } from "../ui/primitives";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Breadcrumbs from "../ui/Breadcrumbs";
import SupportWidget from "../ui/SupportWidget";
import { AIChatPanel } from "../pages/dashboard/AIChatPanel";
import ContextSwitcher from "./ContextSwitcher";
import NotificationBell from "./NotificationBell";
import AnnouncementBanner from "../ui/AnnouncementBanner";
import PlanLimitModalInterceptor from "./PlanLimitModalInterceptor";
import { usePreset } from "../contexts/PresetContext";

// Square-style account panel: full-height slide-over from the right instead
// of a small anchored dropdown. Same actions as the old profile dropdown.
function AccountDrawer({ open, onClose, employee, logout, navigate }) {
  const roleLabel =
    employee?.role_id === 1 ? "Administrator" : employee?.role_id === 2 ? "Manager" : "Cashier";
  return (
    <Drawer open={open} onClose={onClose} title="Account">
      <div className="flex items-center gap-3 border-b border-(--ui-border) pb-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-(--ui-muted-surface) text-(--ui-text-muted)">
          <UserCircle size={24} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-(--ui-text)">
            {employee?.name || "Employee"}
          </p>
          <p className="text-xs text-(--ui-text-muted)">{roleLabel}</p>
        </div>
      </div>
      <div className="mt-2">
        <button
          onClick={() => {
            onClose();
            navigate("/profile");
          }}
          className="ui-focus-ring flex w-full cursor-pointer items-center gap-2.5 rounded-(--ui-radius-sm) px-3 py-2.5 text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface)"
        >
          <User size={16} /> My Profile
        </button>
        <button
          onClick={async () => {
            onClose();
            await logout();
            navigate("/login", { replace: true });
          }}
          className="ui-focus-ring flex w-full cursor-pointer items-center gap-2.5 rounded-(--ui-radius-sm) px-3 py-2.5 text-sm font-medium text-(--ui-danger) hover:bg-(--ui-muted-surface)"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </Drawer>
  );
}

export default function AppLayoutRedesign() {
  const location = useLocation();
  const navigate = useNavigate();
  const { employee, hasPerm, logout, authHeaders, company } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  const { hasMode, labels } = usePreset();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);

  // Preset bootstrap moved to PresetProvider so routes outside AppLayout
  // (e.g. /pos opens in a new tab) also get presetLoaded=true.

  // Restaurant preset (and others) override "Customer" → "Guest" /
  // "Product" → "Menu Item" on page headings via usePreset().label(...).
  // Sidebar nav strings live in nav-config.js with hardcoded English —
  // translate them here so the sidebar matches the page headings.
  const translateNavLabel = useCallback(
    (label) => {
      if (!label || !labels) return label;
      const customer = labels.customer || "Customer";
      const customers = labels.customers || "Customers";
      const product = labels.product || "Product";
      const products = labels.products || "Products";
      const sale = labels.sale || "Sale";
      // "Sales History" is "Invoice History" (singular modifier) in wholesale,
      // "Order History" in cafe, etc. — handle explicitly. "Parked Sales" stays
      // plural ("Parked Invoices").
      return label
        .replace(/Customers/g, customers)
        .replace(/Customer/g, customer)
        .replace(/Products/g, products)
        .replace(/Product/g, product)
        .replace(/Sales History/g, `${sale} History`)
        .replace(/Parked Sales/g, `Parked ${sale}s`);
    },
    [labels],
  );

  const resolvePath = useCallback(
    (path) => (path === "__STOREFRONT__" ? `/store/${readTenantSlug() || ""}` : path),
    [],
  );

  const nav = useMemo(
    () =>
      SHOPIFY_NAV_GROUPS.map((group) => ({
        ...group,
        label: translateNavLabel(group.label),
        items: group.items
          .filter(
            (it) =>
              (!it.requiredPerm || hasPerm(it.requiredPerm)) &&
              (!it.requiredFlag || Boolean(flags[it.requiredFlag])) &&
              (!it.requiredMode || hasMode(it.requiredMode)),
          )
          .map((it) => ({ ...it, name: translateNavLabel(it.name) })),
      })).filter((g) => g.items.length),
    [flags, hasPerm, hasMode, translateNavLabel],
  );

  const isItemActive = useCallback(
    (item) =>
      !item.newTab && location.pathname.startsWith(resolvePath(item.path)),
    [location.pathname, resolvePath],
  );

  // Single-open accordion: the group holding the active route opens on
  // navigation; clicking a group header switches which one is open.
  useEffect(() => {
    const activeGroup = nav.find((g) => g.items.some(isItemActive));
    if (activeGroup) setOpenGroup(activeGroup.label);
  }, [nav, isItemActive]);

  const businessName = company?.company_name || readTenantSlug() || "SanoPOS";
  const saleLabel = labels?.sale || "Sale";

  const leafClass = (active) =>
    `flex items-center gap-2.5 rounded-(--ui-radius-sm) px-2.5 py-2 text-sm transition ${
      active
        ? "bg-[rgba(0,0,0,0.06)] font-semibold text-(--ui-text)"
        : "font-medium text-(--ui-text) hover:bg-(--ui-muted-surface)"
    }`;

  const renderLeaf = (item, { nested = false } = {}) => {
    const Icon = item.icon;
    const resolvedPath = resolvePath(item.path);
    const active = isItemActive(item);
    const cls = `${leafClass(active)} ${nested ? "pl-9" : ""}`;
    return item.newTab ? (
      <a
        key={item.name}
        href={resolvedPath}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
      >
        {!nested && Icon ? <Icon size={16} className="shrink-0 text-(--ui-text-muted)" /> : null}
        <span className="truncate">{item.name}</span>
      </a>
    ) : (
      <NavLink key={item.name} to={resolvedPath} className={cls}>
        {!nested && Icon ? <Icon size={16} className="shrink-0 text-(--ui-text-muted)" /> : null}
        <span className="truncate">{item.name}</span>
      </NavLink>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-(--ui-bg)">
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <aside
        className={`${mobileOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 flex h-full w-[280px] flex-col border-r border-(--ui-border) bg-(--ui-sidebar) transition-transform lg:relative lg:translate-x-0`}
      >
        <button
          className="ui-focus-ring absolute right-3 top-3 rounded-md p-1 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X size={18} />
        </button>

        {/* Account / business switcher + search — Square keeps these at the
            very top of the sidebar instead of a top bar. */}
        <div className="space-y-2 px-3 pb-2 pt-3">
          <button
            onClick={() => setAccountOpen(true)}
            className="ui-focus-ring flex w-full cursor-pointer items-center gap-2.5 rounded-(--ui-radius-md) border border-(--ui-border-strong) bg-white px-3 py-2.5 text-left transition hover:bg-(--ui-muted-surface)"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--ui-primary) text-[11px] font-bold uppercase text-white">
              {String(businessName).slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-(--ui-text)">
                {businessName}
              </span>
              <span className="block truncate text-xs text-(--ui-text-muted)">
                {employee?.name || "Employee"}
              </span>
            </span>
            <UserCircle size={16} className="shrink-0 text-(--ui-text-muted)" />
          </button>
          <ContextSwitcher />
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)"
            />
            <input
              className="ui-focus-ring w-full rounded-full border border-(--ui-border-strong) bg-white py-2 pl-8 pr-3 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted)"
              placeholder="Search"
            />
          </div>
        </div>

        {/* Single-open inline accordion nav */}
        <nav
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-2"
          onClick={(e) => {
            // Close mobile drawer when a nav link is clicked.
            if (e.target.closest("a")) setMobileOpen(false);
          }}
        >
          {nav.map((group) => {
            // Single-item groups render as a direct top-level leaf
            // (e.g. Overview → Dashboard, Online Store → View Storefront).
            if (group.items.length === 1) return renderLeaf(group.items[0]);
            const GroupIcon = group.items[0].icon;
            const expanded = openGroup === group.label;
            const containsActive = group.items.some(isItemActive);
            return (
              <div key={group.label}>
                <button
                  onClick={() => setOpenGroup(expanded ? null : group.label)}
                  aria-expanded={expanded}
                  className={`ui-focus-ring flex w-full cursor-pointer items-center gap-2.5 rounded-(--ui-radius-sm) px-2.5 py-2 text-sm transition ${
                    containsActive && !expanded
                      ? "font-semibold text-(--ui-text)"
                      : "font-medium text-(--ui-text)"
                  } hover:bg-(--ui-muted-surface)`}
                >
                  {GroupIcon ? (
                    <GroupIcon size={16} className="shrink-0 text-(--ui-text-muted)" />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                  <ChevronDown
                    size={14}
                    className={`shrink-0 text-(--ui-text-muted) transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
                {expanded ? (
                  <div className="mt-0.5 space-y-0.5 pb-1">
                    {group.items.map((item) => renderLeaf(item, { nested: true }))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        {/* Fixed bottom: notifications + help, then the persistent primary CTA */}
        <div className="space-y-2 border-t border-(--ui-border) px-3 py-3">
          <div className="flex items-center gap-1">
            <NotificationBell direction="up" />
            <button
              onClick={() => navigate("/my-tickets")}
              className="ui-focus-ring cursor-pointer rounded-full p-2 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text)"
              title="Help & support"
              aria-label="Help & support"
            >
              <CircleHelp size={18} />
            </button>
          </div>
          <a
            href="/pos"
            target="_blank"
            rel="noopener noreferrer"
            className="ui-focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-full bg-(--ui-primary) text-sm font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong)"
          >
            <MonitorPlay size={16} />
            New {saleLabel}
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-only top bar — desktop has no header (Square pattern) */}
        <header className="flex h-14 items-center gap-2 border-b border-(--ui-border) bg-(--ui-bg) px-3 lg:hidden">
          <button
            className="ui-focus-ring rounded-md p-2 text-(--ui-text) hover:bg-(--ui-muted-surface)"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-bold tracking-tight text-(--ui-text)">SanoPOS</span>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-300 px-4 py-5 lg:px-10 lg:py-8">
            <AnnouncementBanner />
            <Breadcrumbs />
            <ErrorBoundary level="page">
              <Suspense
                fallback={
                  <div className="flex min-h-[40vh] items-center justify-center">
                    <div className="rounded-full border border-(--ui-border-strong) bg-white px-4 py-2 text-sm font-medium text-(--ui-text-muted)">
                      Loading...
                    </div>
                  </div>
                }
              >
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <AccountDrawer
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        employee={employee}
        logout={logout}
        navigate={navigate}
      />
      <SupportWidget />
      <AIChatPanel flagEnabled={!!flags.ai_insights} />
      <PlanLimitModalInterceptor />
    </div>
  );
}
