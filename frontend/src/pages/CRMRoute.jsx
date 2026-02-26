import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import CRM from "./CRM";
import CRMRedesign from "./redesign/CRMRedesign";

export default function CRMRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_crm ? <CRMRedesign /> : <CRM />;
}
