import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Package, BarChart3 } from "lucide-react";

import POS from "./pages/POS";
import Inventory from "./pages/Inventory";
import Reports from "./pages/Reports";

function Sidebar() {
  const location = useLocation();

  const navItems = [
    { path: "/", label: "Point of Sale", icon: <ShoppingCart size={20} /> },
    { path: "/inventory", label: "Inventory", icon: <Package size={20} /> },
    { path: "/reports", label: "Reports", icon: <BarChart3 size={20} /> },
  ];

  return (
    <div className="w-64 bg-slate-900 text-white min-h-screen flex flex-col shadow-xl">
      <div className="p-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LayoutDashboard className="text-blue-400" />
          OneShopPOS
        </h1>
      </div>
      
      <nav className="flex-1 px-4 mt-6">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 mb-2 rounded-lg transition-colors ${
                isActive 
                  ? "bg-blue-600 text-white shadow-md font-medium" 
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 text-xs text-slate-500 text-center border-t border-slate-800">
        v1.0.0
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="flex h-screen w-screen bg-slate-50 font-sans overflow-hidden text-slate-800">
        <Sidebar />
        <main className="flex-1 h-screen overflow-hidden flex flex-col items-start justify-start w-full">
          <Routes>
            <Route path="/" element={<POS />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/reports" element={<Reports />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
