import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Inventory from "./pages/Inventory";
import POS from "./pages/POS";
import Dashboard from "./pages/Dashboard";
import Suppliers from "./pages/Suppliers";
import PurchaseOrders from "./pages/PurchaseOrders";
import AppLayout from "./components/AppLayout";
import Taxes from "./pages/Taxes";
import Categories from "./pages/Categories";
import Outlets from "./pages/Outlets";
import Employees from "./pages/Employees";
import Brands from "./pages/Brands";
import StockAdjustments from "./pages/StockAdjustments";
import Transfers from "./pages/Transfers";
import SalesHistory from "./pages/SalesHistory";
import CashManagement from "./pages/CashManagement";
import Customers from "./pages/Customers";
import Reports from "./pages/Reports";

function App() {
  return (
    <Router>
      <Routes>
        {/* POS operates outside the main Dashboard layout for maximum screen real-estate */}
        <Route path="/pos" element={<POS />} />

        {/* The Xstak Dashboard Layout wraps all other routes */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/adjustments" element={<StockAdjustments />} />
          <Route path="/transfers" element={<Transfers />} />
          <Route path="/sales-history" element={<SalesHistory />} />
          <Route path="/cash-management" element={<CashManagement />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />

          {/* New Implementation Routes */}
          <Route path="/categories" element={<Categories />} />
          <Route path="/taxes" element={<Taxes />} />
          <Route path="/outlets" element={<Outlets />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/brands" element={<Brands />} />
          <Route path="/reports" element={<Reports />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
