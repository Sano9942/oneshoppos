import { PageShell } from "../../ui/primitives";
import ReceiptTemplates from "../ReceiptTemplates";

export default function ReceiptTemplatesRedesign() {
  return (
    <PageShell
      title="Receipt Templates"
      subtitle="Customize how receipts look when printed from the POS"
    >
      <ReceiptTemplates />
    </PageShell>
  );
}
