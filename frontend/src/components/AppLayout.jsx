import { NavLink, Outlet, useNavigate } from "react-router-dom";
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
  ArrowLeftRight,
  ClipboardList,
  Wallet,
  Clock,
} from "lucide-react";

export default function AppLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen bg-slate-100 font-sans overflow-hidden">
      {/* Left Sidebar (Dark Theme like Xstak) */}
      <div className="w-64 bg-[#0B1120] text-slate-300 flex flex-col h-full border-r border-slate-800 shadow-2xl z-20 overflow-y-auto">
        {/* Logo Area */}
        <div className="h-16 flex items-center px-6 border-b border-slate-800/50 mb-4 sticky top-0 bg-[#0B1120] z-10">
          <div className="font-black text-xl tracking-tight text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex justify-center items-center text-white">
              <span className="font-bold text-lg">O</span>
            </div>
            OneShop<span className="text-blue-500">POS</span>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 space-y-1 pb-8">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <LayoutDashboard size={18} />
            Dashboard
          </NavLink>

          <NavLink
            to="/pos"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <MonitorPlay size={18} />
            Register (POS)
          </NavLink>

          <div className="pt-4 pb-1">
            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Store Management
            </p>
          </div>

          <NavLink
            to="/inventory"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Package size={18} />
            Inventory
          </NavLink>

          <NavLink
            to="/adjustments"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <History size={18} />
            Stock Adjustments
          </NavLink>

          <NavLink
            to="/transfers"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <ArrowLeftRight size={18} />
            Transfers
          </NavLink>

          <NavLink
            to="/categories"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Tags size={18} />
            Categories
          </NavLink>

          <NavLink
            to="/purchase-orders"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <ShoppingCart size={18} />
            Orders
          </NavLink>

          <NavLink
            to="/suppliers"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Truck size={18} />
            Suppliers
          </NavLink>

          <div className="pt-4 pb-1">
            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Reports & Setup
            </p>
          </div>

          <NavLink
            to="/reports"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Receipt size={18} />
            Reports
          </NavLink>

          <NavLink
            to="/sales-history"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <ClipboardList size={18} />
            Sales History
          </NavLink>

          <NavLink
            to="/cash-management"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Wallet size={18} />
            Cash Management
          </NavLink>

          <NavLink
            to="/returns"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <ArrowLeftRight size={18} />
            Returns
          </NavLink>

          <NavLink
            to="/customers"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Users size={18} />
            Customers
          </NavLink>

          <NavLink
            to="/outlets"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Store size={18} />
            Outlets
          </NavLink>

          <NavLink
            to="/employees"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Users size={18} />
            Employees
          </NavLink>

          <NavLink
            to="/attendance"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Clock size={18} />
            Attendance
          </NavLink>

          <NavLink
            to="/brands"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Tags size={18} />
            Brands
          </NavLink>

          <NavLink
            to="/taxes"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/10 text-blue-400"
                  : "hover:bg-slate-800/50 hover:text-white"
              }`
            }
          >
            <Settings size={18} />
            Taxes
          </NavLink>
        </nav>

        {/* Bottom User Area */}
        <div className="p-4 border-t border-slate-800/50 bg-[#0B1120] sticky bottom-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold text-sm">
              A
            </div>
            <div>
              <p className="text-sm font-medium text-white">Admin User</p>
              <p className="text-xs text-slate-500">v1.2.0 • Online</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/pos")}
              className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors border border-slate-200"
            >
              <MonitorPlay size={16} />
              Point of Sale
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm">
              <RefreshCw size={16} className="text-indigo-200" />
              Sync Data
            </button>

            <div className="h-6 w-px bg-slate-200 mx-2"></div>

            <button className="flex items-center gap-2 text-slate-700 hover:text-slate-900 font-medium text-sm transition-colors">
              One Shop-The Toy Store
              <ChevronDown size={16} className="text-slate-400" />
            </button>
          </div>
        </header>

        {/* Page Content Viewport */}
        <main className="flex-1 overflow-auto bg-slate-50">
          <div className="h-full p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
