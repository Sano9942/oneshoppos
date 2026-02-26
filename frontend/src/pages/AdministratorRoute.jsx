import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Administrator from "./Administrator";
import AdministratorRedesign from "./redesign/AdministratorRedesign";

export default function AdministratorRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_administrator ? <AdministratorRedesign /> : <Administrator />;
}
