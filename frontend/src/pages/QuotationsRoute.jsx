import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Quotations from "./Quotations";
import QuotationsRedesign from "./redesign/QuotationsRedesign";

export default function QuotationsRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_quotations ? <QuotationsRedesign /> : <Quotations />;
}
