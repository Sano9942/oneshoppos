import { Badge } from "../../../ui/primitives";

const TONE_BY_SOURCE = {
  override: "warning",
  supplier: "default",
  tenant: "default",
};

const LABEL_BY_SOURCE = {
  override: "override",
  supplier: "supplier",
  tenant: "default",
};

export default function LeadTimeTag({ source, days }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm text-(--ui-text)">{days}d</span>
      <Badge tone={TONE_BY_SOURCE[source] || "default"}>
        {LABEL_BY_SOURCE[source] || source}
      </Badge>
    </span>
  );
}
