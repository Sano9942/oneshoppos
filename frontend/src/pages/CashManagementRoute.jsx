import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import CashManagement from "./CashManagement";
import CashManagementRedesign from "./redesign/CashManagementRedesign";

export default function CashManagementRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_cash_management ? (
    <CashManagementRedesign />
  ) : (
    <CashManagement />
  );
}
