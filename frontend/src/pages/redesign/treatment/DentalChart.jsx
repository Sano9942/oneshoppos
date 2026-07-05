import { useMemo } from "react";

// Color per condition — used as overlay dot on a tooth
const CONDITION_COLOR = {
  healthy: "#10b981",
  caries: "#ef4444",
  restoration: "#3b82f6",
  extraction: "#6b7280",
  crown: "#f59e0b",
  root_canal: "#8b5cf6",
  missing: "#0f172a",
  implant: "#06b6d4",
  mobility: "#eab308",
  plaque: "#a3a3a3",
  gingivitis: "#ec4899",
  custom: "#94a3b8",
};

/**
 * DentalChart — adult (32) or primary (20) dentition.
 * Click a tooth to open an entry drawer (handled by parent).
 *
 * Props:
 *   preset: "dental_adult" | "dental_primary"
 *   entries: [{ area_code, condition_code, severity }] — latest entry per area
 *   onToothClick: (areaCode) => void
 */
export default function DentalChart({ preset = "dental_adult", entries = [], onToothClick }) {
  const entryMap = useMemo(() => {
    const m = new Map();
    for (const e of entries) m.set(String(e.area_code), e);
    return m;
  }, [entries]);

  // Layout: upper row right-to-left, then lower row left-to-right
  const teeth = useMemo(() => {
    if (preset === "dental_primary") {
      // A-J upper (right→left), K-T lower (left→right)
      const upper = ["A","B","C","D","E","F","G","H","I","J"];
      const lower = ["K","L","M","N","O","P","Q","R","S","T"];
      return { upper, lower };
    }
    // adult 1-32
    const upper = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].map(String);
    const lower = [17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32].map(String);
    return { upper, lower };
  }, [preset]);

  const renderTooth = (code) => {
    const entry = entryMap.get(String(code));
    const color = entry ? (CONDITION_COLOR[entry.condition_code] || CONDITION_COLOR.custom) : null;
    return (
      <button
        key={code}
        type="button"
        data-testid={`tooth-${code}`}
        data-area-code={code}
        data-condition={entry ? entry.condition_code : ""}
        onClick={() => onToothClick && onToothClick(String(code))}
        className="relative w-10 h-14 rounded-md border border-(--ui-border-strong) bg-(--ui-surface) hover:bg-(--ui-muted-surface) flex flex-col items-center justify-center text-xs"
        title={entry ? `${code} — ${entry.condition_code}${entry.severity ? ` (${entry.severity})` : ""}` : String(code)}
      >
        <span className="font-mono font-semibold text-(--ui-text)">{code}</span>
        {color && (
          <span
            className="absolute bottom-1 w-3 h-3 rounded-full border border-white"
            style={{ backgroundColor: color }}
            data-testid={`tooth-${code}-marker`}
          />
        )}
      </button>
    );
  };

  return (
    <div className="space-y-3" data-testid="dental-chart" data-preset={preset}>
      <div className="flex flex-wrap gap-1.5 justify-center" data-testid="dental-chart-upper">
        {teeth.upper.map(renderTooth)}
      </div>
      <div className="flex flex-wrap gap-1.5 justify-center" data-testid="dental-chart-lower">
        {teeth.lower.map(renderTooth)}
      </div>
      <ChartLegend />
    </div>
  );
}

function ChartLegend() {
  const items = [
    ["healthy", "Healthy"],
    ["caries", "Caries"],
    ["restoration", "Restoration"],
    ["crown", "Crown"],
    ["root_canal", "Root Canal"],
    ["extraction", "Extraction"],
    ["missing", "Missing"],
    ["implant", "Implant"],
    ["gingivitis", "Gingivitis"],
  ];
  return (
    <div className="flex flex-wrap gap-2 justify-center text-[10px] text-(--ui-text-muted) mt-2">
      {items.map(([code, label]) => (
        <span key={code} className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CONDITION_COLOR[code] }} />
          {label}
        </span>
      ))}
    </div>
  );
}
