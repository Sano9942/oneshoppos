import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import RequireAuth from "./components/RequireAuth";
import RequirePerm from "./components/RequirePerm";
import AppLayout from "./components/AppLayout";
import AccessDenied from "./pages/AccessDenied";
import Administrator from "./pages/Administrator";
import Approvals from "./pages/Approvals";
import Attendance from "./pages/Attendance";
import AttributeSets from "./pages/AttributeSets";
import BackupRestore from "./pages/BackupRestore";
import BarcodeTemplates from "./pages/BarcodeTemplates";
import Brands from "./pages/Brands";
import CashManagement from "./pages/CashManagement";
import Categories from "./pages/Categories";
import Customers from "./pages/Customers";
import Dashboard from "./pages/Dashboard";
import Employees from "./pages/Employees";
import Expenses from "./pages/Expenses";
import Inventory from "./pages/Inventory";
import Login from "./pages/Login";
import Outlets from "./pages/Outlets";
import Orders from "./pages/Orders";
import PlaceholderPage from "./pages/PlaceholderPage";
import POS from "./pages/POS";
import Promotions from "./pages/Promotions";
import PurchaseOrders from "./pages/PurchaseOrders";
import ReceiptTemplates from "./pages/ReceiptTemplates";
import Reports, { ReportTabStandalone } from "./pages/Reports";
import ReturnedStock from "./pages/ReturnedStock";
import Returns from "./pages/Returns";
import SalesHistory from "./pages/SalesHistory";
import ActionHistory from "./pages/ActionHistory";
import StockAdjustments from "./pages/StockAdjustments";
import SupplierPayables from "./pages/SupplierPayables";
import Suppliers from "./pages/Suppliers";
import ShopifyIntegration from "./pages/ShopifyIntegration";
import Taxes from "./pages/Taxes";
import Transfers from "./pages/Transfers";

function HomeRedirect() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  if (isBootstrapping) return null;
  return <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/access-denied" element={<AccessDenied />} />
        <Route
          path="/pos"
          element={
            <RequireAuth>
              <POS />
            </RequireAuth>
          }
        />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/sales-history" element={<SalesHistory />} />
          <Route path="/cash-management" element={<CashManagement />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/attribute-sets" element={<AttributeSets />} />
          <Route
            path="/orders"
            element={
              <RequirePerm perm="manage_orders">
                <Orders />
              </RequirePerm>
            }
          />
          <Route path="/lookup" element={<PlaceholderPage />} />
          <Route path="/custom-fields" element={<PlaceholderPage />} />
          <Route path="/partners" element={<PlaceholderPage />} />
          <Route path="/shopcast" element={<PlaceholderPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/returns" element={<Returns />} />

          <Route
            path="/inventory"
            element={
              <RequirePerm perm="manage_inventory">
                <Inventory />
              </RequirePerm>
            }
          />
          <Route
            path="/adjustments"
            element={
              <RequirePerm perm="manage_inventory">
                <StockAdjustments />
              </RequirePerm>
            }
          />
          <Route
            path="/transfers"
            element={
              <RequirePerm perm="manage_inventory">
                <Transfers />
              </RequirePerm>
            }
          />
          <Route
            path="/promotions"
            element={
              <RequirePerm perm="manage_inventory">
                <Promotions />
              </RequirePerm>
            }
          />
          <Route
            path="/expenses"
            element={
              <RequirePerm perm="manage_inventory">
                <Expenses />
              </RequirePerm>
            }
          />
          <Route
            path="/categories"
            element={
              <RequirePerm perm="manage_inventory">
                <Categories />
              </RequirePerm>
            }
          />
          <Route
            path="/taxes"
            element={
              <RequirePerm perm="manage_inventory">
                <Taxes />
              </RequirePerm>
            }
          />
          <Route
            path="/brands"
            element={
              <RequirePerm perm="manage_inventory">
                <Brands />
              </RequirePerm>
            }
          />
          <Route
            path="/barcode-templates"
            element={
              <RequirePerm perm="manage_inventory">
                <BarcodeTemplates />
              </RequirePerm>
            }
          />

          <Route
            path="/suppliers"
            element={
              <RequirePerm perm="manage_orders">
                <Suppliers />
              </RequirePerm>
            }
          />
          <Route
            path="/purchase-orders"
            element={
              <RequirePerm perm="manage_orders">
                <PurchaseOrders />
              </RequirePerm>
            }
          />
          <Route
            path="/supplier-payables"
            element={
              <RequirePerm perm="manage_orders">
                <SupplierPayables />
              </RequirePerm>
            }
          />
          <Route
            path="/approvals"
            element={
              <RequirePerm perm="manage_orders">
                <Approvals />
              </RequirePerm>
            }
          />
          <Route
            path="/returned-stock"
            element={
              <RequirePerm perm="manage_orders">
                <ReturnedStock />
              </RequirePerm>
            }
          />

          <Route
            path="/employees"
            element={
              <RequirePerm perm="manage_employees">
                <Employees />
              </RequirePerm>
            }
          />
          <Route
            path="/outlets"
            element={
              <RequirePerm perm="manage_employees">
                <Outlets />
              </RequirePerm>
            }
          />
          <Route
            path="/administrator"
            element={
              <RequirePerm perm="manage_employees">
                <Administrator />
              </RequirePerm>
            }
          />
          <Route
            path="/action-history"
            element={
              <RequirePerm perm="manage_employees">
                <ActionHistory />
              </RequirePerm>
            }
          />
          <Route
            path="/backup-restore"
            element={
              <RequirePerm perm="manage_employees">
                <BackupRestore />
              </RequirePerm>
            }
          />
          <Route
            path="/integrations/shopify"
            element={
              <RequirePerm perm="manage_inventory">
                <ShopifyIntegration />
              </RequirePerm>
            }
          />

          <Route path="/attendance" element={<Attendance />} />
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
          <Route path="/receipt-templates" element={<ReceiptTemplates />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
