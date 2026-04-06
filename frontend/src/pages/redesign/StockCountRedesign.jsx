import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BarChart2,
  CheckCircle,
  ClipboardCheck,
  Download,
  Hash,
  Package,
  Play,
  Plus,
  Search,
  X,
} from "lucide-react";
import { api } from "../../api";
import { fmtUtcDateTime } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";
import { useAuth } from "../../auth/AuthProvider";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";

const STATUS_COLORS = {
  in_progress: "blue",
  completed: "green",
  cancelled: "gray",
};

// ── List View ─────────────────────────────────────────────────────────────

function CountListView({ counts, loading, onSelect, onNew }) {
  const [statusFilter, setStatusFilter] = useState("");
  const filtered = useMemo(() => {
    if (!statusFilter) return counts;
    return counts.filter((c) => c.status === statusFilter);
  }, [counts, statusFilter]);

  return (
    <>
      <PageShell
        title="Inventory Audit"
        subtitle="Physical stock counts via barcode scanning"
        right={
          <Button onClick={onNew}>
            <Plus className="w-4 h-4 mr-1" /> Start Count
          </Button>
        }
      />
      <div className="p-4 md:p-6 space-y-4">
        <SectionCard>
          <div className="flex items-center gap-3 mb-4">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-48"
            >
              <option value="">All Statuses</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>

          {loading ? (
            <p className="text-gray-500 py-8 text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No stock counts"
              description="Start a new count to audit your inventory"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 pr-4">Count #</th>
                    <th className="pb-2 pr-4">Outlet</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Progress</th>
                    <th className="pb-2 pr-4">Started By</th>
                    <th className="pb-2 pr-4">Started At</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer"
                      onClick={() => onSelect(c.id)}
                    >
                      <td className="py-2 pr-4 font-mono">{c.count_number}</td>
                      <td className="py-2 pr-4">{c.outlet_name}</td>
                      <td className="py-2 pr-4">
                        <Badge color={STATUS_COLORS[c.status] || "gray"}>
                          {c.status === "in_progress" ? "In Progress" : c.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-gray-600">
                        {c.items_counted}/{c.total_items} counted
                      </td>
                      <td className="py-2 pr-4">{c.started_by_name || "—"}</td>
                      <td className="py-2 pr-4">{fmtUtcDateTime(c.started_at)}</td>
                      <td className="py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(c.id);
                          }}
                        >
                          {c.status === "in_progress" ? "Continue" : "View"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}

// ── New Count Dialog ──────────────────────────────────────────────────────

function NewCountDialog({ outlets, onConfirm, onCancel, saving }) {
  const [outletId, setOutletId] = useState(outlets[0]?.id || "");
  const [notes, setNotes] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold mb-4">Start New Stock Count</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Outlet</label>
            <Select
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
            >
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes (optional)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Monthly audit"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={() => onConfirm(Number(outletId), notes)} disabled={saving || !outletId}>
            {saving ? "Creating..." : "Start Count"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Counting View ─────────────────────────────────────────────────────────

function CountingView({ countId, onBack }) {
  const [count, setCount] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState(null);
  const [filter, setFilter] = useState("all"); // all | counted | uncounted | variance
  const [search, setSearch] = useState("");
  const [completing, setCompleting] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [autoAdjust, setAutoAdjust] = useState(false);
  const [completeSummary, setCompleteSummary] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editQty, setEditQty] = useState("");
  const scanRef = useRef(null);

  const loadCount = useCallback(async () => {
    try {
      const data = await api.get(`/api/stock-counts/${countId}`);
      setCount(data.stockCount);
      setItems(data.items);
    } catch (err) {
      console.error("Failed to load count:", err);
    } finally {
      setLoading(false);
    }
  }, [countId]);

  useEffect(() => {
    loadCount();
  }, [loadCount]);

  // Auto-focus scan input
  useEffect(() => {
    if (count?.status === "in_progress") {
      scanRef.current?.focus();
    }
  }, [count?.status]);

  const handleScan = async () => {
    const barcode = scanInput.trim();
    if (!barcode || scanning) return;
    setScanning(true);
    try {
      const data = await api.post(`/api/stock-counts/${countId}/scan`, { barcode });
      const scannedItem = data.item;
      // Update local state
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.product_id === scannedItem.product_id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], counted_qty: scannedItem.counted_qty, last_scanned_at: scannedItem.last_scanned_at, variance: scannedItem.variance };
          return updated;
        }
        return [scannedItem, ...prev];
      });
      setLastScanned(scannedItem);
      setScanInput("");
      // Flash feedback
      setTimeout(() => setLastScanned(null), 2000);
    } catch (err) {
      const msg = err?.message || "Scan failed";
      setLastScanned({ error: msg });
      setTimeout(() => setLastScanned(null), 3000);
    } finally {
      setScanning(false);
      scanRef.current?.focus();
    }
  };

  const handleManualQty = async (itemId) => {
    const qty = parseInt(editQty, 10);
    if (isNaN(qty) || qty < 0) return;
    try {
      const data = await api.put(`/api/stock-counts/${countId}/items/${itemId}`, { counted_qty: qty });
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, counted_qty: data.item.counted_qty, variance: data.item.variance } : i))
      );
    } catch (err) {
      console.error("Manual update failed:", err);
    }
    setEditingItemId(null);
    setEditQty("");
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const data = await api.post(
        `/api/stock-counts/${countId}/complete?auto_adjust=${autoAdjust}`
      );
      setCompleteSummary(data.summary);
      setCount((prev) => prev ? { ...prev, status: "completed" } : prev);
    } catch (err) {
      console.error("Complete failed:", err);
    } finally {
      setCompleting(false);
    }
  };

  const handleExportVariance = async () => {
    try {
      const data = await api.get(`/api/stock-counts/${countId}/variance-report`);
      downloadCsv(
        ["Product", "Barcode", "SKU", "System Qty", "Counted Qty", "Variance"],
        data.items.map((i) => [
          i.product_name, i.barcode || "", i.sku || "",
          i.system_qty, i.counted_qty, i.variance,
        ]),
        `variance-report-${data.countNumber}.csv`
      );
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const isActive = count?.status === "in_progress";
  const countedCount = items.filter((i) => i.counted_qty > 0).length;

  const filteredItems = useMemo(() => {
    let list = items;
    if (filter === "counted") list = list.filter((i) => i.counted_qty > 0);
    else if (filter === "uncounted") list = list.filter((i) => i.counted_qty === 0);
    else if (filter === "variance") list = list.filter((i) => (i.counted_qty - i.system_qty) !== 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          (i.product_name || "").toLowerCase().includes(q) ||
          (i.barcode || "").toLowerCase().includes(q) ||
          (i.sku || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, filter, search]);

  if (loading) return <p className="p-8 text-center text-gray-500">Loading count...</p>;
  if (!count) return <p className="p-8 text-center text-red-500">Count not found</p>;

  // Completion summary screen
  if (completeSummary) {
    return (
      <>
        <PageShell title="Count Complete" subtitle={count.count_number} />
        <div className="p-4 md:p-6 max-w-lg mx-auto space-y-4">
          <SectionCard>
            <div className="text-center mb-4">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <h3 className="text-lg font-semibold">Stock Count Finalized</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 dark:bg-white/5 rounded-lg p-3 text-center">
                <p className="text-gray-500">Total Items</p>
                <p className="text-xl font-bold">{completeSummary.total_items}</p>
              </div>
              <div className="bg-gray-50 dark:bg-white/5 rounded-lg p-3 text-center">
                <p className="text-gray-500">With Variance</p>
                <p className="text-xl font-bold text-amber-600">{completeSummary.items_with_variance}</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
                <p className="text-gray-500">Over (+)</p>
                <p className="text-xl font-bold text-green-600">
                  {completeSummary.items_over} items (+{completeSummary.total_over})
                </p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
                <p className="text-gray-500">Under (-)</p>
                <p className="text-xl font-bold text-red-600">
                  {completeSummary.items_under} items (-{completeSummary.total_under})
                </p>
              </div>
            </div>
            {count.status === "completed" && (
              <p className="text-xs text-gray-400 mt-3 text-center">
                {autoAdjust ? "Stock adjustments were auto-created." : "No auto-adjustments were made."}
              </p>
            )}
          </SectionCard>
          <div className="flex justify-center gap-3">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to List
            </Button>
            <Button variant="ghost" onClick={handleExportVariance}>
              <Download className="w-4 h-4 mr-1" /> Export Report
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageShell
        title={count.count_number}
        subtitle={`${count.outlet_name} — ${isActive ? "In Progress" : count.status}`}
        right={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Button variant="ghost" onClick={handleExportVariance}>
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
            {isActive && (
              <Button onClick={() => setShowComplete(true)}>
                <CheckCircle className="w-4 h-4 mr-1" /> Complete Count
              </Button>
            )}
          </div>
        }
      />

      <div className="p-4 md:p-6 space-y-4">
        {/* Scan bar */}
        {isActive && (
          <SectionCard>
            <div className="flex items-center gap-3">
              <div className="relative grow">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  ref={scanRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  placeholder="Scan barcode or type SKU..."
                  className="w-full pl-10 pr-4 py-3 text-lg border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-gray-800 dark:border-gray-700"
                  autoFocus
                />
              </div>
              <Button onClick={handleScan} disabled={scanning || !scanInput.trim()}>
                {scanning ? "..." : "Add"}
              </Button>
            </div>
            {/* Last scan feedback */}
            {lastScanned && (
              <div
                className={`mt-2 px-3 py-2 rounded-lg text-sm font-medium animate-pulse ${
                  lastScanned.error
                    ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                    : "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                }`}
              >
                {lastScanned.error
                  ? lastScanned.error
                  : `${lastScanned.product_name} — counted: ${lastScanned.counted_qty}`}
              </div>
            )}
          </SectionCard>
        )}

        {/* Progress bar */}
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{countedCount} of {items.length} products counted</span>
          <span className="font-mono">
            {items.length ? Math.round((countedCount / items.length) * 100) : 0}%
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all"
            style={{ width: `${items.length ? (countedCount / items.length) * 100 : 0}%` }}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {[
              { key: "all", label: "All" },
              { key: "counted", label: "Counted" },
              { key: "uncounted", label: "Uncounted" },
              { key: "variance", label: "Variance" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1 text-sm rounded-full transition ${
                  filter === f.key
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative grow max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
        </div>

        {/* Items table */}
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4">Product</th>
                  <th className="pb-2 pr-4 text-center">System Qty</th>
                  <th className="pb-2 pr-4 text-center">Counted</th>
                  <th className="pb-2 pr-4 text-center">Variance</th>
                  <th className="pb-2">Last Scanned</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      No items match filter
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const variance = item.counted_qty - item.system_qty;
                    return (
                      <tr
                        key={item.id}
                        className={`border-b last:border-0 ${
                          lastScanned && !lastScanned.error && lastScanned.product_id === item.product_id
                            ? "bg-green-50 dark:bg-green-900/20"
                            : ""
                        }`}
                      >
                        <td className="py-2 pr-4">
                          <div className="font-medium">{item.product_name}</div>
                          <div className="text-xs text-gray-400">
                            {item.barcode || item.sku || "—"}
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-center">{item.system_qty}</td>
                        <td className="py-2 pr-4 text-center">
                          {isActive && editingItemId === item.id ? (
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number"
                                min="0"
                                value={editQty}
                                onChange={(e) => setEditQty(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleManualQty(item.id);
                                  if (e.key === "Escape") { setEditingItemId(null); setEditQty(""); }
                                }}
                                className="w-16 text-center border rounded px-1 py-0.5 text-sm dark:bg-gray-800"
                                autoFocus
                              />
                              <button
                                onClick={() => handleManualQty(item.id)}
                                className="text-blue-600 text-xs font-medium"
                              >
                                OK
                              </button>
                            </div>
                          ) : (
                            <span
                              className={isActive ? "cursor-pointer hover:underline" : ""}
                              onClick={() => {
                                if (!isActive) return;
                                setEditingItemId(item.id);
                                setEditQty(String(item.counted_qty));
                              }}
                            >
                              {item.counted_qty}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-center">
                          <span
                            className={`font-mono font-medium ${
                              variance > 0
                                ? "text-green-600"
                                : variance < 0
                                ? "text-red-600"
                                : "text-gray-400"
                            }`}
                          >
                            {variance > 0 ? "+" : ""}
                            {variance}
                          </span>
                        </td>
                        <td className="py-2 text-xs text-gray-400">
                          {item.last_scanned_at ? fmtUtcDateTime(item.last_scanned_at) : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* Complete modal */}
      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-2">Complete Stock Count</h2>
            <p className="text-sm text-gray-500 mb-4">
              {countedCount} of {items.length} products have been counted.
              {items.length - countedCount > 0 && (
                <span className="text-amber-600 font-medium">
                  {" "}{items.length - countedCount} products were not scanned (will show 0 counted).
                </span>
              )}
            </p>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAdjust}
                onChange={(e) => setAutoAdjust(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">
                Auto-adjust stock to match counted quantities
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowComplete(false)} disabled={completing}>
                Cancel
              </Button>
              <Button onClick={handleComplete} disabled={completing}>
                {completing ? "Completing..." : "Finalize Count"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function StockCountRedesign() {
  const { hasPerm } = useAuth();
  const [view, setView] = useState("list"); // list | new | counting
  const [counts, setCounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [outlets, setOutlets] = useState([]);
  const [activeCountId, setActiveCountId] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadCounts = async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/stock-counts");
      setCounts(data.stockCounts || []);
    } catch (err) {
      console.error("Failed to load stock counts:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadOutlets = async () => {
    try {
      const data = await api.get("/api/outlets");
      setOutlets(data.outlets || []);
    } catch (err) {
      console.error("Failed to load outlets:", err);
    }
  };

  useEffect(() => {
    loadCounts();
    loadOutlets();
  }, []);

  const handleNew = () => setView("new");

  const handleCreateCount = async (outletId, notes) => {
    setSaving(true);
    try {
      const data = await api.post("/api/stock-counts", {
        outlet_id: outletId,
        notes,
      });
      setActiveCountId(data.stockCount.id);
      setView("counting");
    } catch (err) {
      console.error("Failed to create count:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = (id) => {
    setActiveCountId(id);
    setView("counting");
  };

  const handleBackToList = () => {
    setView("list");
    setActiveCountId(null);
    loadCounts();
  };

  if (view === "counting" && activeCountId) {
    return <CountingView countId={activeCountId} onBack={handleBackToList} />;
  }

  return (
    <>
      <CountListView
        counts={counts}
        loading={loading}
        onSelect={handleSelect}
        onNew={handleNew}
      />
      {view === "new" && (
        <NewCountDialog
          outlets={outlets}
          onConfirm={handleCreateCount}
          onCancel={() => setView("list")}
          saving={saving}
        />
      )}
    </>
  );
}
