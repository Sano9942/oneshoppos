import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Accounting from "./Accounting";
import AccountingRedesign from "./redesign/AccountingRedesign";

export default function AccountingRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_accounting ? <AccountingRedesign /> : <Accounting />;
}
