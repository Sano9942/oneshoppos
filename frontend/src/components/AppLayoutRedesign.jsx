import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, LogOut, Moon, Search, Sun, User, UserCircle } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { useAuth } from "../auth/AuthProvider";
import { SHOPIFY_NAV_GROUPS } from "../ui/nav-config";
import { Input } from "../ui/primitives";
import { getTheme, toggleTheme } from "../utils/theme";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Breadcrumbs from "../ui/Breadcrumbs";
import ContextSwitcher from "./ContextSwitcher";
import NotificationBell from "./NotificationBell";

function ProfileDropdown({ employee, logout, navigate }) {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="ui-focus-ring flex items-center gap-2 rounded-lg border border-(--ui-border) px-2.5 py-1.5 text-xs font-medium text-(--ui-text) hover:bg-(--ui-muted-surface) transition cursor-pointer"
      >
        <UserCircle size={16} />
        <span>{employee?.name || "Employee"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-(--ui-border) bg-(--ui-surface) py-1 shadow-lg z-50">
          <div className="px-3 py-2 border-b border-(--ui-border)">
            <p className="text-sm font-semibold text-(--ui-text)">{employee?.name}</p>
            <p className="text-xs text-(--ui-text-muted)">
              {employee?.role_id === 1 ? "Administrator" : employee?.role_id === 2 ? "Manager" : "Cashier"}
            </p>
          </div>
          <button
            onClick={() => { setOpen(false); navigate("/profile"); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-(--ui-text) hover:bg-(--ui-muted-surface) cursor-pointer"
          >
            <User size={14} /> My Profile
          </button>
          <button
            onClick={() => { const next = toggleTheme(); setThemeState(next); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-(--ui-text) hover:bg-(--ui-muted-surface) cursor-pointer"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <div className="border-t border-(--ui-border) mt-1 pt-1">
            <button
              onClick={async () => { setOpen(false); await logout(); navigate("/login", { replace: true }); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-(--ui-muted-surface) cursor-pointer"
            >
              <LogOut size={14} /> Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppLayoutRedesign() {
  const location = useLocation();
  const navigate = useNavigate();
  const { employee, hasPerm, logout, authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  const [collapsed, setCollapsed] = useState(false);

  const nav = useMemo(
    () =>
      SHOPIFY_NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
          (it) =>
            (!it.requiredPerm || hasPerm(it.requiredPerm)) &&
            (!it.requiredFlag || Boolean(flags[it.requiredFlag])),
        ),
      })).filter((g) => g.items.length),
    [flags, hasPerm],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-(--ui-bg)">
      <aside
        className={`${collapsed ? "w-20" : "w-72"} relative flex h-full flex-col border-r border-(--ui-border) bg-(--ui-surface) transition-all`}
      >
        <button
          className="ui-focus-ring absolute -right-3 top-5 rounded-full border border-(--ui-border) bg-(--ui-surface) p-1 text-(--ui-text-muted) shadow"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        <div className="border-b border-(--ui-border) px-4 py-4">
          <div className="text-sm font-semibold tracking-wide text-(--ui-text-muted)">
            SANOPOS
          </div>
          {!collapsed ? (
            <div className="mt-1 text-lg font-semibold text-(--ui-text)">
              Admin
            </div>
          ) : null}
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto p-3">
          {nav.map((group) => (
            <div key={group.label}>
              {!collapsed ? (
                <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-(--ui-text-muted)">
                  {group.label}
                </p>
              ) : null}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = location.pathname.startsWith(item.path);
                  const linkClass = `flex items-center gap-2 rounded-[var(--ui-radius-sm)] px-2.5 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-emerald-100 text-emerald-800"
                      : "text-(--ui-text) hover:bg-(--ui-muted-surface)"
                  } ${collapsed ? "justify-center" : ""}`;
                  return item.newTab ? (
                    <a
                      key={item.name}
                      href={item.path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClass}
                    >
                      <Icon size={16} />
                      {!collapsed ? <span>{item.name}</span> : null}
                    </a>
                  ) : (
                    <NavLink
                      key={item.name}
                      to={item.path}
                      className={linkClass}
                    >
                      <Icon size={16} />
                      {!collapsed ? <span>{item.name}</span> : null}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-(--ui-border) bg-(--ui-surface) px-5">
          <div className="w-full max-w-xl">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-2.5 text-(--ui-text-muted)"
              />
              <Input
                className="pl-8"
                placeholder="Search products, orders, customers"
              />
            </div>
          </div>
          <div className="ml-4 flex items-center gap-4">
            <ContextSwitcher />
            <NotificationBell />
            <ProfileDropdown employee={employee} logout={logout} navigate={navigate} />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4">
          <Breadcrumbs />
          <ErrorBoundary level="page">
            <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-500 shadow-sm">Loading...</div></div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
