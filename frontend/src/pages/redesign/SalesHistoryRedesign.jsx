import SalesHistory from "../SalesHistory";
import ModuleRedesignShell from "./ModuleRedesignShell";

export default function SalesHistoryRedesign() {
  return (
    <ModuleRedesignShell
      title="Sales History"
      subtitle="Shopify-style timeline and order detail exploration"
    >
      <SalesHistory />
    </ModuleRedesignShell>
  );
}
