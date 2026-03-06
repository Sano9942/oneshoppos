import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { Home, LogOut, Server, Shield } from "lucide-react";
import { clearAdminSession, getAdminToken, getAdminSession } from "./AdminLogin";

const NAV_ITEMS = [
  { name: "Dashboard", path: "/admin", icon: Home, end: true },
  { name: "Tenants", path: "/admin/tenants", icon: Server },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const token = getAdminToken();

  if (!token) return <Navigate to="/admin/login" replace />;

  const admin = getAdminSession()?.admin || null;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-slate-900">
        <div className="border-b border-slate-700 px-4 py-4">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-violet-400" />
            <span className="text-sm font-bold tracking-wide text-slate-300">
              SANOPOS
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">Super Admin</p>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-violet-600 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`
                }
              >
                <Icon size={16} />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-700 p-3">
          <button
            onClick={() => {
              clearAdminSession();
              navigate("/admin/login", { replace: true });
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-red-400"
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
          {admin && (
            <p className="mt-2 truncate px-3 text-xs text-slate-600">
              {admin.email}
            </p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
