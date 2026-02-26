import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import ReturnedStock from "./ReturnedStock";
import ReturnedStockRedesign from "./redesign/ReturnedStockRedesign";

export default function ReturnedStockRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_returned_stock ? <ReturnedStockRedesign /> : <ReturnedStock />;
}
