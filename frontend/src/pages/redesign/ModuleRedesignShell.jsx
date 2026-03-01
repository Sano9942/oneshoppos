import { PageShell, SectionCard } from "../../ui/primitives";

export default function ModuleRedesignShell({
  title,
  subtitle,
  children,
  note = "Redesigned shell enabled via feature flag. Business logic remains unchanged.",
}) {
  return (
    <PageShell title={title} subtitle={subtitle}>
      <SectionCard className="p-3">
        <p className="mb-3 text-xs text-(--ui-text-muted)">{note}</p>
        <div>{children}</div>
      </SectionCard>
    </PageShell>
  );
}
