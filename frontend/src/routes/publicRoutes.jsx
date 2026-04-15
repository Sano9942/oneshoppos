import { Suspense, lazy, useEffect, useRef } from "react";
import { Navigate, Route, useNavigate } from "react-router-dom";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { useAuth } from "../auth/AuthProvider";
import { IS_MULTI_TENANT, API_BASE } from "../config";
import RequireAuth from "../components/RequireAuth";
import LandingPage from "../pages/LandingPage";
import SetupWizard from "../pages/SetupWizard";
import AccessDenied from "../pages/AccessDenied";
import ContextSelect from "../pages/ContextSelect";
import RouteLoading from "./RouteLoading";

const POSRoute = lazy(() => import("../pages/POSRoute"));
const LandingPagePreview = lazy(() => import("../pages/LandingPagePreview"));
const KioskRedesign = lazy(() => import("../pages/redesign/KioskRedesign"));
const CustomerDisplayPage = lazy(() => import("../pages/CustomerDisplayPage"));
const ReceiptPublicPage = lazy(() => import("../pages/ReceiptPublicPage"));
const ResetPassword = lazy(() => import("../pages/ResetPassword"));
const SignupPage = lazy(() => import("../pages/SignupPage"));
const StorefrontLayout = lazy(() => import("../pages/storefront/StorefrontLayout"));
const StorefrontHome = lazy(() => import("../pages/storefront/StorefrontHome"));
const StorefrontProducts = lazy(() => import("../pages/storefront/StorefrontProducts"));
const StorefrontProductDetail = lazy(() => import("../pages/storefront/StorefrontProductDetail"));
const StorefrontCart = lazy(() => import("../pages/storefront/StorefrontCart"));
const StorefrontCheckout = lazy(() => import("../pages/storefront/StorefrontCheckout"));
const StorefrontOrderStatus = lazy(() => import("../pages/storefront/StorefrontOrderStatus"));
const PublicBookingPage = lazy(() => import("../pages/public/PublicBookingPage"));
const PublicRestaurantMenuPage = lazy(() => import("../pages/public/PublicRestaurantMenuPage"));

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
const PortalOrders = lazy(() => import("../pages/portal/PortalOrders"));
const PortalLoyalty = lazy(() => import("../pages/portal/PortalLoyalty"));
const PortalWallet = lazy(() => import("../pages/portal/PortalWallet"));
const PortalProfile = lazy(() => import("../pages/portal/PortalProfile"));

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
      <LandingPagePreview />
    </Suspense>
  );
}

export const publicRoutes = [
  <Route key="home" path="/" element={<HomeRedirect />} />,
  <Route key="landing-preview" path="/landing-preview" element={<Suspense fallback={<RouteLoading />}><LandingPagePreview /></Suspense>} />,
  <Route key="setup" path="/setup" element={<SetupWizard />} />,
  <Route key="login" path="/login" element={<LandingPage />} />,
  <Route key="reset-password" path="/reset-password" element={<Suspense fallback={<RouteLoading />}><ResetPassword /></Suspense>} />,
  <Route key="signup" path="/signup" element={<Suspense fallback={<RouteLoading />}><SignupPage /></Suspense>} />,
  <Route key="receipt" path="/receipt/:invoiceNumber" element={<Suspense fallback={<RouteLoading />}><ReceiptPublicPage /></Suspense>} />,
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
    key="public-menu"
    path="/menu/:token"
    element={<Suspense fallback={<RouteLoading />}><PublicRestaurantMenuPage /></Suspense>}
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
    <Route path="stays" element={<Suspense fallback={<RouteLoading />}><PortalStays /></Suspense>} />
    <Route path="orders" element={<Suspense fallback={<RouteLoading />}><PortalOrders /></Suspense>} />
    <Route path="loyalty" element={<Suspense fallback={<RouteLoading />}><PortalLoyalty /></Suspense>} />
    <Route path="wallet" element={<Suspense fallback={<RouteLoading />}><PortalWallet /></Suspense>} />
    <Route path="profile" element={<Suspense fallback={<RouteLoading />}><PortalProfile /></Suspense>} />
  </Route>,
];
