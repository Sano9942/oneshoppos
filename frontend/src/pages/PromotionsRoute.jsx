import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Promotions from "./Promotions";
import PromotionsRedesign from "./redesign/PromotionsRedesign";

export default function PromotionsRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_promotions ? <PromotionsRedesign /> : <Promotions />;
}
