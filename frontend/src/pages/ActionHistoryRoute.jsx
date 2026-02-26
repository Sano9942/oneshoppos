import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import ActionHistory from "./ActionHistory";
import ActionHistoryRedesign from "./redesign/ActionHistoryRedesign";

export default function ActionHistoryRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_action_history ? <ActionHistoryRedesign /> : <ActionHistory />;
}
