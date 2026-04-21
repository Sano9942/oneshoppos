import { useState } from "react";
import { PageShell, SectionCard, Button } from "../../ui/primitives";
import DashboardCards from "./inventory-intelligence/DashboardCards";
import ABCTab from "./inventory-intelligence/ABCTab";
import ReorderTab from "./inventory-intelligence/ReorderTab";
import CycleCountsTab from "./inventory-intelligence/CycleCountsTab";
import AgingTab from "./inventory-intelligence/AgingTab";

const TABS = [
  { id: "abc", label: "ABC Analysis" },
  { id: "reorder", label: "Reorder" },
  { id: "cycle-counts", label: "Cycle Counts" },
  { id: "aging", label: "Aging" },
];

export default function InventoryIntelligenceRedesign() {
  const [tab, setTab] = useState("abc");

  return (
    <PageShell
      title="Inventory Intelligence"
      subtitle="ABC classification, velocity-based reorder, cycle counts, and aging — refreshed nightly at 02:00 UTC"
    >
      <DashboardCards onSelectTab={setTab} />

      <SectionCard>
        <div className="border-b border-(--ui-border)">
          <nav className="-mb-px flex flex-wrap gap-6 px-4" aria-label="Tabs">
            {TABS.map((t) => (
              <Button
                key={t.id}
                tone="plain"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`rounded-none border-b-2 bg-transparent! px-4 py-3 text-sm font-medium ${
                  tab === t.id
                    ? "border-(--ui-primary) text-(--ui-text)"
                    : "border-transparent text-(--ui-text-muted) hover:text-(--ui-text)"
                }`}
              >
                {t.label}
              </Button>
            ))}
          </nav>
        </div>

        <div className="p-4">
          {tab === "abc" && <ABCTab />}
          {tab === "reorder" && <ReorderTab />}
          {tab === "cycle-counts" && <CycleCountsTab />}
          {tab === "aging" && <AgingTab />}
        </div>
      </SectionCard>
    </PageShell>
  );
}
