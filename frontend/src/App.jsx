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
import Attendance from "./pages/Attendance";
import Reports, { ReportTabStandalone } from "./pages/Reports";
import Returns from "./pages/Returns";
import ReturnedStock from "./pages/ReturnedStock";
import ActionHistory from "./pages/ActionHistory";
import PlaceholderPage from "./pages/PlaceholderPage";
import Administrator from "./pages/Administrator";
import AttributeSets from "./pages/AttributeSets";
import ReceiptTemplates from "./pages/ReceiptTemplates";

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
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/brands" element={<Brands />} />

          {/* New XStak Placeholder Routes */}
          <Route path="/orders" element={<PlaceholderPage />} />
          <Route path="/lookup" element={<PlaceholderPage />} />
          <Route path="/custom-fields" element={<PlaceholderPage />} />
          <Route path="/attribute-sets" element={<AttributeSets />} />
          <Route path="/returned-stock" element={<ReturnedStock />} />
          <Route path="/action-history" element={<ActionHistory />} />
          <Route
            path="/reports/sales-summary"
            element={<ReportTabStandalone tabId="sales-summary" />}
          />
          <Route
            path="/reports/sales-detail"
            element={<ReportTabStandalone tabId="sales-detail" />}
          />
          <Route
            path="/reports/sales-and-stock"
            element={<ReportTabStandalone tabId="sales-stock" />}
          />
          <Route
            path="/reports/inventory-dump"
            element={<ReportTabStandalone tabId="inventory-dump" />}
          />
          <Route
            path="/reports/category-wise"
            element={<ReportTabStandalone tabId="category-wise" />}
          />
          <Route
            path="/reports/product-specification"
            element={<ReportTabStandalone tabId="product-spec" />}
          />
          <Route
            path="/reports/order-wise"
            element={<ReportTabStandalone tabId="order-wise" />}
          />
          <Route
            path="/reports/replenishment"
            element={<ReportTabStandalone tabId="replenishment" />}
          />
          <Route
            path="/reports/on-hand-inventory"
            element={<ReportTabStandalone tabId="on-hand" />}
          />
          <Route
            path="/reports/customer-details"
            element={<ReportTabStandalone tabId="customer-details" />}
          />
          <Route
            path="/reports/customer-wise"
            element={<ReportTabStandalone tabId="customer-wise" />}
          />
          <Route
            path="/reports/supplier-wise"
            element={<ReportTabStandalone tabId="supplier-wise" />}
          />
          <Route
            path="/reports/inventory-loss"
            element={<ReportTabStandalone tabId="inventory-loss" />}
          />
          <Route
            path="/reports/item-wise"
            element={<ReportTabStandalone tabId="item-wise" />}
          />
          <Route
            path="/reports/wastage"
            element={<ReportTabStandalone tabId="wastage" />}
          />
          <Route
            path="/reports/product-movement"
            element={<ReportTabStandalone tabId="product-movement" />}
          />
          <Route path="/reports/parent-report" element={<PlaceholderPage />} />
          <Route
            path="/reports/product-performance"
            element={<ReportTabStandalone tabId="product-performance" />}
          />
          <Route path="/barcode-templates" element={<PlaceholderPage />} />
          <Route path="/receipt-templates" element={<ReceiptTemplates />} />
          <Route path="/partners" element={<PlaceholderPage />} />
          <Route path="/shopcast" element={<PlaceholderPage />} />
          <Route path="/administrator" element={<Administrator />} />
          <Route path="/action-history" element={<PlaceholderPage />} />

          {/* Keep old legacy routes around safely just in case */}
          <Route path="/reports" element={<Reports />} />
          <Route path="/returns" element={<Returns />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
