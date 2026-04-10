import { useState } from "react";
import { Navigate } from "react-router-dom";
import { PageShell, SectionCard } from "../../ui/primitives";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useAuth } from "../../auth/AuthProvider";
import BatchList from "./cod/BatchList";
import ImportWizard from "./cod/ImportWizard";
import BatchDetail from "./cod/BatchDetail";

export default function CODSettlementsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const [view, setView] = useState({ name: "list" });

  if (flagsLoading) {
    return (
      <PageShell title="COD Settlements">
        <SectionCard>
          <div className="py-16 text-center text-(--text-muted) text-sm">Loading…</div>
        </SectionCard>
      </PageShell>
    );
  }

  if (!flags?.phase5_cod_reconciliation) {
    return <Navigate to="/" replace />;
  }

  return (
    <PageShell
      title="COD Settlements"
      subtitle="Reconcile cash-on-delivery remittances from couriers"
    >
      <SectionCard>
        {view.name === "list" && (
          <BatchList
            onOpenImport={() => setView({ name: "import" })}
            onOpenBatch={(batchId) => setView({ name: "detail", batchId })}
          />
        )}
        {view.name === "import" && (
          <ImportWizard
            onCancel={() => setView({ name: "list" })}
            onComplete={(batchId) => setView({ name: "detail", batchId })}
          />
        )}
        {view.name === "detail" && (
          <BatchDetail
            batchId={view.batchId}
            onBack={() => setView({ name: "list" })}
          />
        )}
      </SectionCard>
    </PageShell>
  );
}
