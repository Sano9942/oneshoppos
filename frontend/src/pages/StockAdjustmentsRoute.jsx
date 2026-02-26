import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import StockAdjustments from "./StockAdjustments";
import StockAdjustmentsRedesign from "./redesign/StockAdjustmentsRedesign";

export default function StockAdjustmentsRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_stock_adjustments ? <StockAdjustmentsRedesign /> : <StockAdjustments />;
}
