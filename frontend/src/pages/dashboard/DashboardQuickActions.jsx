import { useNavigate } from "react-router-dom";
import { MonitorPlay, Receipt, Banknote, Package, Users } from "lucide-react";

// W0b C3 (role audit): each shortcut is gated by the permission that gates
// its target page/data, not by an inferred role. `perm: null` = any
// authenticated employee (the target route has no permission guard).
const ACTIONS = {
  pos: { label: "Open POS", icon: MonitorPlay, path: "/pos", newTab: true, perm: null },
  reports: { label: "Reports", icon: Receipt, path: "/reports", perm: ["view_sales_reports", "view_inventory_reports", "view_financial_reports", "view_hr_reports", "view_customer_reports"] },
  shift: { label: "Cash Management", icon: Banknote, path: "/cash-management", perm: "view_sales_reports" },
  products: { label: "Add Product", icon: Package, path: "/inventory", perm: "manage_inventory" },
  employees: { label: "Employees", icon: Users, path: "/employees", perm: "all_access" },
};

export function DashboardQuickActions({ hasPerm }) {
  const navigate = useNavigate();
  const keys = Object.keys(ACTIONS).filter(
    (key) => !ACTIONS[key].perm || (typeof hasPerm === "function" && hasPerm(ACTIONS[key].perm))
  );

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
