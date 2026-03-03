import React, { useState } from "react";
import {
  LayoutDashboard,
  Settings,
  Download,
  Link2,
  RefreshCw,
  History,
  ShieldAlert,
  CheckCircle2,
} from "lucide-react";

import { ShopifyProvider, useShopify } from "./shopify/ShopifyContext";
import ShopifyOverview from "./shopify/ShopifyOverview";
import ShopifySettings from "./shopify/ShopifySettings";
import ShopifyImport from "./shopify/ShopifyImport";
import ShopifyMappings from "./shopify/ShopifyMappings";
import ShopifyReconciliation from "./shopify/ShopifyReconciliation";
import ShopifyEvents from "./shopify/ShopifyEvents";

function ShopifyIntegrationContent() {
  const { loading, error, success, loadAll } = useShopify();
  const [activeTab, setActiveTab] = useState("overview");

  const TABS = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "settings", label: "Connection", icon: Settings },
    { id: "import", label: "Import & Sync", icon: Download },
    { id: "mappings", label: "Mappings", icon: Link2 },
    { id: "recon", label: "Reconciliation", icon: ShieldAlert },
    { id: "events", label: "Event Log", icon: History },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return <ShopifyOverview />;
      case "settings":
        return <ShopifySettings />;
      case "import":
        return <ShopifyImport />;
      case "mappings":
        return <ShopifyMappings />;
      case "recon":
        return <ShopifyReconciliation />;
      case "events":
        return <ShopifyEvents />;
      default:
        return <ShopifyOverview />;
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Shopify V2 Integration
          </h1>
          <p className="text-slate-500 mt-1">
            Modular multi-location inventory & order synchronization.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadAll()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Refreshing..." : "Refresh All"}
          </button>
        </div>
      </div>

      {/* Notifications */}
      <div className="space-y-3">
        {error && (
          <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-2xl text-sm shadow-sm animate-in fade-in slide-in-from-top-2">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <span className="font-bold underline italic block mb-0.5">
                Integration Error
              </span>
              {error}
            </div>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-2xl text-sm shadow-sm animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <span className="font-bold underline italic block mb-0.5">
                Success
              </span>
              {success}
            </div>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-fit overflow-x-auto no-scrollbar shadow-inner border border-slate-200/50">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                isActive
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="min-h-[500px] animate-in fade-in duration-500">
        {renderTabContent()}
      </div>
    </div>
  );
}

export default function ShopifyIntegration() {
  return (
    <ShopifyProvider>
      <ShopifyIntegrationContent />
    </ShopifyProvider>
  );
}
