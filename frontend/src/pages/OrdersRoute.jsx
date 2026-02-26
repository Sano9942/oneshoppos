import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Orders from "./Orders";
import OrdersRedesign from "./redesign/OrdersRedesign";

export default function OrdersRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_orders ? <OrdersRedesign /> : <Orders />;
}
