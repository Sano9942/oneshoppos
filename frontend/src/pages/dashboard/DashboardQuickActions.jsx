import { useNavigate } from "react-router-dom";
import { MonitorPlay, Receipt, Banknote, Package, Users } from "lucide-react";

const ACTIONS = {
  pos: { label: "Open POS", icon: MonitorPlay, path: "/pos", newTab: true },
  reports: { label: "Reports", icon: Receipt, path: "/reports" },
  shift: { label: "Cash Management", icon: Banknote, path: "/cash-management" },
  products: { label: "Add Product", icon: Package, path: "/inventory" },
  employees: { label: "Employees", icon: Users, path: "/employees" },
};

const ROLE_ACTIONS = {
  admin: ["pos", "reports", "shift", "products", "employees"],
  manager: ["pos", "reports", "shift"],
  cashier: ["pos"],
};

export function DashboardQuickActions({ isAdmin, isManager }) {
  const navigate = useNavigate();
  const role = isAdmin ? "admin" : isManager ? "manager" : "cashier";
  const keys = ROLE_ACTIONS[role];

  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((key) => {
        const { label, icon: Icon, path, newTab } = ACTIONS[key];
        return (
          <button
            key={key}
            onClick={() => newTab ? window.open(path, "_blank") : navigate(path)}
            className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-4 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)"
          >
            <Icon size={15} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
