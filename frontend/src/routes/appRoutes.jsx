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
const ReceiveSupplierBillRedesign = lazy(() => import("../pages/redesign/ReceiveSupplierBillRedesign"));
const SupplierBillsRedesign = lazy(() => import("../pages/redesign/SupplierBillsRedesign"));
const NeedsCategoryRedesign = lazy(() => import("../pages/redesign/NeedsCategoryRedesign"));
const AttendanceRedesign = lazy(() => import("../pages/redesign/AttendanceRedesign"));
const SalariesRedesign = lazy(() => import("../pages/redesign/SalariesRedesign"));
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
const ManufacturerPartnersRoute = lazy(() => import("../pages/ManufacturerPartnersRoute"));
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
const ProductionRoute = lazy(() => import("../pages/ProductionRoute"));
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
const HoldsRoute = lazy(() => import("../pages/HoldsRoute"));
const RetailRiskRoute = lazy(() => import("../pages/RetailRiskRoute"));
const ReorderAlertsRedesign = lazy(() => import("../pages/redesign/ReorderAlertsRedesign"));
const ExpiringSoonRedesign = lazy(() => import("../pages/redesign/ExpiringSoonRedesign"));
const InventoryIntelligenceRoute = lazy(() => import("../pages/InventoryIntelligenceRoute"));
const NotificationsRedesign = lazy(() => import("../pages/redesign/NotificationsRedesign"));
const ProfileRedesign = lazy(() => import("../pages/redesign/ProfileRedesign"));
// Tier 1.1 wholesale: field-rep mobile pages + owner-side visits report
const FieldTodayRedesign = lazy(() => import("../pages/redesign/field/FieldTodayRedesign"));
const FieldCheckInRedesign = lazy(() => import("../pages/redesign/field/FieldCheckInRedesign"));
const FieldVisitsRedesign = lazy(() => import("../pages/redesign/field/FieldVisitsRedesign"));
const FieldRoutesAdminRedesign = lazy(() => import("../pages/redesign/field/FieldRoutesAdminRedesign"));
// Tier 1.2 wholesale: order capture from the field rep app
const FieldOrderRedesign = lazy(() => import("../pages/redesign/field/FieldOrderRedesign"));
const FieldVanRedesign = lazy(() => import("../pages/redesign/field/FieldVanRedesign"));
const MyTicketsRoute = lazy(() => import("../pages/MyTicketsRoute"));
const ImportRedesign = lazy(() => import("../pages/redesign/ImportRedesign"));
const ImportFromCompetitorRoute = lazy(() => import("../pages/ImportFromCompetitorRoute"));
const CourierSettingsRedesign = lazy(() => import("../pages/redesign/CourierSettingsRedesign"));
const NotificationSettingsRoute = lazy(() => import("../pages/NotificationSettingsRoute"));
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
const CustomerGroupPriceBookRedesign = lazy(() => import("../pages/redesign/CustomerGroupPriceBookRedesign"));
const GiftCardsAdminRedesign = lazy(() => import("../pages/redesign/GiftCardsAdminRedesign"));
const ReviewModerationRedesign = lazy(() => import("../pages/redesign/ReviewModerationRedesign"));
const FulfillmentRedesign = lazy(() => import("../pages/redesign/FulfillmentRedesign"));
const BackordersRedesign = lazy(() => import("../pages/redesign/BackordersRedesign"));
const CODSettlementsRoute = lazy(() => import("../pages/CODSettlementsRoute"));
const LoyaltyTiersRoute = lazy(() => import("../pages/LoyaltyTiersRoute"));
const SmartCollectionsRoute = lazy(() => import("../pages/SmartCollectionsRoute"));
const CommissionPlansRoute = lazy(() => import("../pages/CommissionPlansRoute"));
const TipPoolsRoute = lazy(() => import("../pages/TipPoolsRoute"));
const ReportBuilderRoute = lazy(() => import("../pages/ReportBuilderRoute"));
const POSLayoutsRoute = lazy(() => import("../pages/POSLayoutsRoute"));
const OutletTaxProfilesRoute = lazy(() => import("../pages/OutletTaxProfilesRoute"));
const BusinessModulesRoute = lazy(() => import("../pages/BusinessModulesRoute"));
const ScheduledChangesRoute = lazy(() => import("../pages/ScheduledChangesRoute"));
const RestaurantFloorRoute = lazy(() => import("../pages/RestaurantFloorRoute"));
const RestaurantChecksRoute = lazy(() => import("../pages/RestaurantChecksRoute"));
const Restaurant86Route = lazy(() => import("../pages/Restaurant86Route"));
const VoidReasonsAdminRoute = lazy(() => import("../pages/VoidReasonsAdminRoute"));
const MenuSchedulesRoute = lazy(() => import("../pages/MenuSchedulesRoute"));
const ReservationsRoute = lazy(() => import("../pages/ReservationsRoute"));
const WaitlistRoute = lazy(() => import("../pages/WaitlistRoute"));
const ModifierGroupsRoute = lazy(() => import("../pages/ModifierGroupsRoute"));
const RestaurantInboxRoute = lazy(() => import("../pages/RestaurantInboxRoute"));
const AppointmentServicesRoute = lazy(() => import("../pages/AppointmentServicesRoute"));
const AppointmentsCalendarRoute = lazy(() => import("../pages/AppointmentsCalendarRoute"));
const AppointmentsRoute = lazy(() => import("../pages/AppointmentsRoute"));
const ClassTimetableRoute = lazy(() => import("../pages/ClassTimetableRoute"));
const MembersRoute = lazy(() => import("../pages/MembersRoute"));
const ProjectsRoute = lazy(() => import("../pages/ProjectsRoute"));
const ContractsRoute = lazy(() => import("../pages/ContractsRoute"));
const ServiceTicketsRoute = lazy(() => import("../pages/ServiceTicketsRoute"));
const RentalsRoute = lazy(() => import("../pages/RentalsRoute"));
const RoomManagementRoute = lazy(() => import("../pages/RoomManagementRoute"));
const TreatmentPlansRoute = lazy(() => import("../pages/TreatmentPlansRoute"));
const RecallsRedesign = lazy(() => import("../pages/redesign/RecallsRedesign"));
const VaccinationCardRedesign = lazy(() => import("../pages/redesign/treatment/VaccinationCardRedesign"));
const HandoutsRedesign = lazy(() => import("../pages/redesign/HandoutsRedesign"));
const OrderKiosksRoute = lazy(() => import("../pages/OrderKiosksRoute"));
const FormsRoute = lazy(() => import("../pages/FormsRoute"));

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
    {/* 2-G.16 Merchant home alias — same component, preference-friendly URL. */}
    <Route path="/retail/home" element={<DashboardRoute />} />
    <Route path="/profile" element={<ProfileRedesign />} />
    <Route path="/my-tickets" element={<MyTicketsRoute />} />
    <Route path="/sales-history" element={<SalesHistoryRoute />} />
    <Route path="/cash-management" element={<CashManagementRoute />} />
    <Route path="/customers" element={<CustomersRoute />} />
    <Route path="/crm" element={perm("manage_orders", <CRMRoute />)} />
    <Route path="/quotations" element={perm("manage_orders", <QuotationsRoute />)} />
    {/* W0b C7 (role audit): route perm must agree with the nav guard */}
    <Route path="/attribute-sets" element={perm("manage_inventory", <AttributeSetsRoute />)} />
    <Route path="/orders" element={perm("manage_orders", <OrdersRoute />)} />
    <Route path="/parked-sales" element={perm("manage_orders", <ParkedSalesRedesign />)} />
    <Route path="/holds" element={perm("manage_orders", <HoldsRoute />)} />
    <Route path="/retail-risk" element={perm(["view_hr_reports", "view_financial_reports"], wrap(RetailRiskRoute))} />
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
    <Route path="/inventory/expiring" element={perm("manage_inventory", <ExpiringSoonRedesign />)} />
    <Route path="/inventory-intelligence" element={perm("manage_inventory", <InventoryIntelligenceRoute />)} />
    <Route path="/adjustments" element={perm("manage_inventory", <StockAdjustmentsRoute />)} />
    <Route path="/transfers" element={perm("manage_inventory", <TransfersRoute />)} />
    <Route path="/production" element={perm("manage_inventory", <ProductionRoute />)} />
    <Route path="/promotions" element={perm("manage_inventory", <PromotionsRoute />)} />
    <Route path="/settings/manufacturer-partners" element={perm("manage_inventory", <ManufacturerPartnersRoute />)} />
    <Route path="/expenses" element={perm("manage_inventory", <ExpensesRoute />)} />
    <Route path="/accounting" element={perm("view_financial_reports", <AccountingRoute />)} />
    <Route path="/categories" element={perm("manage_inventory", <CategoriesRoute />)} />
    <Route path="/needs-category" element={perm("manage_inventory", <NeedsCategoryRedesign />)} />
    <Route path="/taxes" element={perm("manage_inventory", <TaxesRoute />)} />
    <Route path="/brands" element={perm("manage_inventory", <BrandsRoute />)} />
    <Route path="/barcode-templates" element={perm("manage_inventory", <BarcodeTemplatesRedesign />)} />
    <Route path="/suppliers" element={perm("manage_orders", <SuppliersRoute />)} />
    <Route path="/purchase-orders" element={perm("manage_orders", <PurchaseOrdersRoute />)} />
    <Route path="/supplier-payables" element={perm("manage_orders", <SupplierPayablesRoute />)} />
    <Route path="/approvals" element={perm("manage_orders", <ApprovalsRedesign />)} />
    <Route path="/supplier-bills" element={perm("receive_supplier_bills", <SupplierBillsRedesign />)} />
    <Route path="/supplier-bills/new" element={perm("receive_supplier_bills", <ReceiveSupplierBillRedesign />)} />
    <Route path="/returned-stock" element={perm("manage_orders", <ReturnedStockRoute />)} />
    <Route path="/employees" element={perm("all_access", <EmployeesRoute />)} />
    <Route path="/outlets" element={perm("all_access", <OutletsRoute />)} />
    <Route path="/administrator" element={perm("all_access", <AdministratorRoute />)} />
    <Route path="/action-history" element={perm("all_access", <ActionHistoryRoute />)} />
    <Route path="/import" element={perm("all_access", <ImportRedesign />)} />
    <Route path="/settings/import-from-competitor" element={perm("all_access", wrap(ImportFromCompetitorRoute))} />
    <Route path="/backup-restore" element={perm("all_access", <BackupRestoreRoute />)} />
    <Route path="/settings/integrations" element={perm("manage_inventory", <IntegrationsHubRedesign />)} />
    <Route path="/integrations/shopify" element={perm("manage_inventory", <ShopifyIntegrationRoute />)} />
    <Route path="/integrations/woocommerce" element={perm("manage_inventory", <WooCommerceIntegrationRedesign />)} />
    <Route path="/notifications" element={<NotificationsRedesign />} />
    <Route path="/attendance" element={perm("view_hr_reports", <AttendanceRedesign />)} />
    <Route path="/salaries" element={perm("manage_employees", <SalariesRedesign />)} />
    <Route path="/hr" element={perm("all_access", <HRManagementRoute />)} />
    <Route path="/scheduling" element={perm("all_access", <SchedulingRoute />)} />
    <Route path="/company-settings" element={perm("all_access", <CompanySettingsRoute />)} />
    {/* W0b C7 (role audit): route perm must agree with the nav guard */}
    <Route path="/receipt-templates" element={perm("manage_inventory", <ReceiptTemplatesRedesign />)} />
    <Route path="/printer-settings" element={perm("all_access", <PrinterSettingsRedesign />)} />
    <Route path="/courier-settings" element={perm("all_access", <CourierSettingsRedesign />)} />
    <Route path="/settings/notifications" element={perm("manage_inventory", wrap(NotificationSettingsRoute))} />
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
    {/* Phase 2-R Wave C — restaurant analytics deep-links */}
    <Route path="/reports/kds-analytics" element={wrap(() => <ReportTabStandaloneRoute tabId="kds-analytics" />)} />
    <Route path="/reports/menu-engineering" element={wrap(() => <ReportTabStandaloneRoute tabId="menu-engineering" />)} />
    {/* Wave 2 — Accounting */}
    <Route path="/chart-of-accounts" element={perm("all_access", <ChartOfAccountsRedesign />)} />
    <Route path="/journal-entries" element={perm("all_access", <JournalEntriesRedesign />)} />
    <Route path="/credit-debit-notes" element={perm("view_financial_reports", <CreditDebitNotesRedesign />)} />
    <Route path="/postdated-cheques" element={perm("view_financial_reports", <PostdatedChequesRedesign />)} />
    {/* Wave 3 — Inventory & Commerce */}
    <Route path="/stock-counts" element={perm("manage_inventory", <StockCountRedesign />)} />
    <Route path="/price-lists" element={perm("manage_inventory", <PriceListsRedesign />)} />
    {/* Wave 4 — Customer & Loyalty */}
    <Route path="/loyalty-tiers" element={perm("all_access", <LoyaltyTiersRoute />)} />
    <Route path="/customer-groups" element={perm("manage_customers", <CustomerGroupsRedesign />)} />
    <Route path="/customer-groups/:groupId/price-book" element={perm("manage_customers", <CustomerGroupPriceBookRedesign />)} />
    <Route path="/gift-cards" element={perm("manage_gift_cards", <GiftCardsAdminRedesign />)} />
    <Route path="/review-moderation" element={perm("manage_inventory", <ReviewModerationRedesign />)} />
    {/* Wave 5 — Fulfillment */}
    <Route path="/fulfillment" element={perm("manage_orders", <FulfillmentRedesign />)} />
    {/* V02 wholesale — backorder fulfillment loop */}
    <Route path="/backorders" element={perm("manage_orders", <BackordersRedesign />)} />
    <Route path="/cod-settlements" element={perm("manage_orders", <CODSettlementsRoute />)} />
    {/* Phase 2B — Report Builder, POS Layouts */}
    <Route path="/report-builder" element={perm(["view_sales_reports", "view_inventory_reports", "view_financial_reports", "view_hr_reports", "view_customer_reports"], <ReportBuilderRoute />)} />
    <Route path="/settings/pos-layouts" element={perm("all_access", <POSLayoutsRoute />)} />
    {/* Phase 2B — Commissions */}
    <Route path="/commissions" element={perm("all_access", <CommissionPlansRoute />)} />
    {/* Phase 2B — Catalog Depth */}
    <Route path="/smart-collections" element={perm("all_access", <SmartCollectionsRoute />)} />
    <Route path="/settings/outlet-tax-profiles" element={perm("all_access", <OutletTaxProfilesRoute />)} />
    <Route path="/settings/business-modules" element={perm(["manage_business_modules", "manage_outlet_modules"], <BusinessModulesRoute />)} />
    <Route path="/scheduled-changes" element={perm("all_access", <ScheduledChangesRoute />)} />
    {/* Phase 3 — Marketing, Engagement & Financial Tools */}
    <Route path="/marketing/campaigns" element={perm("all_access", <MarketingCampaignsRoute />)} />
    <Route path="/messaging/inbox" element={perm("manage_orders", <MessagingInboxRoute />)} />
    <Route path="/customer-invoices" element={perm("manage_orders", <CustomerInvoicesRoute />)} />
    <Route path="/subscriptions" element={perm("all_access", <SubscriptionsRoute />)} />
    {/* Phase 4 — Restaurant */}
    <Route path="/restaurant/floor" element={perm("manage_restaurant", wrap(RestaurantFloorRoute))} />
    {/* Phase 2.1 C — Tip pools */}
    <Route path="/tips" element={perm("manage_tips", wrap(TipPoolsRoute))} />
    <Route path="/restaurant/checks" element={perm("manage_restaurant", wrap(RestaurantChecksRoute))} />
    <Route path="/restaurant/availability" element={perm("manage_restaurant", wrap(Restaurant86Route))} />
    <Route path="/restaurant/void-reasons" element={perm("all_access", wrap(VoidReasonsAdminRoute))} />
    <Route path="/restaurant/menu-schedules" element={perm("manage_restaurant", wrap(MenuSchedulesRoute))} />
    <Route path="/restaurant/reservations" element={perm("manage_restaurant", wrap(ReservationsRoute))} />
    <Route path="/restaurant/waitlist" element={perm("manage_restaurant", wrap(WaitlistRoute))} />
    <Route path="/restaurant/modifiers" element={perm("manage_restaurant", wrap(ModifierGroupsRoute))} />
    <Route path="/restaurant/inbox" element={perm("manage_restaurant", wrap(RestaurantInboxRoute))} />
    <Route path="/order-kiosks" element={perm("manage_restaurant", wrap(OrderKiosksRoute))} />
    {/* Phase 4 — Appointments */}
    <Route path="/appointments/services" element={perm("manage_bookings", wrap(AppointmentServicesRoute))} />
    <Route path="/appointments/calendar" element={perm("manage_bookings", wrap(AppointmentsCalendarRoute))} />
    <Route path="/appointments/bookings" element={perm("manage_bookings", wrap(AppointmentsRoute))} />
    <Route path="/classes/timetable" element={perm("manage_bookings", wrap(ClassTimetableRoute))} />
    <Route path="/members" element={perm("manage_bookings", wrap(MembersRoute))} />
    {/* Phase 4 — Service Workspace */}
    <Route path="/projects" element={perm("manage_projects", wrap(ProjectsRoute))} />
    <Route path="/contracts" element={perm("manage_contracts", wrap(ContractsRoute))} />
    <Route path="/service-tickets" element={perm("manage_tickets", wrap(ServiceTicketsRoute))} />

    {/* M7 — Rentals */}
    <Route path="/rentals" element={perm("manage_rentals", wrap(RentalsRoute))} />
    <Route path="/rentals/items" element={perm("manage_rentals", wrap(RentalsRoute))} />
    <Route path="/rentals/contracts" element={perm("manage_rentals", wrap(RentalsRoute))} />
    <Route path="/rentals/timeline" element={perm("manage_rentals", wrap(RentalsRoute))} />
    <Route path="/rentals/deliveries" element={perm("manage_rentals", wrap(RentalsRoute))} />

    {/* M9 — Room management */}
    <Route path="/rooms" element={perm("manage_rooms", wrap(RoomManagementRoute))} />
    <Route path="/rooms/rates" element={perm("manage_rooms", wrap(RoomManagementRoute))} />
    <Route path="/rooms/bookings" element={perm("manage_rooms", wrap(RoomManagementRoute))} />
    <Route path="/rooms/calendar" element={perm("manage_rooms", wrap(RoomManagementRoute))} />
    <Route path="/rooms/arrivals-departures" element={perm("manage_rooms", wrap(RoomManagementRoute))} />
    <Route path="/rooms/channels" element={perm("manage_rooms", wrap(RoomManagementRoute))} />
    <Route path="/rooms/night-audit" element={perm("manage_rooms", wrap(RoomManagementRoute))} />

    {/* M10 — Treatment plans */}
    <Route path="/treatment-plans" element={perm("manage_treatment_plans", wrap(TreatmentPlansRoute))} />
    <Route path="/treatment-plans/active" element={perm("manage_treatment_plans", wrap(TreatmentPlansRoute))} />
    <Route path="/treatment-plans/calendar" element={perm("manage_treatment_plans", wrap(TreatmentPlansRoute))} />
    <Route path="/treatment-plans/labs" element={perm("manage_treatment_plans", wrap(TreatmentPlansRoute))} />
    <Route path="/treatment-plans/templates" element={perm("manage_treatment_plans", wrap(TreatmentPlansRoute))} />
    <Route path="/treatment-plans/chart/:planId" element={perm("manage_treatment_plans", wrap(TreatmentPlansRoute))} />
    <Route path="/treatment-plans/:planId" element={perm("manage_treatment_plans", wrap(TreatmentPlansRoute))} />

    {/* V05 — clinical depth: recalls (overdue patients), per-pet vaccination
        card, physio handout library. Flag checks (clinical_recalls /
        vet_vaccinations / clinical_handouts) are inline in each page.
        W0b C7 (role audit): recalls/handouts route perms now match their
        nav guards (manage_treatment_plans) — the nav hid them while the
        route stayed open by direct URL. Vaccination card stays open: it is
        reached from customer detail, not nav, and is read-only. */}
    <Route path="/recalls" element={perm("manage_treatment_plans", wrap(RecallsRedesign))} />
    <Route path="/vaccination-card/:subjectId" element={wrap(VaccinationCardRedesign)} />
    <Route path="/handouts" element={perm("manage_treatment_plans", wrap(HandoutsRedesign))} />

    {/* F03 — Form builder (intake/waivers/questionnaires). Flag check inline. */}
    <Route path="/settings/forms" element={perm("manage_forms", wrap(FormsRoute))} />

    {/* Tier 1.1 wholesale field sales — feature flag check is inline inside each page. */}
    {/* S3 split: rep-self pages accept execute_field_sales (Field Rep role)
        or manage_field_sales (owners); owner pages below stay manage-only. */}
    <Route path="/field/today" element={perm(["execute_field_sales", "manage_field_sales"], wrap(FieldTodayRedesign))} />
    <Route path="/field/check-in/:customer_id" element={perm(["execute_field_sales", "manage_field_sales"], wrap(FieldCheckInRedesign))} />
    <Route path="/field/order/:customer_id" element={perm(["execute_field_sales", "manage_field_sales"], wrap(FieldOrderRedesign))} />
    {/* V02 wholesale — van sales (rep van view + day-end count) */}
    <Route path="/field/van" element={perm(["execute_field_sales", "manage_field_sales"], wrap(FieldVanRedesign))} />
    <Route path="/field/visits" element={perm("manage_field_sales", wrap(FieldVisitsRedesign))} />
    <Route path="/field/routes" element={perm("manage_field_sales", wrap(FieldRoutesAdminRedesign))} />
  </Route>,
];
