import { PageShell } from "../../ui/primitives";
import Approvals from "../Approvals";

export default function ApprovalsRedesign() {
  return (
    <PageShell
      title="Approval Workflow"
      subtitle="Review and approve purchase orders, stock transfers, and reconciliation fixes"
    >
      <Approvals />
    </PageShell>
  );
}
