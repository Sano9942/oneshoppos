import AppLayout from "./AppLayout";
import AppLayoutRedesign from "./AppLayoutRedesign";
import useFeatureFlags from "../hooks/useFeatureFlags";
import { useAuth } from "../auth/AuthProvider";

export default function AppLayoutSwitch() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  if (flags.ui_redesign_enabled) return <AppLayoutRedesign />;
  return <AppLayout />;
}
