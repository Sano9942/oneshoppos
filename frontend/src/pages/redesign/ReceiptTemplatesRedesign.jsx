import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { PageShell } from "../../ui/primitives";
import ReceiptTemplates from "../ReceiptTemplates";

export default function ReceiptTemplatesRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading } = useFeatureFlags(authHeaders);

  if (loading) return null;
  // Receipt Designer is a Business Module (default on). When a tenant turns the
  // module off, hide the surface — the backend also gates the template writes.
  if (!flags.receipt_designer_v2) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Receipt Templates"
      subtitle="Customize how receipts look when printed from the POS"
    >
      <ReceiptTemplates />
    </PageShell>
  );
}
