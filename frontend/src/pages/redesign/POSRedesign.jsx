import POS from "../POS";
import ModuleRedesignShell from "./ModuleRedesignShell";

export default function POSRedesign() {
  return (
    <ModuleRedesignShell
      title="Point of Sale"
      subtitle="Shopify-style register surface"
      note="POS redesign shell is active. Existing POS internals are preserved in this phase."
    >
      <POS />
    </ModuleRedesignShell>
  );
}
