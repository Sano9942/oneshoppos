import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { PageShell } from "../../ui/primitives";
import Approvals from "../Approvals";

export default function ApprovalsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading } = useFeatureFlags(authHeaders);

  if (loading) return null;
  if (!flags.approvals) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Approval Workflow"
      subtitle="Review and approve purchase orders, stock transfers, and reconciliation fixes"
    >
      <Approvals />
    </PageShell>
  );
}
