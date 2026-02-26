import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import AttributeSets from "./AttributeSets";
import AttributeSetsRedesign from "./redesign/AttributeSetsRedesign";

export default function AttributeSetsRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_attribute_sets ? <AttributeSetsRedesign /> : <AttributeSets />;
}
