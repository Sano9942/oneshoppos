import { PageShell } from "../../ui/primitives";
import BarcodeTemplates from "../BarcodeTemplates";

export default function BarcodeTemplatesRedesign() {
  return (
    <PageShell
      title="Barcode Label Designer"
      subtitle="Configure label templates and print product barcodes in batch"
    >
      <BarcodeTemplates />
    </PageShell>
  );
}
