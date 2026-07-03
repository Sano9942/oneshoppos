import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Package, Clock, DollarSign, AlertTriangle } from "lucide-react";
import { api } from "../../api";
import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "../../contexts/CurrencyContext";

const ICON_MAP = {
  revenue_trend: DollarSign,
  top_products: Package,
  low_stock: AlertTriangle,
  busiest_hour: Clock,
  avg_transaction: DollarSign,
};

// Near-monochrome icon badges — only low stock keeps a (pale) warning tint.
const COLOR_MAP = {
  revenue_trend: "text-(--ui-text) bg-(--ui-muted-surface)",
  top_products: "text-(--ui-text) bg-(--ui-muted-surface)",
  low_stock: "text-(--ui-warning-fg) bg-(--ui-warning-bg)",
  busiest_hour: "text-(--ui-text) bg-(--ui-muted-surface)",
  avg_transaction: "text-(--ui-text) bg-(--ui-muted-surface)",
};

function TrendBadge({ trend }) {
  if (trend == null) return null;
  const isUp = trend >= 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        isUp ? "bg-(--ui-success-bg) text-(--ui-success-fg)" : "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
      }`}
    >
      <Icon size={12} />
      {Math.abs(trend)}%
    </span>
  );
}

export function InsightCards() {
  const { fmt } = useCurrency();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.get("/api/insights/auto")
      .then((data) => {
        if (mounted) setCards(data.cards || []);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  if (loading || cards.length === 0) return null;

  return (
    <div className="mb-4">
      <h3 className="mb-2 text-base font-bold text-(--ui-text)">Insights</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = ICON_MAP[card.type] || DollarSign;
          const colorCls = COLOR_MAP[card.type] || "text-(--ui-text) bg-(--ui-muted-surface)";
          const isCurrency = card.type === "revenue_trend" || card.type === "avg_transaction";

          return (
            <SectionCard key={card.type} className="p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center justify-center rounded-lg p-2 ${colorCls}`}>
                    <Icon size={16} />
                  </span>
                  <span className="text-sm font-medium text-(--ui-text-muted)">
                    {card.title}
                  </span>
                </div>
                {card.trend != null && <TrendBadge trend={card.trend} />}
              </div>
              <p className="text-xl font-bold text-(--ui-text)">
                {isCurrency ? fmt(Number(card.value)) : card.value}
              </p>
              <p className="text-xs text-(--ui-text-muted)">{card.detail}</p>
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
