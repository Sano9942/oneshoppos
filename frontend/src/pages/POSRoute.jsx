import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import POS from "./POS";
import POSRedesign from "./redesign/POSRedesign";

export default function POSRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_pos ? <POSRedesign /> : <POS />;
}
