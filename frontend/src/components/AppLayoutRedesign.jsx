import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search, User } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { SHOPIFY_NAV_GROUPS } from "../ui/nav-config";
import { Input } from "../ui/primitives";
import useFeatureFlags from "../hooks/useFeatureFlags";
import ContextSwitcher from "./ContextSwitcher";
import NotificationBell from "./NotificationBell";

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
        className={`${collapsed ? "w-20" : "w-72"} relative flex h-full flex-col border-r border-(--ui-border) bg-white transition-all`}
      >
        <button
          className="ui-focus-ring absolute -right-3 top-5 rounded-full border border-(--ui-border) bg-white p-1 text-(--ui-text-muted) shadow"
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
        <header className="flex h-16 items-center justify-between border-b border-(--ui-border) bg-white px-5">
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
            <button
              className="ui-focus-ring rounded-md px-2 py-1 text-xs text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
              onClick={async () => {
                await logout();
                navigate("/login", { replace: true });
              }}
            >
              Logout
            </button>
            <div className="flex items-center gap-2 rounded-md border border-(--ui-border) px-2 py-1.5 text-xs">
              <User size={14} />
              <span>{employee?.name || "Employee"}</span>
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
