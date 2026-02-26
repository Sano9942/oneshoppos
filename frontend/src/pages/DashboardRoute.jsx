import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Dashboard from "./Dashboard";
import DashboardRedesign from "./redesign/DashboardRedesign";

export default function DashboardRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_dashboard ? <DashboardRedesign /> : <Dashboard />;
}
