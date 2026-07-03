import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { useAuth } from "./auth/AuthProvider";
import ImpersonationBanner from "./ui/ImpersonationBanner";
import SubscriptionBanner from "./ui/SubscriptionBanner";
import PwaInstallPrompt from "./ui/PwaInstallPrompt";
import { publicRoutes } from "./routes/publicRoutes";
import { appRoutes } from "./routes/appRoutes";
import { adminRoutes } from "./routes/adminRoutes";

function App() {
  const { isImpersonating } = useAuth();

  return (
    <>
      {isImpersonating && <ImpersonationBanner />}
      <Router>
        <SubscriptionBanner />
        <PwaInstallPrompt />
        <Routes>
          {publicRoutes}
          {appRoutes}
          {adminRoutes}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </>
  );
}

export default App;
