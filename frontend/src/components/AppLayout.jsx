import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  MonitorPlay,
  ShoppingCart,
  Package,
  Truck,
  Receipt,
  Tags,
  Settings,
  Shield,
  Store,
  Users,
  History,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ArrowLeftRight,
  ClipboardList,
  Wallet,
  Clock,
  CircleDot,
  CheckSquare,
  CreditCard,
  Percent,
  Banknote,
} from "lucide-react";

export default function AppLayout() {
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const getExpandedMenuForPath = (path) => {
    if (
      path.startsWith("/inventory") ||
      path.startsWith("/lookup") ||
      path.startsWith("/custom-fields") ||
      path.startsWith("/attribute-sets")
    )
      return "Products";
    if (
      path.startsWith("/purchase-orders") ||
      path.startsWith("/adjustments") ||
      path.startsWith("/transfers") ||
      path.startsWith("/returned-stock")
    )
      return "Stock Control";
    if (path.startsWith("/reports") || path.startsWith("/attendance"))
      return "Reports";
    if (
      path.startsWith("/outlets") ||
      path.startsWith("/employees") ||
      path.startsWith("/barcode") ||
      path.startsWith("/receipt") ||
      path.startsWith("/backup-restore") ||
      path.startsWith("/partners") ||
      path.startsWith("/brands") ||
      path.startsWith("/shopcast")
    )
      return "Setup";
    if (
      path.startsWith("/pos") ||
      path.startsWith("/sales-history") ||
      path.startsWith("/cash-management")
    )
      return "Register";
    return "";
  };

  const [expandedMenu, setExpandedMenu] = useState(() =>
    getExpandedMenuForPath(location.pathname),
  );
  const [employeePerms, setEmployeePerms] = useState([]);

  useEffect(() => {
    try {
      const empStr = localStorage.getItem("currentEmployee");
      if (empStr) {
        const emp = JSON.parse(empStr);
        if (emp && emp.id) {
          fetch(
            `http://localhost:5000/api/roles/${emp.role_id || 3}/permissions`,
          )
            .then((r) => r.json())
            .then((d) => setEmployeePerms(d.permissions || []))
            .catch((err) => console.error("Failed to load perms", err));
        }
      }
    } catch {
      // Ignore localStorage absent or parse errors
    }
  }, []);

  // Auto-expand the correct menu based on the current URL
  const [prevPath, setPrevPath] = useState(location.pathname);

  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname);
    const requiredMenu = getExpandedMenuForPath(location.pathname);
    if (requiredMenu) setExpandedMenu(requiredMenu);
  }

  const toggleSidebar = () => setIsSidebarCollapsed(!isSidebarCollapsed);

  const toggleMenu = (menuName) => {
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      setExpandedMenu(menuName);
    } else {
      setExpandedMenu(expandedMenu === menuName ? "" : menuName);
    }
  };

  // Helper to generate dynamic breadcrumbs
  const getBreadcrumbs = () => {
    const path = location.pathname;
    let moduleName = "Dashboard";

    // Register
    if (path === "/") moduleName = "Dashboard";
    else if (path.startsWith("/pos")) moduleName = "Register > Sell";
    else if (path.startsWith("/sales-history"))
      moduleName = "Register > Sales History";
    else if (path.startsWith("/cash-management"))
      moduleName = "Register > Cash Management";
    // Top levels
    else if (path.startsWith("/orders")) moduleName = "Orders";
    else if (path.startsWith("/categories")) moduleName = "Categories";
    else if (path.startsWith("/suppliers")) moduleName = "Suppliers";
    else if (path.startsWith("/taxes")) moduleName = "Taxes";
    else if (path.startsWith("/customers")) moduleName = "Customers";
    else if (path.startsWith("/administrator")) moduleName = "Administrator";
    else if (path.startsWith("/action-history")) moduleName = "Action History";
    // Products
    else if (path.startsWith("/inventory"))
      moduleName = "Products > Product Listing";
    else if (path.startsWith("/lookup")) moduleName = "Products > LookUp";
    else if (path.startsWith("/custom-fields"))
      moduleName = "Products > Custom Fields/DropDowns";
    else if (path.startsWith("/attribute-sets"))
      moduleName = "Products > Attribute Sets";
    else if (path.startsWith("/supplier-payables"))
      moduleName = "Suppliers > Payables";
    else if (path.startsWith("/promotions"))
      moduleName = "Promotions";
    // Stock Control
    else if (path.startsWith("/purchase-orders"))
      moduleName = "Stock Control > Purchase Orders";
    else if (path.startsWith("/transfers"))
      moduleName = "Stock Control > Inventory Transfer";
    else if (path.startsWith("/adjustments"))
      moduleName = "Stock Control > Stock Adjustments";
    else if (path.startsWith("/returned-stock"))
      moduleName = "Stock Control > Returned Stock";
    // Reports
    else if (path.startsWith("/reports/")) {
      const reportName = path
        .split("/")
        .pop()
        .replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());
      moduleName = `Reports > ${reportName}`;
    } else if (path.startsWith("/attendance"))
      moduleName = "Reports > Employee Attendance";
    // Setup
    else if (path.startsWith("/expenses")) moduleName = "Expenses";
    else if (path.startsWith("/outlets")) moduleName = "Setup > Outlets";
    else if (path.startsWith("/employees")) moduleName = "Setup > Employees";
    else if (path.startsWith("/barcode-templates"))
      moduleName = "Setup > Barcode Templates";
    else if (path.startsWith("/receipt-templates"))
      moduleName = "Setup > Receipt Templates";
    else if (path.startsWith("/backup-restore"))
      moduleName = "Setup > Backup & Restore";
    else if (path.startsWith("/partners")) moduleName = "Setup > Partners";
    else if (path.startsWith("/brands")) moduleName = "Setup > Brands";
    else if (path.startsWith("/shopcast")) moduleName = "Setup > Shopcast";

    return `Shopdesk > ${moduleName}`;
  };

  const navItems = [
    { name: "Dashboard", path: "/", icon: <LayoutDashboard size={18} /> },
    {
      name: "Register",
      icon: <MonitorPlay size={18} />,
      subItems: [
        { name: "Sell", path: "/pos" },
        { name: "Sales History", path: "/sales-history" },
        { name: "Cash Management", path: "/cash-management" },
      ],
    },
    { name: "Orders", path: "/orders", icon: <ShoppingCart size={18} /> },
    { name: "Categories", path: "/categories", icon: <Tags size={18} /> },
    { name: "Suppliers", path: "/suppliers", icon: <Truck size={18} /> },
    { name: "Supplier Payables", path: "/supplier-payables", icon: <CreditCard size={18} />, requiredPerm: "manage_orders" },
    { name: "Promotions", path: "/promotions", icon: <Percent size={18} />, requiredPerm: "manage_inventory" },
    { name: "Expenses", path: "/expenses", icon: <Banknote size={18} /> },
    { name: "Taxes", path: "/taxes", icon: <Settings size={18} /> },
    {
      name: "Products",
      icon: <Package size={18} />,
      subItems: [
        { name: "Product Listing", path: "/inventory" },
        { name: "LookUp", path: "/inventory" },
        {
          name: "Custom Fields/DropDowns",
          path: "/custom-fields",
          disabled: true,
        },
        { name: "Attribute Sets", path: "/attribute-sets" },
      ],
    },
    { name: "Customers", path: "/customers", icon: <Users size={18} /> },
    {
      name: "Stock Control",
      icon: <History size={18} />,
      subItems: [
        { name: "Purchase Orders", path: "/purchase-orders" },
        { name: "Inventory Transfer", path: "/transfers" },
        { name: "Stock Adjustments", path: "/adjustments" },
        { name: "Returned Stock", path: "/returned-stock" },
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
        {
          name: "Product Specification",
          path: "/reports/product-specification",
        },
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
        { name: "Outlets", path: "/outlets" },
        { name: "Employees", path: "/employees" },
        { name: "Barcode Templates", path: "/barcode-templates" },
        { name: "Receipt Templates", path: "/receipt-templates" },
        { name: "Backup & Restore", path: "/backup-restore" },
        { name: "Partners", path: "/partners" },
        { name: "Brands", path: "/brands" },
        { name: "Shopcast", path: "/shopcast" },
      ],
    },
    {
      name: "Administrator",
      path: "/administrator",
      icon: <Shield size={18} />,
      requiredPerm: "manage_employees",
    },
    {
      name: "Action History",
      path: "/action-history",
      icon: <ClipboardList size={18} />,
      requiredPerm: "manage_employees",
    },
    {
      name: "Approvals",
      path: "/approvals",
      icon: <CheckSquare size={18} />,
      requiredPerm: "manage_orders",
    },
  ];

  // Filter based on Permissions
  const hasPerm = (perm) =>
    employeePerms.includes("all_access") || employeePerms.includes(perm);

  const filteredNavItems = navItems
    .filter((item) => {
      if (item.requiredPerm && !hasPerm(item.requiredPerm)) return false;
      return true;
    })
    .map((item) => {
      if (item.subItems) {
        return {
          ...item,
          subItems: item.subItems.filter(
            (sub) => !sub.requiredPerm || hasPerm(sub.requiredPerm),
          ),
        };
      }
      return item;
    });

  return (
    <div className="flex h-screen bg-slate-100 font-sans overflow-hidden">
      {/* Left Sidebar (Dark Theme) */}
      <div
        className={`${isSidebarCollapsed ? "w-20" : "w-64"} bg-[#0B1120] text-slate-300 flex flex-col h-full shadow-2xl z-20 transition-all duration-300 relative`}
      >
        {/* Toggle Button */}
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-6 bg-white border border-slate-200 text-slate-700 p-1 rounded-full shadow-md hover:bg-slate-50 z-30 flex items-center justify-center h-6 w-6"
        >
          {isSidebarCollapsed ? (
            <ChevronRight size={14} />
          ) : (
            <ChevronLeft size={14} />
          )}
        </button>

        {/* Logo Area */}
        <div
          className={`h-16 flex items-center ${isSidebarCollapsed ? "justify-center px-0" : "px-6"} mb-4 sticky top-0 bg-[#0B1120] z-10 overflow-hidden shrink-0`}
        >
          <div className="font-black text-xl tracking-tight text-white flex items-center gap-2 whitespace-nowrap">
            <div className="w-8 h-8 bg-[#7B61FF] rounded-lg flex justify-center items-center text-white shrink-0">
              <span className="font-bold text-lg">X</span>
            </div>
            {!isSidebarCollapsed && (
              <span>
                XStak
                <span className="text-[#7B61FF] text-sm ml-1 align-top font-medium">
                  POS
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pb-8">
          <nav className="flex flex-col px-3 space-y-1">
            {filteredNavItems.map((item) => (
              <div key={item.name}>
                {item.subItems ? (
                  // Accordion Menu Item
                  <>
                    <button
                      onClick={() => toggleMenu(item.name)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        expandedMenu === item.name ||
                        item.subItems.some((i) => i.path === location.pathname)
                          ? "bg-[#7B61FF]/10 text-[#7B61FF]" // Active state uses XStak purple
                          : "hover:bg-slate-800/50 hover:text-white text-slate-300"
                      } ${isSidebarCollapsed ? "justify-center" : ""}`}
                      title={isSidebarCollapsed ? item.name : ""}
                    >
                      <div className="flex items-center gap-3">
                        {item.icon}
                        {!isSidebarCollapsed && <span>{item.name}</span>}
                      </div>
                      {!isSidebarCollapsed && (
                        <ChevronRight
                          size={16}
                          className={`transition-transform duration-200 ${expandedMenu === item.name ? "rotate-90" : ""}`}
                        />
                      )}
                    </button>
                    {/* Sub Menu Items */}
                    {!isSidebarCollapsed && expandedMenu === item.name && (
                      <div className="mt-1 mb-2 ml-4 pl-3 border-l border-slate-700/50 space-y-1">
                        {item.subItems.map((subItem) => {
                          const isSubActive =
                            location.pathname === subItem.path ||
                            (subItem.path === "/pos" && false); // pos handles active by itself visually usually, but technically it breaks layout, except here we just link there.
                          return (
                            <NavLink
                              key={subItem.name}
                              to={subItem.disabled ? "#" : subItem.path}
                              onClick={(e) => {
                                if (subItem.disabled) e.preventDefault();
                              }}
                              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                                subItem.disabled
                                  ? "text-slate-500 cursor-not-allowed opacity-60"
                                  : isSubActive
                                    ? "text-white bg-slate-800/80 font-semibold"
                                    : "text-slate-400 hover:text-white hover:bg-slate-800/30"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <CircleDot
                                  size={10}
                                  className={
                                    isSubActive && !subItem.disabled
                                      ? "text-[#7B61FF]"
                                      : "text-transparent"
                                  }
                                />
                                {subItem.name}
                              </div>
                              {subItem.disabled && (
                                <span className="text-[9px] uppercase font-bold tracking-wider bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                                  Soon
                                </span>
                              )}
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  // Standard NavLink
                  <NavLink
                    to={item.disabled ? "#" : item.path}
                    onClick={(e) => {
                      if (item.disabled) e.preventDefault();
                    }}
                    className={({ isActive }) =>
                      `w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        item.disabled
                          ? "text-slate-500 cursor-not-allowed opacity-60"
                          : isActive
                            ? "bg-[#7B61FF] text-white shadow-md shadow-[#7B61FF]/20"
                            : "hover:bg-slate-800/50 hover:text-white text-slate-300"
                      } ${isSidebarCollapsed ? "justify-center" : ""}`
                    }
                    title={isSidebarCollapsed ? item.name : ""}
                  >
                    <div className="flex items-center gap-3">
                      {item.icon}
                      {!isSidebarCollapsed && <span>{item.name}</span>}
                    </div>
                    {!isSidebarCollapsed && item.disabled && (
                      <span className="text-[9px] uppercase font-bold tracking-wider bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                        Soon
                      </span>
                    )}
                  </NavLink>
                )}
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom User Area */}
        <div
          className={`p-4 bg-[#0B1120] sticky bottom-0 shrink-0 ${isSidebarCollapsed ? "flex justify-center" : ""}`}
        >
          {!isSidebarCollapsed && (
            <div className="text-xs text-slate-500 space-y-1 text-center border-t border-slate-800/50 pt-4 pb-2">
              <p>© 2023 XStak Inc.</p>
              <div className="flex justify-center gap-2">
                <a href="#" className="hover:text-white">
                  Terms of Service
                </a>
                <a href="#" className="hover:text-white">
                  Privacy Policy
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-10 shadow-sm shrink-0">
          <div className="flex flex-col justify-center">
            {/* Module Switcher & Breadcrumbs */}
            <div className="flex items-center gap-3 text-sm">
              <button className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold px-3 py-1.5 rounded-md transition-colors border border-slate-200 shadow-sm">
                <LayoutDashboard size={14} className="text-slate-500" />
                Point of Sale
                <ChevronDown size={14} className="text-slate-400" />
              </button>

              <div className="text-slate-400 font-medium">
                {getBreadcrumbs()}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <button className="flex items-center gap-2 bg-[#7B61FF] hover:bg-[#6A50E5] text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm shadow-[#7B61FF]/20">
              <RefreshCw size={14} />
              Sync Data
            </button>

            <div className="flex items-center gap-2 text-slate-700 hover:text-slate-900 font-semibold text-sm transition-colors cursor-pointer">
              One Shop-The Toy Store
              <ChevronDown size={16} className="text-slate-400" />
            </div>

            <div className="w-8 h-8 rounded-full bg-slate-800 flex flex-col items-center justify-center text-white font-bold text-sm cursor-pointer shadow-sm">
              <User size={16} />
            </div>
          </div>
        </header>

        {/* Page Content Viewport */}
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

function User(props) {
  // SVG for user icon if we don't import from lucide up top. wait we can import User from lucide-react.
  // Let's add User to imports.
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
