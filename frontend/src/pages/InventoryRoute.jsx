import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Inventory from "./Inventory";
import InventoryRedesign from "./InventoryRedesign";

// Route-level switch keeps rollback easy during phased redesign.
export default function InventoryRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);

  if (flags.ui_redesign_inventory) {
    return <InventoryRedesign />;
  }
  return <Inventory />;
}
