import { Suspense, lazy, useEffect, useRef } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import RequireAuth from "./components/RequireAuth";
import RequireContext from "./components/RequireContext";
import RequirePerm from "./components/RequirePerm";
import AppLayoutRedesign from "./components/AppLayoutRedesign";
import ContextSelect from "./pages/ContextSelect";
import AccessDenied from "./pages/AccessDenied";
import AdministratorRoute from "./pages/AdministratorRoute";
import ApprovalsRedesign from "./pages/redesign/ApprovalsRedesign";
import AttendanceRedesign from "./pages/redesign/AttendanceRedesign";
import AttributeSetsRoute from "./pages/AttributeSetsRoute";
import BackupRestoreRoute from "./pages/BackupRestoreRoute";
import BarcodeTemplatesRedesign from "./pages/redesign/BarcodeTemplatesRedesign";
import PrinterSettingsRedesign from "./pages/redesign/PrinterSettingsRedesign";
import BrandsRoute from "./pages/BrandsRoute";
import CategoriesRoute from "./pages/CategoriesRoute";
import DashboardRoute from "./pages/DashboardRoute";
import EmployeesRoute from "./pages/EmployeesRoute";
import ExpensesRoute from "./pages/ExpensesRoute";
import InventoryRoute from "./pages/InventoryRoute";
import ProductFormPage from "./pages/redesign/ProductFormPage";
import Login from "./pages/Login";
import SetupWizard from "./pages/SetupWizard";
import OutletsRoute from "./pages/OutletsRoute";
import PlaceholderPage from "./pages/PlaceholderPage";
import PromotionsRoute from "./pages/PromotionsRoute";
import PurchaseOrdersRoute from "./pages/PurchaseOrdersRoute";
import ReceiptTemplatesRedesign from "./pages/redesign/ReceiptTemplatesRedesign";
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
import KioskRedesign from "./pages/redesign/KioskRedesign";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminTenantList from "./pages/admin/AdminTenantList";
import AdminTenantDetail from "./pages/admin/AdminTenantDetail";
import OrdersRoute from "./pages/OrdersRoute";
import CustomersRoute from "./pages/CustomersRoute";
import SalesHistoryRoute from "./pages/SalesHistoryRoute";
import CashManagementRoute from "./pages/CashManagementRoute";
import ReturnsRoute from "./pages/ReturnsRoute";
import ParkedSalesRedesign from "./pages/redesign/ParkedSalesRedesign";
import ReorderAlertsRedesign from "./pages/redesign/ReorderAlertsRedesign";
import NotificationsRedesign from "./pages/redesign/NotificationsRedesign";

const CustomerDisplayPage = lazy(() => import("./pages/CustomerDisplayPage"));
const ReportsRoute = lazy(() => import("./pages/ReportsRoute"));
const ReportTabStandaloneRoute = lazy(() =>
  import("./pages/ReportsRoute").then((mod) => ({
    default: mod.ReportTabStandaloneRoute,
  })),
);

function RouteLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-500 shadow-sm">
        Loading...
      </div>
    </div>
  );
}

function HomeRedirect() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const navigate = useNavigate();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (isBootstrapping || checkedRef.current) return;
    checkedRef.current = true;
    const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:5000";
    fetch(`${apiBase}/api/setup/status`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.setup_complete) navigate("/setup", { replace: true });
      })
      .catch(() => {});
  }, [isBootstrapping, navigate]);

  if (isBootstrapping) return null;
  return <Navigate to={isAuthenticated ? "/context-select" : "/login"} replace />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/login" element={<Login />} />
        <Route path="/access-denied" element={<AccessDenied />} />
        <Route
          path="/context-select"
          element={
            <RequireAuth>
              <ContextSelect />
            </RequireAuth>
          }
        />
        <Route
          path="/pos"
          element={
              <RequireAuth>
              <POSRoute />
            </RequireAuth>
          }
        />
        <Route
          path="/kiosk"
          element={
            <RequireAuth>
              <KioskRedesign />
            </RequireAuth>
          }
        />

        {/* Customer-Facing Display — public, no auth */}
        <Route
          path="/customer-display"
          element={
            <Suspense fallback={<RouteLoading />}>
              <CustomerDisplayPage />
            </Suspense>
          }
        />

        {/* Super-Admin Dashboard — separate auth, no POS guards */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="tenants" element={<AdminTenantList />} />
          <Route path="tenants/:id" element={<AdminTenantDetail />} />
        </Route>

        <Route
          element={
            <RequireAuth>
              <RequireContext>
                <AppLayoutRedesign />
              </RequireContext>
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
          <Route
            path="/parked-sales"
            element={
              <RequirePerm perm="manage_orders">
                <ParkedSalesRedesign />
              </RequirePerm>
            }
          />
          <Route path="/lookup" element={<PlaceholderPage />} />
          <Route path="/custom-fields" element={<PlaceholderPage />} />
          <Route path="/partners" element={<PlaceholderPage />} />
          <Route path="/shopcast" element={<PlaceholderPage />} />
          <Route
            path="/reports"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportsRoute />
              </Suspense>
            }
          />
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
            path="/products/new"
            element={
              <RequirePerm perm="manage_inventory">
                <ProductFormPage />
              </RequirePerm>
            }
          />
          <Route
            path="/products/:id"
            element={
              <RequirePerm perm="manage_inventory">
                <ProductFormPage />
              </RequirePerm>
            }
          />
          <Route
            path="/reorder-alerts"
            element={
              <RequirePerm perm="manage_inventory">
                <ReorderAlertsRedesign />
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
                <BarcodeTemplatesRedesign />
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
                <ApprovalsRedesign />
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
              <RequirePerm perm="all_access">
                <EmployeesRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/outlets"
            element={
              <RequirePerm perm="all_access">
                <OutletsRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/administrator"
            element={
              <RequirePerm perm="all_access">
                <AdministratorRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/action-history"
            element={
              <RequirePerm perm="all_access">
                <ActionHistoryRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/backup-restore"
            element={
              <RequirePerm perm="all_access">
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

          <Route path="/notifications" element={<NotificationsRedesign />} />
          <Route
            path="/attendance"
            element={
              <RequirePerm perm="view_reports">
                <AttendanceRedesign />
              </RequirePerm>
            }
          />
          <Route
            path="/hr"
            element={
              <RequirePerm perm="all_access">
                <HRManagementRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/company-settings"
            element={
              <RequirePerm perm="all_access">
                <CompanySettingsRoute />
              </RequirePerm>
            }
          />
          <Route
            path="/reports/sales-summary"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="sales-summary" />
              </Suspense>
            }
          />
          <Route
            path="/reports/sales-detail"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="sales-detail" />
              </Suspense>
            }
          />
          <Route
            path="/reports/sales-and-stock"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="sales-stock" />
              </Suspense>
            }
          />
          <Route
            path="/reports/inventory-dump"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="inventory-dump" />
              </Suspense>
            }
          />
          <Route
            path="/reports/category-wise"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="category-wise" />
              </Suspense>
            }
          />
          <Route
            path="/reports/product-specification"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="product-spec" />
              </Suspense>
            }
          />
          <Route
            path="/reports/order-wise"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="order-wise" />
              </Suspense>
            }
          />
          <Route
            path="/reports/replenishment"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="replenishment" />
              </Suspense>
            }
          />
          <Route
            path="/reports/on-hand-inventory"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="on-hand" />
              </Suspense>
            }
          />
          <Route
            path="/reports/customer-details"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="customer-details" />
              </Suspense>
            }
          />
          <Route
            path="/reports/customer-wise"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="customer-wise" />
              </Suspense>
            }
          />
          <Route
            path="/reports/supplier-wise"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="supplier-wise" />
              </Suspense>
            }
          />
          <Route
            path="/reports/inventory-loss"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="inventory-loss" />
              </Suspense>
            }
          />
          <Route
            path="/reports/item-wise"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="item-wise" />
              </Suspense>
            }
          />
          <Route
            path="/reports/wastage"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="wastage" />
              </Suspense>
            }
          />
          <Route
            path="/reports/product-movement"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="product-movement" />
              </Suspense>
            }
          />
          <Route path="/reports/parent-report" element={<PlaceholderPage />} />
          <Route
            path="/reports/product-performance"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportTabStandaloneRoute tabId="product-performance" />
              </Suspense>
            }
          />
          <Route path="/receipt-templates" element={<ReceiptTemplatesRedesign />} />
          <Route
            path="/printer-settings"
            element={
              <RequirePerm perm="all_access">
                <PrinterSettingsRedesign />
              </RequirePerm>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
