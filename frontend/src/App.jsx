import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import RequireAuth from "./components/RequireAuth";
import RequirePerm from "./components/RequirePerm";
import AppLayoutSwitch from "./components/AppLayoutSwitch";
import AccessDenied from "./pages/AccessDenied";
import AdministratorRoute from "./pages/AdministratorRoute";
import Approvals from "./pages/Approvals";
import Attendance from "./pages/Attendance";
import AttributeSetsRoute from "./pages/AttributeSetsRoute";
import BackupRestoreRoute from "./pages/BackupRestoreRoute";
import BarcodeTemplates from "./pages/BarcodeTemplates";
import BrandsRoute from "./pages/BrandsRoute";
import CategoriesRoute from "./pages/CategoriesRoute";
import DashboardRoute from "./pages/DashboardRoute";
import EmployeesRoute from "./pages/EmployeesRoute";
import ExpensesRoute from "./pages/ExpensesRoute";
import InventoryRoute from "./pages/InventoryRoute";
import Login from "./pages/Login";
import OutletsRoute from "./pages/OutletsRoute";
import PlaceholderPage from "./pages/PlaceholderPage";
import PromotionsRoute from "./pages/PromotionsRoute";
import PurchaseOrdersRoute from "./pages/PurchaseOrdersRoute";
import ReceiptTemplates from "./pages/ReceiptTemplates";
import ReportsRoute, { ReportTabStandaloneRoute } from "./pages/ReportsRoute";
import ReturnedStockRoute from "./pages/ReturnedStockRoute";
import ActionHistoryRoute from "./pages/ActionHistoryRoute";
import AccountingRoute from "./pages/AccountingRoute";
import StockAdjustmentsRoute from "./pages/StockAdjustmentsRoute";
import SupplierPayablesRoute from "./pages/SupplierPayablesRoute";
import SuppliersRoute from "./pages/SuppliersRoute";
import ShopifyIntegrationRoute from "./pages/ShopifyIntegrationRoute";
import TaxesRoute from "./pages/TaxesRoute";
import TransfersRoute from "./pages/TransfersRoute";
import CRMRoute from "./pages/CRMRoute";
import QuotationsRoute from "./pages/QuotationsRoute";
import HRManagementRoute from "./pages/HRManagementRoute";
import CompanySettingsRoute from "./pages/CompanySettingsRoute";
import POSRoute from "./pages/POSRoute";
import OrdersRoute from "./pages/OrdersRoute";
import CustomersRoute from "./pages/CustomersRoute";
import SalesHistoryRoute from "./pages/SalesHistoryRoute";
import CashManagementRoute from "./pages/CashManagementRoute";
import ReturnsRoute from "./pages/ReturnsRoute";

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
              <POSRoute />
            </RequireAuth>
          }
        />

        <Route
          element={
              <RequireAuth>
              <AppLayoutSwitch />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/sales-history" element={<SalesHistoryRoute />} />
          <Route path="/cash-management" element={<CashManagementRoute />} />
          <Route path="/customers" element={<CustomersRoute />} />
          <Route
            path="/crm"
            element={
              <RequirePerm perm="manage_orders">
                <CRMRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/quotations"
            element={
              <RequirePerm perm="manage_orders">
                <QuotationsRoute />
              </RequirePerm>
            }
          />
          <Route path="/attribute-sets" element={<AttributeSetsRoute />} />
          <Route
            path="/orders"
            element={
                <RequirePerm perm="manage_orders">
                <OrdersRoute />
              </RequirePerm>
            }
          />
          <Route path="/lookup" element={<PlaceholderPage />} />
          <Route path="/custom-fields" element={<PlaceholderPage />} />
          <Route path="/partners" element={<PlaceholderPage />} />
          <Route path="/shopcast" element={<PlaceholderPage />} />
          <Route path="/reports" element={<ReportsRoute />} />
          <Route path="/returns" element={<ReturnsRoute />} />

          <Route
            path="/inventory"
            element={
                <RequirePerm perm="manage_inventory">
                <InventoryRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/adjustments"
            element={
              <RequirePerm perm="manage_inventory">
                <StockAdjustmentsRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/transfers"
            element={
              <RequirePerm perm="manage_inventory">
                <TransfersRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/promotions"
            element={
              <RequirePerm perm="manage_inventory">
                <PromotionsRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/expenses"
            element={
              <RequirePerm perm="manage_inventory">
                <ExpensesRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/accounting"
            element={
              <RequirePerm perm="view_reports">
                <AccountingRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/categories"
            element={
              <RequirePerm perm="manage_inventory">
                <CategoriesRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/taxes"
            element={
              <RequirePerm perm="manage_inventory">
                <TaxesRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/brands"
            element={
              <RequirePerm perm="manage_inventory">
                <BrandsRoute />
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
                <SuppliersRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/purchase-orders"
            element={
              <RequirePerm perm="manage_orders">
                <PurchaseOrdersRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/supplier-payables"
            element={
              <RequirePerm perm="manage_orders">
                <SupplierPayablesRoute />
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
                <ReturnedStockRoute />
              </RequirePerm>
            }
          />

          <Route
            path="/employees"
            element={
              <RequirePerm perm="manage_employees">
                <EmployeesRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/outlets"
            element={
              <RequirePerm perm="manage_employees">
                <OutletsRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/administrator"
            element={
              <RequirePerm perm="manage_employees">
                <AdministratorRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/action-history"
            element={
              <RequirePerm perm="manage_employees">
                <ActionHistoryRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/backup-restore"
            element={
              <RequirePerm perm="manage_employees">
                <BackupRestoreRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/integrations/shopify"
            element={
              <RequirePerm perm="manage_inventory">
                <ShopifyIntegrationRoute />
              </RequirePerm>
            }
          />

          <Route path="/attendance" element={<Attendance />} />
          <Route
            path="/hr/leave"
            element={
              <RequirePerm perm="manage_employees">
                <HRManagementRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/hr/payroll"
            element={
              <RequirePerm perm="manage_employees">
                <HRManagementRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/company-settings"
            element={
              <RequirePerm perm="manage_employees">
                <CompanySettingsRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/reports/sales-summary"
            element={<ReportTabStandaloneRoute tabId="sales-summary" />}
          />
          <Route
            path="/reports/sales-detail"
            element={<ReportTabStandaloneRoute tabId="sales-detail" />}
          />
          <Route
            path="/reports/sales-and-stock"
            element={<ReportTabStandaloneRoute tabId="sales-stock" />}
          />
          <Route
            path="/reports/inventory-dump"
            element={<ReportTabStandaloneRoute tabId="inventory-dump" />}
          />
          <Route
            path="/reports/category-wise"
            element={<ReportTabStandaloneRoute tabId="category-wise" />}
          />
          <Route
            path="/reports/product-specification"
            element={<ReportTabStandaloneRoute tabId="product-spec" />}
          />
          <Route
            path="/reports/order-wise"
            element={<ReportTabStandaloneRoute tabId="order-wise" />}
          />
          <Route
            path="/reports/replenishment"
            element={<ReportTabStandaloneRoute tabId="replenishment" />}
          />
          <Route
            path="/reports/on-hand-inventory"
            element={<ReportTabStandaloneRoute tabId="on-hand" />}
          />
          <Route
            path="/reports/customer-details"
            element={<ReportTabStandaloneRoute tabId="customer-details" />}
          />
          <Route
            path="/reports/customer-wise"
            element={<ReportTabStandaloneRoute tabId="customer-wise" />}
          />
          <Route
            path="/reports/supplier-wise"
            element={<ReportTabStandaloneRoute tabId="supplier-wise" />}
          />
          <Route
            path="/reports/inventory-loss"
            element={<ReportTabStandaloneRoute tabId="inventory-loss" />}
          />
          <Route
            path="/reports/item-wise"
            element={<ReportTabStandaloneRoute tabId="item-wise" />}
          />
          <Route
            path="/reports/wastage"
            element={<ReportTabStandaloneRoute tabId="wastage" />}
          />
          <Route
            path="/reports/product-movement"
            element={<ReportTabStandaloneRoute tabId="product-movement" />}
          />
          <Route path="/reports/parent-report" element={<PlaceholderPage />} />
          <Route
            path="/reports/product-performance"
            element={<ReportTabStandaloneRoute tabId="product-performance" />}
          />
          <Route path="/receipt-templates" element={<ReceiptTemplates />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
