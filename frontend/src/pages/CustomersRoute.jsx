import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Customers from "./Customers";
import CustomersRedesign from "./redesign/CustomersRedesign";

export default function CustomersRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_customers ? <CustomersRedesign /> : <Customers />;
}
