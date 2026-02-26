import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Returns from "./Returns";
import ReturnsRedesign from "./redesign/ReturnsRedesign";

export default function ReturnsRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_returns ? <ReturnsRedesign /> : <Returns />;
}
