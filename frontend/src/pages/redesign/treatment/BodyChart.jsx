import { useMemo } from "react";

const CONDITION_COLOR = {
  healthy: "#10b981",
  caries: "#ef4444",
  restoration: "#3b82f6",
  custom: "#94a3b8",
  mobility: "#eab308",
};

/**
 * BodyChart — click-to-select body regions. Same API shape as DentalChart.
 * Renders a coarse grid of region buttons — fine enough for v1 physio /
 * vet use. Species-specific illustrations can swap in later by reading
 * `preset` (`body` | `vet_body_canine` | `vet_body_feline`).
 */
export default function BodyChart({ preset = "body", areas = [], entries = [], onAreaClick }) {
  const entryMap = useMemo(() => {
    const m = new Map();
    for (const e of entries) m.set(String(e.area_code), e);
    return m;
  }, [entries]);

  if (!areas.length) {
    return <div className="text-sm text-(--ui-text-muted) py-6 text-center">No body regions loaded</div>;
  }

  return (
    <div className="grid grid-cols-3 gap-2" data-testid="body-chart" data-preset={preset}>
      {areas.map((a) => {
        const entry = entryMap.get(String(a.area_code));
        const color = entry ? (CONDITION_COLOR[entry.condition_code] || CONDITION_COLOR.custom) : null;
        return (
          <button
            key={a.area_code}
            type="button"
            data-testid={`region-${a.area_code}`}
            data-area-code={a.area_code}
            onClick={() => onAreaClick && onAreaClick(a.area_code)}
            className="relative h-16 rounded-md border border-(--ui-border-strong) bg-(--ui-surface) hover:bg-(--ui-muted-surface) text-xs flex items-center justify-center p-2"
            title={entry ? `${a.display_name} — ${entry.condition_code}` : a.display_name}
          >
            <span className="truncate">{a.display_name}</span>
            {color && (
              <span
                className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full border border-white"
                style={{ backgroundColor: color }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
