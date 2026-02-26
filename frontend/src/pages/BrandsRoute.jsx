import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Brands from "./Brands";
import BrandsRedesign from "./redesign/BrandsRedesign";

export default function BrandsRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_brands ? <BrandsRedesign /> : <Brands />;
}
