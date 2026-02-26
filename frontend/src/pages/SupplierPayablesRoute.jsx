import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import SupplierPayables from "./SupplierPayables";
import SupplierPayablesRedesign from "./redesign/SupplierPayablesRedesign";

export default function SupplierPayablesRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_supplier_payables ? <SupplierPayablesRedesign /> : <SupplierPayables />;
}
