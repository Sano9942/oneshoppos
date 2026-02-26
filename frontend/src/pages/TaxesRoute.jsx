import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Taxes from "./Taxes";
import TaxesRedesign from "./redesign/TaxesRedesign";

export default function TaxesRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_taxes ? <TaxesRedesign /> : <Taxes />;
}
