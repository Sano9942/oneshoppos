import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import PurchaseOrders from "./PurchaseOrders";
import PurchaseOrdersRedesign from "./redesign/PurchaseOrdersRedesign";

export default function PurchaseOrdersRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_purchase_orders ? <PurchaseOrdersRedesign /> : <PurchaseOrders />;
}
