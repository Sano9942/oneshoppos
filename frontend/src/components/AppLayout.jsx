import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Banknote,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  MonitorPlay,
  Package,
  Percent,
  Receipt,
  RefreshCw,
  Settings,
  Shield,
  ShoppingCart,
  Tags,
  Truck,
  Users,
  History,
  User,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

const API = "http://localhost:5000";

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { employee, hasPerm, authHeaders, logout } = useAuth();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [featureFlags, setFeatureFlags] = useState({
    backup_restore: true,
    e_invoicing_export: true,
    supplier_payables: true,
    approvals: true,
  });

  const getExpandedMenuForPath = (path) => {
    if (
      path.startsWith("/inventory") ||
      path.startsWith("/lookup") ||
      path.startsWith("/custom-fields") ||
      path.startsWith("/attribute-sets")
    ) return "Products";
    if (
      path.startsWith("/purchase-orders") ||
      path.startsWith("/adjustments") ||
      path.startsWith("/transfers") ||
      path.startsWith("/returned-stock")
    ) return "Stock Control";
    if (path.startsWith("/reports") || path.startsWith("/attendance")) return "Reports";
    if (
      path.startsWith("/outlets") ||
      path.startsWith("/employees") ||
      path.startsWith("/barcode") ||
      path.startsWith("/receipt") ||
      path.startsWith("/backup-restore") ||
      path.startsWith("/integrations") ||
      path.startsWith("/partners") ||
      path.startsWith("/brands") ||
      path.startsWith("/shopcast")
    ) return "Setup";
    if (
      path.startsWith("/pos") ||
      path.startsWith("/sales-history") ||
      path.startsWith("/cash-management")
    ) return "Register";
    return "";
  };

  const [expandedMenu, setExpandedMenu] = useState(() =>
    getExpandedMenuForPath(location.pathname),
  );
  const [prevPath, setPrevPath] = useState(location.pathname);

  useEffect(() => {
    fetch(`${API}/api/feature-flags`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setFeatureFlags((prev) => {
          const next = { ...prev };
          (d.flags || []).forEach((f) => {
            next[f.key] = Number(f.enabled || 0) === 1;
          });
          return next;
        });
      })
      .catch(() => {
        // Keep defaults when endpoint unavailable.
      });
  }, [authHeaders]);

  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname);
    const requiredMenu = getExpandedMenuForPath(location.pathname);
    if (requiredMenu) setExpandedMenu(requiredMenu);
  }

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const getBreadcrumbs = () => {
    const path = location.pathname;
    let moduleName = "Dashboard";
    if (path.startsWith("/dashboard")) moduleName = "Dashboard";
    else if (path.startsWith("/pos")) moduleName = "Register > Sell";
    else if (path.startsWith("/sales-history")) moduleName = "Register > Sales History";
    else if (path.startsWith("/cash-management")) moduleName = "Register > Cash Management";
    else if (path.startsWith("/orders")) moduleName = "Orders";
    else if (path.startsWith("/categories")) moduleName = "Categories";
    else if (path.startsWith("/suppliers")) moduleName = "Suppliers";
    else if (path.startsWith("/taxes")) moduleName = "Taxes";
    else if (path.startsWith("/customers")) moduleName = "Customers";
    else if (path.startsWith("/administrator")) moduleName = "Administrator";
    else if (path.startsWith("/action-history")) moduleName = "Action History";
    else if (path.startsWith("/inventory")) moduleName = "Products > Product Listing";
    else if (path.startsWith("/lookup")) moduleName = "Products > LookUp";
    else if (path.startsWith("/custom-fields")) moduleName = "Products > Custom Fields/DropDowns";
    else if (path.startsWith("/attribute-sets")) moduleName = "Products > Attribute Sets";
    else if (path.startsWith("/supplier-payables")) moduleName = "Suppliers > Payables";
    else if (path.startsWith("/promotions")) moduleName = "Promotions";
    else if (path.startsWith("/purchase-orders")) moduleName = "Stock Control > Purchase Orders";
    else if (path.startsWith("/transfers")) moduleName = "Stock Control > Inventory Transfer";
    else if (path.startsWith("/adjustments")) moduleName = "Stock Control > Stock Adjustments";
    else if (path.startsWith("/returned-stock")) moduleName = "Stock Control > Returned Stock";
    else if (path.startsWith("/reports/")) {
      const reportName = path
        .split("/")
        .pop()
        .replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());
      moduleName = `Reports > ${reportName}`;
    } else if (path.startsWith("/attendance")) moduleName = "Reports > Employee Attendance";
    else if (path.startsWith("/expenses")) moduleName = "Expenses";
    else if (path.startsWith("/outlets")) moduleName = "Setup > Outlets";
    else if (path.startsWith("/employees")) moduleName = "Setup > Employees";
    else if (path.startsWith("/barcode-templates")) moduleName = "Setup > Barcode Templates";
    else if (path.startsWith("/receipt-templates")) moduleName = "Setup > Receipt Templates";
    else if (path.startsWith("/backup-restore")) moduleName = "Setup > Backup & Restore";
    else if (path.startsWith("/integrations/shopify")) moduleName = "Setup > Shopify Integration";
    else if (path.startsWith("/partners")) moduleName = "Setup > Partners";
    else if (path.startsWith("/brands")) moduleName = "Setup > Brands";
    else if (path.startsWith("/shopcast")) moduleName = "Setup > Shopcast";
    return `Shopdesk > ${moduleName}`;
  };

  const navItems = [
    { name: "Dashboard", path: "/dashboard", icon: <LayoutDashboard size={18} /> },
    {
      name: "Register",
      icon: <MonitorPlay size={18} />,
      subItems: [
        { name: "Sell", path: "/pos" },
        { name: "Sales History", path: "/sales-history" },
        { name: "Cash Management", path: "/cash-management" },
      ],
    },
    { name: "Orders", path: "/orders", icon: <ShoppingCart size={18} />, requiredPerm: "manage_orders" },
    { name: "Categories", path: "/categories", icon: <Tags size={18} />, requiredPerm: "manage_inventory" },
    { name: "Suppliers", path: "/suppliers", icon: <Truck size={18} />, requiredPerm: "manage_orders" },
    { name: "Supplier Payables", path: "/supplier-payables", icon: <CreditCard size={18} />, requiredPerm: "manage_orders", requiredFlag: "supplier_payables" },
    { name: "Promotions", path: "/promotions", icon: <Percent size={18} />, requiredPerm: "manage_inventory" },
    { name: "Expenses", path: "/expenses", icon: <Banknote size={18} />, requiredPerm: "manage_inventory" },
    { name: "Taxes", path: "/taxes", icon: <Settings size={18} />, requiredPerm: "manage_inventory" },
    {
      name: "Products",
      icon: <Package size={18} />,
      subItems: [
        { name: "Product Listing", path: "/inventory", requiredPerm: "manage_inventory" },
        { name: "LookUp", path: "/inventory", requiredPerm: "manage_inventory" },
        { name: "Custom Fields/DropDowns", path: "/custom-fields", disabled: true },
        { name: "Attribute Sets", path: "/attribute-sets" },
      ],
    },
    { name: "Customers", path: "/customers", icon: <Users size={18} /> },
    {
      name: "Stock Control",
      icon: <History size={18} />,
      subItems: [
        { name: "Purchase Orders", path: "/purchase-orders", requiredPerm: "manage_orders" },
        { name: "Inventory Transfer", path: "/transfers", requiredPerm: "manage_inventory" },
        { name: "Stock Adjustments", path: "/adjustments", requiredPerm: "manage_inventory" },
        { name: "Returned Stock", path: "/returned-stock", requiredPerm: "manage_orders" },
      ],
    },
    {
      name: "Reports",
      icon: <Receipt size={18} />,
      subItems: [
        { name: "Sales Summary", path: "/reports/sales-summary" },
        { name: "Sales Detail", path: "/reports/sales-detail" },
        { name: "Sales And Stock", path: "/reports/sales-and-stock" },
        { name: "Inventory Dump", path: "/reports/inventory-dump" },
        { name: "Category Wise", path: "/reports/category-wise" },
        { name: "Product Specification", path: "/reports/product-specification" },
        { name: "Employee Attendance", path: "/attendance" },
        { name: "Order Wise", path: "/reports/order-wise" },
        { name: "Replenishment", path: "/reports/replenishment" },
        { name: "On Hand Inventory", path: "/reports/on-hand-inventory" },
        { name: "Customer Details", path: "/reports/customer-details" },
        { name: "Customer Wise", path: "/reports/customer-wise" },
        { name: "Supplier Wise", path: "/reports/supplier-wise" },
        { name: "Inventory Loss", path: "/reports/inventory-loss" },
        { name: "Item Wise", path: "/reports/item-wise" },
        { name: "Wastage", path: "/reports/wastage" },
        { name: "Product Movement", path: "/reports/product-movement" },
        { name: "Parent Report", path: "/reports/parent-report" },
        { name: "Product Performance", path: "/reports/product-performance" },
      ],
    },
    {
      name: "Setup",
      icon: <Settings size={18} />,
      subItems: [
        { name: "Outlets", path: "/outlets", requiredPerm: "manage_employees" },
        { name: "Employees", path: "/employees", requiredPerm: "manage_employees" },
        { name: "Barcode Templates", path: "/barcode-templates", requiredPerm: "manage_inventory" },
        { name: "Receipt Templates", path: "/receipt-templates" },
        { name: "Backup & Restore", path: "/backup-restore", requiredPerm: "manage_employees", requiredFlag: "backup_restore" },
        { name: "Shopify Integration", path: "/integrations/shopify", requiredPerm: "manage_inventory" },
        { name: "Partners", path: "/partners" },
        { name: "Brands", path: "/brands", requiredPerm: "manage_inventory" },
        { name: "Shopcast", path: "/shopcast" },
      ],
    },
    { name: "Administrator", path: "/administrator", icon: <Shield size={18} />, requiredPerm: "manage_employees" },
    { name: "Action History", path: "/action-history", icon: <ClipboardList size={18} />, requiredPerm: "manage_employees" },
    { name: "Approvals", path: "/approvals", icon: <CheckSquare size={18} />, requiredPerm: "manage_orders", requiredFlag: "approvals" },
  ];

  const filteredNavItems = navItems
    .filter((item) => {
      if (item.requiredPerm && !hasPerm(item.requiredPerm)) return false;
      if (item.requiredFlag && !featureFlags[item.requiredFlag]) return false;
      return true;
    })
    .map((item) => {
      if (!item.subItems) return item;
      const subs = item.subItems.filter((sub) => {
        if (sub.requiredPerm && !hasPerm(sub.requiredPerm)) return false;
        if (sub.requiredFlag && !featureFlags[sub.requiredFlag]) return false;
        return true;
      });
      if (subs.length === 0) return null;
      return { ...item, subItems: subs };
    })
    .filter(Boolean);

  return (
    <div className="flex h-screen bg-slate-100 font-sans overflow-hidden">
      <div className={`${isSidebarCollapsed ? "w-20" : "w-64"} bg-[#0B1120] text-slate-300 flex flex-col h-full shadow-2xl z-20 transition-all duration-300 relative`}>
        <button
          onClick={() => setIsSidebarCollapsed((v) => !v)}
          className="absolute -right-3 top-6 bg-white border border-slate-200 text-slate-700 p-1 rounded-full shadow-md hover:bg-slate-50 z-30 flex items-center justify-center h-6 w-6"
        >
          {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <div className={`h-16 flex items-center ${isSidebarCollapsed ? "justify-center px-0" : "px-6"} mb-4 sticky top-0 bg-[#0B1120] z-10 overflow-hidden shrink-0`}>
          <div className="font-black text-xl tracking-tight text-white flex items-center gap-2 whitespace-nowrap">
            <div className="w-8 h-8 bg-[#7B61FF] rounded-lg flex justify-center items-center text-white shrink-0">
              <span className="font-bold text-lg">X</span>
            </div>
            {!isSidebarCollapsed && (
              <span>
                XStak
                <span className="text-[#7B61FF] text-sm ml-1 align-top font-medium">POS</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pb-8">
          <nav className="flex flex-col px-3 space-y-1">
            {filteredNavItems.map((item) => (
              <div key={item.name}>
                {item.subItems ? (
                  <>
                    <button
                      onClick={() =>
                        setExpandedMenu((p) => (p === item.name ? "" : item.name))
                      }
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        expandedMenu === item.name || item.subItems.some((i) => i.path === location.pathname)
                          ? "bg-[#7B61FF]/10 text-[#7B61FF]"
                          : "hover:bg-slate-800/50 hover:text-white text-slate-300"
                      } ${isSidebarCollapsed ? "justify-center" : ""}`}
                    >
                      <div className="flex items-center gap-3">
                        {item.icon}
                        {!isSidebarCollapsed && <span>{item.name}</span>}
                      </div>
                      {!isSidebarCollapsed && (
                        <ChevronRight size={16} className={`transition-transform duration-200 ${expandedMenu === item.name ? "rotate-90" : ""}`} />
                      )}
                    </button>
                    {!isSidebarCollapsed && expandedMenu === item.name && (
                      <div className="mt-1 mb-2 ml-4 pl-3 border-l border-slate-700/50 space-y-1">
                        {item.subItems.map((sub) => {
                          const isActive = location.pathname === sub.path;
                          return (
                            <NavLink
                              key={sub.name}
                              to={sub.disabled ? "#" : sub.path}
                              onClick={(e) => sub.disabled && e.preventDefault()}
                              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                                sub.disabled
                                  ? "text-slate-500 cursor-not-allowed opacity-60"
                                  : isActive
                                    ? "text-white bg-slate-800/80 font-semibold"
                                    : "text-slate-400 hover:text-white hover:bg-slate-800/30"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <CircleDot size={10} className={isActive && !sub.disabled ? "text-[#7B61FF]" : "text-transparent"} />
                                {sub.name}
                              </div>
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <NavLink
                    to={item.path}
                    className={({ isActive }) =>
                      `w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-[#7B61FF] text-white shadow-md shadow-[#7B61FF]/20"
                          : "hover:bg-slate-800/50 hover:text-white text-slate-300"
                      } ${isSidebarCollapsed ? "justify-center" : ""}`
                    }
                  >
                    <div className="flex items-center gap-3">
                      {item.icon}
                      {!isSidebarCollapsed && <span>{item.name}</span>}
                    </div>
                  </NavLink>
                )}
              </div>
            ))}
          </nav>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-10 shadow-sm shrink-0">
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-3 text-sm">
              <button className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold px-3 py-1.5 rounded-md transition-colors border border-slate-200 shadow-sm">
                <LayoutDashboard size={14} className="text-slate-500" />
                Point of Sale
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              <div className="text-slate-400 font-medium">{getBreadcrumbs()}</div>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <button className="flex items-center gap-2 bg-[#7B61FF] hover:bg-[#6A50E5] text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm shadow-[#7B61FF]/20">
              <RefreshCw size={14} />
              Sync Data
            </button>

            <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm">
              {employee?.name || "Employee"}
              <ChevronDown size={16} className="text-slate-400" />
            </div>

            <button
              className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-white font-bold text-sm shadow-sm"
              title="User"
            >
              <User size={16} />
            </button>
            <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-slate-700">
              Logout
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-white">
          <div className="h-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold text-slate-800">
                {getBreadcrumbs().split(" > ").pop()}
              </h1>
            </div>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
