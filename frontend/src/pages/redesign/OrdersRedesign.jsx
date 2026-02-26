import Orders from "../Orders";
import ModuleRedesignShell from "./ModuleRedesignShell";

export default function OrdersRedesign() {
  return (
    <ModuleRedesignShell
      title="Orders"
      subtitle="Shopify-style order operations workspace"
    >
      <Orders />
    </ModuleRedesignShell>
  );
}
