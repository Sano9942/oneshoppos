import { Suspense, lazy } from "react";
import { Route } from "react-router-dom";
import RequireAuth from "../components/RequireAuth";
import RequireContext from "../components/RequireContext";
import RequirePerm from "../components/RequirePerm";
import AppLayoutRedesign from "../components/AppLayoutRedesign";
import PlaceholderPage from "../pages/PlaceholderPage";
import RouteLoading from "./RouteLoading";

const AdministratorRoute = lazy(() => import("../pages/AdministratorRoute"));
const ApprovalsRedesign = lazy(() => import("../pages/redesign/ApprovalsRedesign"));
const AttendanceRedesign = lazy(() => import("../pages/redesign/AttendanceRedesign"));
const AttributeSetsRoute = lazy(() => import("../pages/AttributeSetsRoute"));
const BackupRestoreRoute = lazy(() => import("../pages/BackupRestoreRoute"));
const BarcodeTemplatesRedesign = lazy(() => import("../pages/redesign/BarcodeTemplatesRedesign"));
const PrinterSettingsRedesign = lazy(() => import("../pages/redesign/PrinterSettingsRedesign"));
const BillingRoute = lazy(() => import("../pages/BillingRoute"));
const BrandsRoute = lazy(() => import("../pages/BrandsRoute"));
const CategoriesRoute = lazy(() => import("../pages/CategoriesRoute"));
const DashboardRoute = lazy(() => import("../pages/DashboardRoute"));
const EmployeesRoute = lazy(() => import("../pages/EmployeesRoute"));
const ExpensesRoute = lazy(() => import("../pages/ExpensesRoute"));
const InventoryRoute = lazy(() => import("../pages/InventoryRoute"));
const ProductFormPage = lazy(() => import("../pages/redesign/ProductFormPage"));
const OutletsRoute = lazy(() => import("../pages/OutletsRoute"));
const PromotionsRoute = lazy(() => import("../pages/PromotionsRoute"));
const PurchaseOrdersRoute = lazy(() => import("../pages/PurchaseOrdersRoute"));
const ReceiptTemplatesRedesign = lazy(() => import("../pages/redesign/ReceiptTemplatesRedesign"));
const ReturnedStockRoute = lazy(() => import("../pages/ReturnedStockRoute"));
const ActionHistoryRoute = lazy(() => import("../pages/ActionHistoryRoute"));
const AccountingRoute = lazy(() => import("../pages/AccountingRoute"));
const StockAdjustmentsRoute = lazy(() => import("../pages/StockAdjustmentsRoute"));
const SupplierPayablesRoute = lazy(() => import("../pages/SupplierPayablesRoute"));
const SuppliersRoute = lazy(() => import("../pages/SuppliersRoute"));
const ShopifyIntegrationRoute = lazy(() => import("../pages/ShopifyIntegrationRoute"));
const WooCommerceIntegrationRedesign = lazy(() => import("../pages/redesign/WooCommerceIntegrationRedesign"));
const IntegrationsHubRedesign = lazy(() => import("../pages/redesign/IntegrationsHubRedesign"));
const TaxesRoute = lazy(() => import("../pages/TaxesRoute"));
const TransfersRoute = lazy(() => import("../pages/TransfersRoute"));
const CRMRoute = lazy(() => import("../pages/CRMRoute"));
const QuotationsRoute = lazy(() => import("../pages/QuotationsRoute"));
const HRManagementRoute = lazy(() => import("../pages/HRManagementRoute"));
const SchedulingRoute = lazy(() => import("../pages/SchedulingRoute"));
const ReturnPoliciesRoute = lazy(() => import("../pages/ReturnPoliciesRoute"));
const CompanySettingsRoute = lazy(() => import("../pages/CompanySettingsRoute"));
const OrdersRoute = lazy(() => import("../pages/OrdersRoute"));
const CustomersRoute = lazy(() => import("../pages/CustomersRoute"));
const SalesHistoryRoute = lazy(() => import("../pages/SalesHistoryRoute"));
const CashManagementRoute = lazy(() => import("../pages/CashManagementRoute"));
const ReturnsRoute = lazy(() => import("../pages/ReturnsRoute"));
const ParkedSalesRedesign = lazy(() => import("../pages/redesign/ParkedSalesRedesign"));
const ReorderAlertsRedesign = lazy(() => import("../pages/redesign/ReorderAlertsRedesign"));
const NotificationsRedesign = lazy(() => import("../pages/redesign/NotificationsRedesign"));
const ProfileRedesign = lazy(() => import("../pages/redesign/ProfileRedesign"));
const MyTicketsRoute = lazy(() => import("../pages/MyTicketsRoute"));
const ImportRedesign = lazy(() => import("../pages/redesign/ImportRedesign"));
const CourierSettingsRedesign = lazy(() => import("../pages/redesign/CourierSettingsRedesign"));
const MarketingCampaignsRoute = lazy(() => import("../pages/MarketingCampaignsRoute"));
const MessagingInboxRoute = lazy(() => import("../pages/MessagingInboxRoute"));
const CustomerInvoicesRoute = lazy(() => import("../pages/CustomerInvoicesRoute"));
const SubscriptionsRoute = lazy(() => import("../pages/SubscriptionsRoute"));
const ReportsRoute = lazy(() => import("../pages/ReportsRoute"));
const ReportTabStandaloneRoute = lazy(() =>
  import("../pages/ReportsRoute").then((mod) => ({ default: mod.ReportTabStandaloneRoute }))
);
const FBRSettingsRoute = lazy(() => import("../pages/FBRSettingsRoute"));
const FBRDashboardRoute = lazy(() => import("../pages/FBRDashboardRoute"));
const TaxLookupRoute = lazy(() => import("../pages/TaxLookupRoute"));
const ChartOfAccountsRedesign = lazy(() => import("../pages/redesign/ChartOfAccountsRedesign"));
const JournalEntriesRedesign = lazy(() => import("../pages/redesign/JournalEntriesRedesign"));
const CreditDebitNotesRedesign = lazy(() => import("../pages/redesign/CreditDebitNotesRedesign"));
const PostdatedChequesRedesign = lazy(() => import("../pages/redesign/PostdatedChequesRedesign"));
const StockCountRedesign = lazy(() => import("../pages/redesign/StockCountRedesign"));
const PriceListsRedesign = lazy(() => import("../pages/redesign/PriceListsRedesign"));
const CustomerGroupsRedesign = lazy(() => import("../pages/redesign/CustomerGroupsRedesign"));
const ReviewModerationRedesign = lazy(() => import("../pages/redesign/ReviewModerationRedesign"));
const FulfillmentRedesign = lazy(() => import("../pages/redesign/FulfillmentRedesign"));
const CODSettlementsRoute = lazy(() => import("../pages/CODSettlementsRoute"));
const LoyaltyTiersRoute = lazy(() => import("../pages/LoyaltyTiersRoute"));
const SmartCollectionsRoute = lazy(() => import("../pages/SmartCollectionsRoute"));
const CommissionPlansRoute = lazy(() => import("../pages/CommissionPlansRoute"));
const ReportBuilderRoute = lazy(() => import("../pages/ReportBuilderRoute"));
const POSLayoutsRoute = lazy(() => import("../pages/POSLayoutsRoute"));
const OutletTaxProfilesRoute = lazy(() => import("../pages/OutletTaxProfilesRoute"));
const ScheduledChangesRoute = lazy(() => import("../pages/ScheduledChangesRoute"));
const RestaurantFloorRoute = lazy(() => import("../pages/RestaurantFloorRoute"));
const RestaurantChecksRoute = lazy(() => import("../pages/RestaurantChecksRoute"));
const KDSRoute = lazy(() => import("../pages/KDSRoute"));
const KioskOrderingRoute = lazy(() => import("../pages/KioskOrderingRoute"));
const AppointmentServicesRoute = lazy(() => import("../pages/AppointmentServicesRoute"));
const AppointmentsCalendarRoute = lazy(() => import("../pages/AppointmentsCalendarRoute"));
const AppointmentsRoute = lazy(() => import("../pages/AppointmentsRoute"));
const ProjectsRoute = lazy(() => import("../pages/ProjectsRoute"));
const ContractsRoute = lazy(() => import("../pages/ContractsRoute"));
const ServiceTicketsRoute = lazy(() => import("../pages/ServiceTicketsRoute"));

const wrap = (Component) => <Suspense fallback={<RouteLoading />}><Component /></Suspense>;
const perm = (p, el) => <RequirePerm perm={p}>{el}</RequirePerm>;

export const appRoutes = [
  <Route
    key="app-layout"
    element={
      <RequireAuth>
        <RequireContext>
          <AppLayoutRedesign />
        </RequireContext>
      </RequireAuth>
    }
  >
    <Route path="/dashboard" element={<DashboardRoute />} />
    <Route path="/profile" element={<ProfileRedesign />} />
    <Route path="/my-tickets" element={<MyTicketsRoute />} />
    <Route path="/sales-history" element={<SalesHistoryRoute />} />
    <Route path="/cash-management" element={<CashManagementRoute />} />
    <Route path="/customers" element={<CustomersRoute />} />
    <Route path="/crm" element={perm("manage_orders", <CRMRoute />)} />
    <Route path="/quotations" element={perm("manage_orders", <QuotationsRoute />)} />
    <Route path="/attribute-sets" element={<AttributeSetsRoute />} />
    <Route path="/orders" element={perm("manage_orders", <OrdersRoute />)} />
    <Route path="/parked-sales" element={perm("manage_orders", <ParkedSalesRedesign />)} />
    <Route path="/lookup" element={<PlaceholderPage />} />
    <Route path="/custom-fields" element={<PlaceholderPage />} />
    <Route path="/partners" element={<PlaceholderPage />} />
    <Route path="/shopcast" element={<PlaceholderPage />} />
    <Route path="/reports" element={wrap(ReportsRoute)} />
    <Route path="/returns" element={<ReturnsRoute />} />
    <Route path="/return-policies" element={perm("all_access", <ReturnPoliciesRoute />)} />
    <Route path="/inventory" element={perm("manage_inventory", <InventoryRoute />)} />
    <Route path="/products/new" element={perm("manage_inventory", <ProductFormPage />)} />
    <Route path="/products/:id" element={perm("manage_inventory", <ProductFormPage />)} />
    <Route path="/reorder-alerts" element={perm("manage_inventory", <ReorderAlertsRedesign />)} />
    <Route path="/adjustments" element={perm("manage_inventory", <StockAdjustmentsRoute />)} />
    <Route path="/transfers" element={perm("manage_inventory", <TransfersRoute />)} />
    <Route path="/promotions" element={perm("manage_inventory", <PromotionsRoute />)} />
    <Route path="/expenses" element={perm("manage_inventory", <ExpensesRoute />)} />
    <Route path="/accounting" element={perm("view_reports", <AccountingRoute />)} />
    <Route path="/categories" element={perm("manage_inventory", <CategoriesRoute />)} />
    <Route path="/taxes" element={perm("manage_inventory", <TaxesRoute />)} />
    <Route path="/brands" element={perm("manage_inventory", <BrandsRoute />)} />
    <Route path="/barcode-templates" element={perm("manage_inventory", <BarcodeTemplatesRedesign />)} />
    <Route path="/suppliers" element={perm("manage_orders", <SuppliersRoute />)} />
    <Route path="/purchase-orders" element={perm("manage_orders", <PurchaseOrdersRoute />)} />
    <Route path="/supplier-payables" element={perm("manage_orders", <SupplierPayablesRoute />)} />
    <Route path="/approvals" element={perm("manage_orders", <ApprovalsRedesign />)} />
    <Route path="/returned-stock" element={perm("manage_orders", <ReturnedStockRoute />)} />
    <Route path="/employees" element={perm("all_access", <EmployeesRoute />)} />
    <Route path="/outlets" element={perm("all_access", <OutletsRoute />)} />
    <Route path="/administrator" element={perm("all_access", <AdministratorRoute />)} />
    <Route path="/action-history" element={perm("all_access", <ActionHistoryRoute />)} />
    <Route path="/import" element={perm("all_access", <ImportRedesign />)} />
    <Route path="/backup-restore" element={perm("all_access", <BackupRestoreRoute />)} />
    <Route path="/settings/integrations" element={perm("manage_inventory", <IntegrationsHubRedesign />)} />
    <Route path="/integrations/shopify" element={perm("manage_inventory", <ShopifyIntegrationRoute />)} />
    <Route path="/integrations/woocommerce" element={perm("manage_inventory", <WooCommerceIntegrationRedesign />)} />
    <Route path="/notifications" element={<NotificationsRedesign />} />
    <Route path="/attendance" element={perm("view_reports", <AttendanceRedesign />)} />
    <Route path="/hr" element={perm("all_access", <HRManagementRoute />)} />
    <Route path="/scheduling" element={perm("all_access", <SchedulingRoute />)} />
    <Route path="/company-settings" element={perm("all_access", <CompanySettingsRoute />)} />
    <Route path="/receipt-templates" element={<ReceiptTemplatesRedesign />} />
    <Route path="/printer-settings" element={perm("all_access", <PrinterSettingsRedesign />)} />
    <Route path="/courier-settings" element={perm("all_access", <CourierSettingsRedesign />)} />
    <Route path="/billing" element={perm("all_access", <BillingRoute />)} />
    <Route path="/settings/fbr" element={perm("all_access", <FBRSettingsRoute />)} />
    <Route path="/fbr" element={perm("all_access", <FBRDashboardRoute />)} />
    <Route path="/tax-lookup" element={<TaxLookupRoute />} />
    <Route path="/reports/sales-summary" element={wrap(() => <ReportTabStandaloneRoute tabId="sales-summary" />)} />
    <Route path="/reports/sales-detail" element={wrap(() => <ReportTabStandaloneRoute tabId="sales-detail" />)} />
    <Route path="/reports/sales-and-stock" element={wrap(() => <ReportTabStandaloneRoute tabId="sales-stock" />)} />
    <Route path="/reports/inventory-dump" element={wrap(() => <ReportTabStandaloneRoute tabId="inventory-dump" />)} />
    <Route path="/reports/category-wise" element={wrap(() => <ReportTabStandaloneRoute tabId="category-wise" />)} />
    <Route path="/reports/product-specification" element={wrap(() => <ReportTabStandaloneRoute tabId="product-spec" />)} />
    <Route path="/reports/order-wise" element={wrap(() => <ReportTabStandaloneRoute tabId="order-wise" />)} />
    <Route path="/reports/replenishment" element={wrap(() => <ReportTabStandaloneRoute tabId="replenishment" />)} />
    <Route path="/reports/on-hand-inventory" element={wrap(() => <ReportTabStandaloneRoute tabId="on-hand" />)} />
    <Route path="/reports/customer-details" element={wrap(() => <ReportTabStandaloneRoute tabId="customer-details" />)} />
    <Route path="/reports/customer-wise" element={wrap(() => <ReportTabStandaloneRoute tabId="customer-wise" />)} />
    <Route path="/reports/supplier-wise" element={wrap(() => <ReportTabStandaloneRoute tabId="supplier-wise" />)} />
    <Route path="/reports/inventory-loss" element={wrap(() => <ReportTabStandaloneRoute tabId="inventory-loss" />)} />
    <Route path="/reports/item-wise" element={wrap(() => <ReportTabStandaloneRoute tabId="item-wise" />)} />
    <Route path="/reports/wastage" element={wrap(() => <ReportTabStandaloneRoute tabId="wastage" />)} />
    <Route path="/reports/product-movement" element={wrap(() => <ReportTabStandaloneRoute tabId="product-movement" />)} />
    <Route path="/reports/parent-report" element={<PlaceholderPage />} />
    <Route path="/reports/product-performance" element={wrap(() => <ReportTabStandaloneRoute tabId="product-performance" />)} />
    {/* Wave 2 — Accounting */}
    <Route path="/chart-of-accounts" element={perm("all_access", <ChartOfAccountsRedesign />)} />
    <Route path="/journal-entries" element={perm("all_access", <JournalEntriesRedesign />)} />
    <Route path="/credit-debit-notes" element={perm("view_reports", <CreditDebitNotesRedesign />)} />
    <Route path="/postdated-cheques" element={perm("view_reports", <PostdatedChequesRedesign />)} />
    {/* Wave 3 — Inventory & Commerce */}
    <Route path="/stock-counts" element={perm("manage_inventory", <StockCountRedesign />)} />
    <Route path="/price-lists" element={perm("manage_inventory", <PriceListsRedesign />)} />
    {/* Wave 4 — Customer & Loyalty */}
    <Route path="/loyalty-tiers" element={perm("all_access", <LoyaltyTiersRoute />)} />
    <Route path="/customer-groups" element={perm("manage_customers", <CustomerGroupsRedesign />)} />
    <Route path="/review-moderation" element={perm("manage_inventory", <ReviewModerationRedesign />)} />
    {/* Wave 5 — Fulfillment */}
    <Route path="/fulfillment" element={perm("manage_orders", <FulfillmentRedesign />)} />
    <Route path="/cod-settlements" element={perm("manage_orders", <CODSettlementsRoute />)} />
    {/* Phase 2B — Report Builder, POS Layouts */}
    <Route path="/report-builder" element={perm("view_reports", <ReportBuilderRoute />)} />
    <Route path="/settings/pos-layouts" element={perm("all_access", <POSLayoutsRoute />)} />
    {/* Phase 2B — Commissions */}
    <Route path="/commissions" element={perm("all_access", <CommissionPlansRoute />)} />
    {/* Phase 2B — Catalog Depth */}
    <Route path="/smart-collections" element={perm("all_access", <SmartCollectionsRoute />)} />
    <Route path="/settings/outlet-tax-profiles" element={perm("all_access", <OutletTaxProfilesRoute />)} />
    <Route path="/scheduled-changes" element={perm("all_access", <ScheduledChangesRoute />)} />
    {/* Phase 3 — Marketing, Engagement & Financial Tools */}
    <Route path="/marketing/campaigns" element={perm("all_access", <MarketingCampaignsRoute />)} />
    <Route path="/messaging/inbox" element={perm("manage_orders", <MessagingInboxRoute />)} />
    <Route path="/customer-invoices" element={perm("manage_orders", <CustomerInvoicesRoute />)} />
    <Route path="/subscriptions" element={perm("all_access", <SubscriptionsRoute />)} />
    {/* Phase 4 — Restaurant */}
    <Route path="/restaurant/floor" element={perm("manage_restaurant", wrap(RestaurantFloorRoute))} />
    <Route path="/restaurant/checks" element={perm("manage_restaurant", wrap(RestaurantChecksRoute))} />
    <Route path="/kds" element={perm("manage_kds", wrap(KDSRoute))} />
    <Route path="/kiosk" element={wrap(KioskOrderingRoute)} />
    {/* Phase 4 — Appointments */}
    <Route path="/appointments/services" element={perm("manage_bookings", wrap(AppointmentServicesRoute))} />
    <Route path="/appointments/calendar" element={perm("manage_bookings", wrap(AppointmentsCalendarRoute))} />
    <Route path="/appointments/bookings" element={perm("manage_bookings", wrap(AppointmentsRoute))} />
    {/* Phase 4 — Service Workspace */}
    <Route path="/projects" element={perm("manage_projects", wrap(ProjectsRoute))} />
    <Route path="/contracts" element={perm("manage_contracts", wrap(ContractsRoute))} />
    <Route path="/service-tickets" element={perm("manage_tickets", wrap(ServiceTicketsRoute))} />
  </Route>,
];
