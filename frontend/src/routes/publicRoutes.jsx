import { Suspense, lazy, useEffect, useRef } from "react";
import { Navigate, Route, useNavigate } from "react-router-dom";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { useAuth } from "../auth/AuthProvider";
import { IS_MULTI_TENANT, API_BASE } from "../config";
import RequireAuth from "../components/RequireAuth";
import RequireContext from "../components/RequireContext";
import RequirePerm from "../components/RequirePerm";
import SetupWizard from "../pages/SetupWizard";
import AccessDenied from "../pages/AccessDenied";
import ContextSelect from "../pages/ContextSelect";
import RouteLoading from "./RouteLoading";

const POSRoute = lazy(() => import("../pages/POSRoute"));
const POSRestaurantRoute = lazy(() => import("../pages/POSRestaurantRoute"));
const MarketingHome = lazy(() => import("../pages/marketing/HomePage"));
const MarketingIndustry = lazy(() => import("../pages/marketing/IndustryPage"));
const MarketingIndustriesIndex = lazy(() => import("../pages/marketing/IndustriesIndexPage"));
const MarketingPricing = lazy(() => import("../pages/marketing/PricingPage"));
const MarketingWhy = lazy(() => import("../pages/marketing/WhySanoPosPage"));
const LoginPage = lazy(() => import("../pages/LoginPage"));
const KioskRedesign = lazy(() => import("../pages/redesign/KioskRedesign"));
const KDSRoute = lazy(() => import("../pages/KDSRoute"));
const CustomerDisplayPage = lazy(() => import("../pages/CustomerDisplayPage"));
const ReceiptPublicPage = lazy(() => import("../pages/ReceiptPublicPage"));
const GiftCardBalancePage = lazy(() => import("../pages/GiftCardBalancePage"));
const ResetPassword = lazy(() => import("../pages/ResetPassword"));
const SignupPage = lazy(() => import("../pages/SignupPage"));
const VerifyEmail = lazy(() => import("../pages/VerifyEmail"));
const Terms = lazy(() => import("../pages/public/Terms"));
const Privacy = lazy(() => import("../pages/public/Privacy"));
const StorefrontLayout = lazy(() => import("../pages/storefront/StorefrontLayout"));
const StorefrontHome = lazy(() => import("../pages/storefront/StorefrontHome"));
const StorefrontProducts = lazy(() => import("../pages/storefront/StorefrontProducts"));
const StorefrontProductDetail = lazy(() => import("../pages/storefront/StorefrontProductDetail"));
const StorefrontCart = lazy(() => import("../pages/storefront/StorefrontCart"));
const StorefrontCheckout = lazy(() => import("../pages/storefront/StorefrontCheckout"));
const StorefrontOrderStatus = lazy(() => import("../pages/storefront/StorefrontOrderStatus"));
const PublicBookingPage = lazy(() => import("../pages/public/PublicBookingPage"));
const PublicRoomBookingPage = lazy(() => import("../pages/public/PublicRoomBookingPage"));
const PublicRestaurantMenuPage = lazy(() => import("../pages/public/PublicRestaurantMenuPage"));
const RestaurantPayPage = lazy(() => import("../pages/public/RestaurantPayPage"));
const ReservationBookingPage = lazy(() => import("../pages/public/ReservationBookingPage"));
const FormFillPublic = lazy(() => import("../pages/public/FormFillPublic"));
const MemberCheckinKiosk = lazy(() => import("../pages/public/MemberCheckinKiosk"));
const PublicInquiryPage = lazy(() => import("../pages/public/PublicInquiryPage"));

// M8 — Customer portal (lazy, isolated chunk). Portal is NOT wrapped in
// the main AuthProvider; it uses its own PortalAuthProvider via PortalLayout.
const PortalLayout = lazy(() => import("../pages/portal/PortalLayout"));
const PortalLogin = lazy(() => import("../pages/portal/PortalLogin"));
const PortalSignup = lazy(() => import("../pages/portal/PortalSignup"));
const PortalOtpVerify = lazy(() => import("../pages/portal/PortalOtpVerify"));
const PortalForgotPassword = lazy(() => import("../pages/portal/PortalForgotPassword"));
const PortalResetPassword = lazy(() => import("../pages/portal/PortalResetPassword"));
const PortalDashboard = lazy(() => import("../pages/portal/PortalDashboard"));
const PortalInvoices = lazy(() => import("../pages/portal/PortalInvoices"));
const PortalInvoiceDetail = lazy(() => import("../pages/portal/PortalInvoiceDetail"));
const PortalInvoicePaidPage = lazy(() => import("../pages/portal/PortalInvoicePaidPage"));
const PortalAppointments = lazy(() => import("../pages/portal/PortalAppointments"));
const PortalTreatments = lazy(() => import("../pages/portal/PortalTreatments"));
const PortalStays = lazy(() => import("../pages/portal/PortalStays"));
const PortalPackages = lazy(() => import("../pages/portal/PortalPackages"));
const PortalSubscriptions = lazy(() => import("../pages/portal/PortalSubscriptions"));
const PortalContracts = lazy(() => import("../pages/portal/PortalContracts"));
const PortalTickets = lazy(() => import("../pages/portal/PortalTickets"));
const PortalForms = lazy(() => import("../pages/portal/PortalForms"));
const PortalOrders = lazy(() => import("../pages/portal/PortalOrders"));
const PortalLoyalty = lazy(() => import("../pages/portal/PortalLoyalty"));
const PortalWallet = lazy(() => import("../pages/portal/PortalWallet"));
const PortalProfile = lazy(() => import("../pages/portal/PortalProfile"));
const PortalGallery = lazy(() => import("../pages/portal/PortalGallery"));

// Tier 1.4 — Manufacturer portal (lazy, isolated chunk). Parallel to the
// customer portal: own AuthProvider, own session store, own API client,
// own route tree at /manufacturer-portal/:tenantSlug.
const ManufacturerPortalLayout = lazy(() =>
  import("../pages/manufacturer-portal/ManufacturerPortalLayout")
);
const ManufacturerPortalLogin = lazy(() =>
  import("../pages/manufacturer-portal/ManufacturerPortalLogin")
);
const ManufacturerPortalSetup = lazy(() =>
  import("../pages/manufacturer-portal/ManufacturerPortalSetup")
);
const ManufacturerPortalForgotPassword = lazy(() =>
  import("../pages/manufacturer-portal/ManufacturerPortalForgotPassword")
);
const ManufacturerPortalDashboard = lazy(() =>
  import("../pages/manufacturer-portal/ManufacturerPortalDashboard")
);
const ManufacturerPortalSales = lazy(() =>
  import("../pages/manufacturer-portal/ManufacturerPortalSales")
);
const ManufacturerPortalSchemes = lazy(() =>
  import("../pages/manufacturer-portal/ManufacturerPortalSchemes")
);

function HomeRedirect() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const navigate = useNavigate();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (isBootstrapping || checkedRef.current || IS_MULTI_TENANT) return;
    checkedRef.current = true;
    fetch(`${API_BASE}/api/setup/status`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.setup_complete) navigate("/setup", { replace: true });
      })
      .catch(() => {});
  }, [isBootstrapping, navigate]);

  if (isBootstrapping) return null;
  if (isAuthenticated) return <Navigate to="/context-select" replace />;
  return (
    <Suspense fallback={<RouteLoading />}>
      <MarketingHome />
    </Suspense>
  );
}

export const publicRoutes = [
  <Route key="home" path="/" element={<HomeRedirect />} />,
  <Route key="mk-industries" path="/industries" element={<Suspense fallback={<RouteLoading />}><MarketingIndustriesIndex /></Suspense>} />,
  <Route key="mk-industry" path="/industries/:slug" element={<Suspense fallback={<RouteLoading />}><MarketingIndustry /></Suspense>} />,
  <Route key="mk-pricing" path="/pricing" element={<Suspense fallback={<RouteLoading />}><MarketingPricing /></Suspense>} />,
  <Route key="mk-why" path="/why-sanopos" element={<Suspense fallback={<RouteLoading />}><MarketingWhy /></Suspense>} />,
  <Route key="setup" path="/setup" element={<SetupWizard />} />,
  <Route key="login" path="/login" element={<Suspense fallback={<RouteLoading />}><LoginPage /></Suspense>} />,
  <Route key="reset-password" path="/reset-password" element={<Suspense fallback={<RouteLoading />}><ResetPassword /></Suspense>} />,
  <Route key="signup" path="/signup" element={<Suspense fallback={<RouteLoading />}><SignupPage /></Suspense>} />,
  <Route key="verify-email" path="/verify-email" element={<Suspense fallback={<RouteLoading />}><VerifyEmail /></Suspense>} />,
  <Route key="terms" path="/terms" element={<Suspense fallback={<RouteLoading />}><Terms /></Suspense>} />,
  <Route key="privacy" path="/privacy" element={<Suspense fallback={<RouteLoading />}><Privacy /></Suspense>} />,
  <Route key="receipt" path="/receipt/:invoiceNumber" element={<Suspense fallback={<RouteLoading />}><ReceiptPublicPage /></Suspense>} />,
  <Route key="gift-card" path="/gift-card/:code" element={<Suspense fallback={<RouteLoading />}><GiftCardBalancePage /></Suspense>} />,
  <Route key="access-denied" path="/access-denied" element={<AccessDenied />} />,
  <Route key="context-select" path="/context-select" element={<RequireAuth><ContextSelect /></RequireAuth>} />,
  <Route
    key="pos"
    path="/pos"
    element={
      <ErrorBoundary level="page">
        <Suspense fallback={<RouteLoading />}>
          <RequireAuth><POSRoute /></RequireAuth>
        </Suspense>
      </ErrorBoundary>
    }
  />,
  <Route
    key="pos-restaurant"
    path="/pos/restaurant"
    element={
      <ErrorBoundary level="page">
        <Suspense fallback={<RouteLoading />}>
          <RequireAuth><POSRestaurantRoute /></RequireAuth>
        </Suspense>
      </ErrorBoundary>
    }
  />,
  <Route
    key="kiosk"
    path="/kiosk"
    element={
      <ErrorBoundary level="page">
        <Suspense fallback={<RouteLoading />}>
          <RequireAuth><KioskRedesign /></RequireAuth>
        </Suspense>
      </ErrorBoundary>
    }
  />,
  /* KDS is a wall-mounted kitchen screen, not a merchant page — it lives here
     to escape AppLayoutRedesign's sidebar/top bar/breadcrumbs/SupportWidget,
     the same reason POS and the kiosk do. Unlike /customer-display it is NOT
     public: it reads real ticket data, so it keeps the auth + outlet-context
     + manage_kds guards it inherited from appRoutes, spelled out here since
     there's no shared parent route to inherit them from. */
  <Route
    key="kds"
    path="/kds"
    element={
      <ErrorBoundary level="page">
        <Suspense fallback={<RouteLoading />}>
          <RequireAuth>
            <RequireContext>
              <RequirePerm perm="manage_kds"><KDSRoute /></RequirePerm>
            </RequireContext>
          </RequireAuth>
        </Suspense>
      </ErrorBoundary>
    }
  />,
  <Route
    key="customer-display"
    path="/customer-display"
    element={<Suspense fallback={<RouteLoading />}><CustomerDisplayPage /></Suspense>}
  />,
  <Route
    key="storefront"
    path="/store/:tenantSlug"
    element={<Suspense fallback={<RouteLoading />}><StorefrontLayout /></Suspense>}
  >
    <Route index element={<StorefrontHome />} />
    <Route path="products" element={<StorefrontProducts />} />
    <Route path="products/:productId" element={<StorefrontProductDetail />} />
    <Route path="cart" element={<StorefrontCart />} />
    <Route path="checkout" element={<StorefrontCheckout />} />
    <Route path="order/:orderToken" element={<StorefrontOrderStatus />} />
  </Route>,
  <Route
    key="public-book"
    path="/book/:tenantSlug"
    element={<Suspense fallback={<RouteLoading />}><PublicBookingPage /></Suspense>}
  />,
  <Route
    key="public-book-room"
    path="/book-room/:tenantSlug"
    element={<Suspense fallback={<RouteLoading />}><PublicRoomBookingPage /></Suspense>}
  />,
  <Route
    key="public-menu"
    path="/menu/:token"
    element={<Suspense fallback={<RouteLoading />}><PublicRestaurantMenuPage /></Suspense>}
  />,
  <Route
    key="restaurant-pay"
    path="/pay/:token"
    element={<Suspense fallback={<RouteLoading />}><RestaurantPayPage /></Suspense>}
  />,
  <Route
    key="reservation-booking"
    path="/reserve/:tenantSlug"
    element={<Suspense fallback={<RouteLoading />}><ReservationBookingPage /></Suspense>}
  />,
  <Route
    key="form-fill"
    path="/forms/fill/:token"
    element={<Suspense fallback={<RouteLoading />}><FormFillPublic /></Suspense>}
  />,
  <Route
    key="member-checkin"
    path="/member-checkin"
    element={<Suspense fallback={<RouteLoading />}><MemberCheckinKiosk /></Suspense>}
  />,
  <Route
    key="public-inquire"
    path="/inquire/:tenantSlug"
    element={<Suspense fallback={<RouteLoading />}><PublicInquiryPage /></Suspense>}
  />,
  <Route
    key="portal"
    path="/portal/:tenantSlug"
    element={
      <ErrorBoundary level="page">
        <Suspense fallback={<RouteLoading />}>
          <PortalLayout />
        </Suspense>
      </ErrorBoundary>
    }
  >
    <Route index element={<Suspense fallback={<RouteLoading />}><PortalDashboard /></Suspense>} />
    <Route path="login" element={<Suspense fallback={<RouteLoading />}><PortalLogin /></Suspense>} />
    <Route path="signup" element={<Suspense fallback={<RouteLoading />}><PortalSignup /></Suspense>} />
    <Route path="verify-otp" element={<Suspense fallback={<RouteLoading />}><PortalOtpVerify /></Suspense>} />
    <Route path="forgot" element={<Suspense fallback={<RouteLoading />}><PortalForgotPassword /></Suspense>} />
    <Route path="reset" element={<Suspense fallback={<RouteLoading />}><PortalResetPassword /></Suspense>} />
    <Route path="invoices" element={<Suspense fallback={<RouteLoading />}><PortalInvoices /></Suspense>} />
    <Route path="invoices/:invoiceId" element={<Suspense fallback={<RouteLoading />}><PortalInvoiceDetail /></Suspense>} />
    <Route path="invoice-paid" element={<Suspense fallback={<RouteLoading />}><PortalInvoicePaidPage /></Suspense>} />
    <Route path="appointments" element={<Suspense fallback={<RouteLoading />}><PortalAppointments /></Suspense>} />
    <Route path="treatments" element={<Suspense fallback={<RouteLoading />}><PortalTreatments /></Suspense>} />
    <Route path="forms" element={<Suspense fallback={<RouteLoading />}><PortalForms /></Suspense>} />
    <Route path="stays" element={<Suspense fallback={<RouteLoading />}><PortalStays /></Suspense>} />
    <Route path="packages" element={<Suspense fallback={<RouteLoading />}><PortalPackages /></Suspense>} />
    <Route path="subscriptions" element={<Suspense fallback={<RouteLoading />}><PortalSubscriptions /></Suspense>} />
    <Route path="contracts" element={<Suspense fallback={<RouteLoading />}><PortalContracts /></Suspense>} />
    <Route path="tickets" element={<Suspense fallback={<RouteLoading />}><PortalTickets /></Suspense>} />
    <Route path="orders" element={<Suspense fallback={<RouteLoading />}><PortalOrders /></Suspense>} />
    <Route path="loyalty" element={<Suspense fallback={<RouteLoading />}><PortalLoyalty /></Suspense>} />
    <Route path="wallet" element={<Suspense fallback={<RouteLoading />}><PortalWallet /></Suspense>} />
    <Route path="profile" element={<Suspense fallback={<RouteLoading />}><PortalProfile /></Suspense>} />
    <Route path="gallery" element={<Suspense fallback={<RouteLoading />}><PortalGallery /></Suspense>} />
  </Route>,
  <Route
    key="manufacturer-portal"
    path="/manufacturer-portal/:tenantSlug"
    element={
      <ErrorBoundary level="page">
        <Suspense fallback={<RouteLoading />}>
          <ManufacturerPortalLayout />
        </Suspense>
      </ErrorBoundary>
    }
  >
    <Route index element={<Suspense fallback={<RouteLoading />}><ManufacturerPortalDashboard /></Suspense>} />
    <Route path="login" element={<Suspense fallback={<RouteLoading />}><ManufacturerPortalLogin /></Suspense>} />
    <Route path="setup" element={<Suspense fallback={<RouteLoading />}><ManufacturerPortalSetup /></Suspense>} />
    <Route path="forgot-password" element={<Suspense fallback={<RouteLoading />}><ManufacturerPortalForgotPassword /></Suspense>} />
    <Route path="sales" element={<Suspense fallback={<RouteLoading />}><ManufacturerPortalSales /></Suspense>} />
    <Route path="promotions" element={<Suspense fallback={<RouteLoading />}><ManufacturerPortalSchemes /></Suspense>} />
  </Route>,
];
