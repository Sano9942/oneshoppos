import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Transfers from "./Transfers";
import TransfersRedesign from "./redesign/TransfersRedesign";

export default function TransfersRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_transfers ? <TransfersRedesign /> : <Transfers />;
}
