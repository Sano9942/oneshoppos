import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import SalesHistory from "./SalesHistory";
import SalesHistoryRedesign from "./redesign/SalesHistoryRedesign";

export default function SalesHistoryRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_sales_history ? (
    <SalesHistoryRedesign />
  ) : (
    <SalesHistory />
  );
}
