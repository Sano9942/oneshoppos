import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Suppliers from "./Suppliers";
import SuppliersRedesign from "./redesign/SuppliersRedesign";

export default function SuppliersRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_suppliers ? <SuppliersRedesign /> : <Suppliers />;
}
