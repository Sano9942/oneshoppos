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
const KioskRedesign = lazy(() => import("../pages/redesign/KioskRedesign"));
const CustomerDisplayPage = lazy(() => import("../pages/CustomerDisplayPage"));
const ReceiptPublicPage = lazy(() => import("../pages/ReceiptPublicPage"));
const ResetPassword = lazy(() => import("../pages/ResetPassword"));
const SignupPage = lazy(() => import("../pages/SignupPage"));

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
  return <LandingPage />;
}

export const publicRoutes = [
  <Route key="home" path="/" element={<HomeRedirect />} />,
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
];
