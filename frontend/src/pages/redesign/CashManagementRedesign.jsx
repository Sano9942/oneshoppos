import CashManagement from "../CashManagement";
import ModuleRedesignShell from "./ModuleRedesignShell";

export default function CashManagementRedesign() {
  return (
    <ModuleRedesignShell
      title="Cash Management"
      subtitle="Shopify-style shift and till operation controls"
    >
      <CashManagement />
    </ModuleRedesignShell>
  );
}
