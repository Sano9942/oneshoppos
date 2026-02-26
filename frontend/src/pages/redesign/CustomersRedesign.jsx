import Customers from "../Customers";
import ModuleRedesignShell from "./ModuleRedesignShell";

export default function CustomersRedesign() {
  return (
    <ModuleRedesignShell
      title="Customers"
      subtitle="Shopify-style customer management list and actions"
    >
      <Customers />
    </ModuleRedesignShell>
  );
}
