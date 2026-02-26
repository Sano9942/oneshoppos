import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import ShopifyIntegration from "./ShopifyIntegration";
import ShopifyIntegrationRedesign from "./redesign/ShopifyIntegrationRedesign";

export default function ShopifyIntegrationRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_shopify ? <ShopifyIntegrationRedesign /> : <ShopifyIntegration />;
}
