import { useState } from "react";
import { Wallet } from "lucide-react";
import { Navigate } from "react-router-dom";
import { PageShell, SectionCard } from "../../ui/primitives";
import useFeatureFlags from "../../hooks/useFeatureFlags";

export default function CODSettlementsRedesign() {
  const { flags, loading: flagsLoading } = useFeatureFlags();
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
        <div className="px-4 py-16 text-center text-(--text-muted) text-sm">
          <Wallet size={32} className="mx-auto mb-3" />
          Coming soon — view: {view.name}
        </div>
      </SectionCard>
    </PageShell>
  );
}
