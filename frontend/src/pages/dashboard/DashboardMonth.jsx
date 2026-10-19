// One Toy Store G4 (owner, 2026-10-19): what iPOS's dashboard shows and
// SanoPOS didn't — gross margin % today and this month (profit ÷ sale), month
// sale and month purchase, and the top 50 toys of the last 30 days by sale
// amount (top 10 here, "Show all 50" for the rest). Margin and purchase
// figures are finance-class; the server strips them for other roles.
import { useState } from "react";
import { SectionCard, Button, Modal } from "../../ui/primitives";
import { useCurrency } from "./DashboardShared";
import { downloadCsv } from "../../utils/csvExport";

const pctText = (v) => (v === null || v === undefined ? "—" : `${v}%`);

function MonthTile({ label, value, sub, testId }) {
  return (
    <SectionCard className="flex flex-col gap-0.5 p-4">
      <div data-testid={testId}>
        <p className="text-[13px] font-medium text-(--ui-text-muted)">{label}</p>
        <p className="text-xl font-bold text-(--ui-text)">{value}</p>
        {sub && <p className="text-xs text-(--ui-text-muted)">{sub}</p>}
      </div>
    </SectionCard>
  );
}

export function DashboardMonthRow({ data, canFinancial }) {
  const { fmt } = useCurrency();
  if (!data) return null;
  return (
    <div data-testid="dashboard-month" className={`grid grid-cols-2 gap-4 ${canFinancial ? "lg:grid-cols-4" : ""}`}>
      {canFinancial && (
        <MonthTile
          testId="margin-today"
          label="Margin today"
          value={pctText(data.todayMarginPct)}
          sub={`Gross profit ${fmt(data.todayGrossProfit ?? 0)}`}
        />
      )}
      {canFinancial && (
        <MonthTile
          testId="margin-month"
          label="Margin this month"
          value={pctText(data.monthMarginPct)}
          sub={`Gross margin ${fmt(data.monthGrossMargin ?? 0)}`}
        />
      )}
      <MonthTile testId="month-sale" label="Month sale" value={fmt(data.monthSales ?? 0)} />
      {canFinancial && (
        <MonthTile testId="month-purchase" label="Month purchase" value={fmt(data.monthPurchases ?? 0)} />
      )}
    </div>
  );
}

function TopItemsTable({ rows, canFinancial, fmt }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-(--ui-text-muted)">
          <th className="py-1 pr-2 font-medium">#</th>
          <th className="py-1 pr-2 font-medium">Toy</th>
          <th className="py-1 pr-2 text-right font-medium">Units</th>
          <th className="py-1 pr-2 text-right font-medium">Sale</th>
          {canFinancial && <th className="py-1 text-right font-medium">Margin</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.product_id} data-testid="top-item" className="border-t border-(--ui-border)">
            <td className="py-1.5 pr-2 text-xs text-(--ui-text-muted)">{i + 1}</td>
            <td className="py-1.5 pr-2 text-(--ui-text)">{r.name}</td>
            <td className="py-1.5 pr-2 text-right text-(--ui-text-muted)">{Number(r.units || 0).toLocaleString("en-US")}</td>
            <td className="py-1.5 pr-2 text-right font-semibold text-(--ui-text)">{fmt(r.amount)}</td>
            {canFinancial && <td className="py-1.5 text-right text-(--ui-text-muted)">{pctText(r.margin_pct)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DashboardTopItems({ data, canFinancial }) {
  const { fmt } = useCurrency();
  const [showAll, setShowAll] = useState(false);
  const rows = data?.topItems30d || [];
  if (!rows.length) return null;

  const exportAll = () =>
    downloadCsv(
      ["#", "Toy", "Barcode", "Units", "Sale", ...(canFinancial ? ["Margin %"] : [])],
      rows.map((r, i) => [i + 1, r.name, r.barcode || "", r.units, r.amount, ...(canFinancial ? [r.margin_pct ?? ""] : [])]),
      "top_50_items_30d",
    );

  return (
    <div data-testid="top-items">
      <SectionCard className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-(--ui-text)">Top 50 Items (30d)</h3>
          {rows.length > 10 && (
            <Button size="sm" onClick={() => setShowAll(true)}>
              Show all {rows.length}
            </Button>
          )}
        </div>
        <TopItemsTable rows={rows.slice(0, 10)} canFinancial={canFinancial} fmt={fmt} />
      </SectionCard>
      <Modal open={showAll} onClose={() => setShowAll(false)} title="Top 50 Items (30d)" size="xl">
        <div data-testid="top-items-all" className="max-h-[70vh] overflow-y-auto">
          <TopItemsTable rows={rows} canFinancial={canFinancial} fmt={fmt} />
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={exportAll}>Download CSV</Button>
        </div>
      </Modal>
    </div>
  );
}
