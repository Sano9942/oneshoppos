import {
  LayoutDashboard,
  MonitorPlay,
  ShoppingCart,
  Package,
  Users,
  History,
  Receipt,
  Settings,
  Shield,
  BookOpen,
  UserPlus,
  FileText,
} from "lucide-react";

export const SHOPIFY_NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ name: "Dashboard", path: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Commerce",
    items: [
      { name: "POS", path: "/pos", icon: MonitorPlay },
      {
        name: "Orders",
        path: "/orders",
        icon: ShoppingCart,
        requiredPerm: "manage_orders",
      },
      { name: "Customers", path: "/customers", icon: Users },
      {
        name: "Inventory",
        path: "/inventory",
        icon: Package,
        requiredPerm: "manage_inventory",
      },
      {
        name: "Stock Control",
        path: "/purchase-orders",
        icon: History,
        requiredPerm: "manage_orders",
      },
    ],
  },
  {
    label: "Insights",
    items: [
      { name: "Reports", path: "/reports", icon: Receipt },
      {
        name: "Accounting",
        path: "/accounting",
        icon: BookOpen,
        requiredPerm: "view_reports",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        name: "CRM",
        path: "/crm",
        icon: UserPlus,
        requiredPerm: "manage_orders",
        requiredFlag: "crm_quotations",
      },
      {
        name: "HR",
        path: "/hr/leave",
        icon: FileText,
        requiredPerm: "manage_employees",
        requiredFlag: "advanced_hr",
      },
      {
        name: "Setup",
        path: "/outlets",
        icon: Settings,
        requiredPerm: "manage_employees",
      },
      {
        name: "Admin",
        path: "/administrator",
        icon: Shield,
        requiredPerm: "manage_employees",
      },
    ],
  },
];
