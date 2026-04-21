import { useState } from "react";
import { PageShell, SectionCard, TabBar } from "../../ui/primitives";
import DashboardCards from "./inventory-intelligence/DashboardCards";
import ABCTab from "./inventory-intelligence/ABCTab";
import ReorderTab from "./inventory-intelligence/ReorderTab";
import CycleCountsTab from "./inventory-intelligence/CycleCountsTab";
import AgingTab from "./inventory-intelligence/AgingTab";

const TABS = [
  { value: "abc", label: "ABC Analysis" },
  { value: "reorder", label: "Reorder" },
  { value: "cycle-counts", label: "Cycle Counts" },
  { value: "aging", label: "Aging" },
];

export default function InventoryIntelligenceRedesign() {
  const [tab, setTab] = useState("abc");

  return (
    <PageShell
      title="Inventory Intelligence"
      subtitle="ABC classification, velocity-based reorder, cycle counts, and aging — refreshed nightly at 02:00 UTC"
    >
      <DashboardCards onSelectTab={setTab} />

      <div className="mt-4">
        <TabBar value={tab} onChange={setTab} tabs={TABS} />
      </div>

      <SectionCard className="mt-4 p-4">
        {tab === "abc" && <ABCTab />}
        {tab === "reorder" && <ReorderTab />}
        {tab === "cycle-counts" && <CycleCountsTab />}
        {tab === "aging" && <AgingTab />}
      </SectionCard>
    </PageShell>
  );
}
