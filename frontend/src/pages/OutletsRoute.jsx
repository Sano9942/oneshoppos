import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Outlets from "./Outlets";
import OutletsRedesign from "./redesign/OutletsRedesign";

export default function OutletsRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_outlets ? <OutletsRedesign /> : <Outlets />;
}
