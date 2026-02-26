import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import HRManagement from "./HRManagement";
import HRManagementRedesign from "./redesign/HRManagementRedesign";

export default function HRManagementRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_hr ? <HRManagementRedesign /> : <HRManagement />;
}
