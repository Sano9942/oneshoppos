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
} from "lucide-react";
import { api } from "../../api";
import { fmtUtcDateTime } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../../contexts/ToastContext";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";

const STATUS_TONES = {
  in_progress: "warning",
  completed: "success",
  cancelled: "default",
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
            <p className="text-(--ui-text-muted) py-8 text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={28} />}
              title="No stock counts"
              body="Start a new count to audit your inventory"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
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
                      className="border-b border-(--ui-border) last:border-0 hover:bg-(--ui-muted-surface) cursor-pointer"
                      onClick={() => onSelect(c.id)}
                    >
                      <td className="py-2 pr-4 font-mono">{c.count_number}</td>
                      <td className="py-2 pr-4">{c.outlet_name}</td>
                      <td className="py-2 pr-4">
                        <Badge tone={STATUS_TONES[c.status] || "default"}>
                          {c.status === "in_progress" ? "In Progress" : c.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-(--ui-text-muted)">
                        {c.items_counted}/{c.total_items} counted
                      </td>
                      <td className="py-2 pr-4">{c.started_by_name || "—"}</td>
                      <td className="py-2 pr-4">{fmtUtcDateTime(c.started_at)}</td>
                      <td className="py-2">
                        <Button
                          tone="plain"
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

function NewCountDialog({ open, outlets, onConfirm, onCancel, saving }) {
  const [outletId, setOutletId] = useState(outlets[0]?.id || "");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setOutletId(outlets[0]?.id || "");
      setNotes("");
    }
  }, [open, outlets]);

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onCancel}
      title="Start New Stock Count"
      size="md"
    >
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
      <ModalFooter>
        <Button onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button tone="primary" onClick={() => onConfirm(Number(outletId), notes)} disabled={saving || !outletId}>
          {saving ? "Creating..." : "Start Count"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Counting View ─────────────────────────────────────────────────────────

function CountingView({ countId, onBack }) {
  const toast = useToast();
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
  const [fullCount, setFullCount] = useState(false);
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
      toast.error(err.message || "Failed to load stock count");
    } finally {
      setLoading(false);
    }
  }, [countId, toast]);

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
        const idx = prev.findIndex(
          (i) => i.product_id === scannedItem.product_id && (i.variant_id ?? null) === (scannedItem.variant_id ?? null)
        );
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
        prev.map((i) => (i.id === itemId ? { ...i, counted_qty: data.item.counted_qty, last_scanned_at: data.item.last_scanned_at, variance: data.item.variance } : i))
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
        `/api/stock-counts/${countId}/complete?auto_adjust=${autoAdjust}&full_count=${autoAdjust && fullCount}`
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
  // Counted = scanned or typed in (a line counted as 0 is still counted).
  const isCounted = (i) => Boolean(i.last_scanned_at);
  const countedCount = items.filter(isCounted).length;

  const filteredItems = useMemo(() => {
    let list = items;
    if (filter === "counted") list = list.filter(isCounted);
    else if (filter === "uncounted") list = list.filter((i) => !isCounted(i));
    else if (filter === "variance") list = list.filter((i) => isCounted(i) && (i.counted_qty - i.system_qty) !== 0);
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

  if (loading) return <p className="p-8 text-center text-(--ui-text-muted)">Loading count...</p>;
  if (!count) return <p className="p-8 text-center text-(--ui-danger-fg)">Count not found</p>;

  // Completion summary screen
  if (completeSummary) {
    return (
      <>
        <PageShell title="Count Complete" subtitle={count.count_number} />
        <div className="p-4 md:p-6 max-w-lg mx-auto space-y-4">
          <SectionCard>
            <div className="text-center mb-4">
              <CheckCircle className="w-12 h-12 text-(--ui-success-fg) mx-auto mb-2" />
              <h3 className="text-lg font-semibold">Stock Count Finalized</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3 text-center">
                <p className="text-(--ui-text-muted)">Total Items</p>
                <p className="text-xl font-bold">{completeSummary.total_items}</p>
              </div>
              <div className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3 text-center">
                <p className="text-(--ui-text-muted)">With Variance</p>
                <p className="text-xl font-bold text-(--ui-warning-fg)">{completeSummary.items_with_variance}</p>
              </div>
              <div className="bg-(--ui-success-bg) rounded-(--ui-radius-sm) p-3 text-center">
                <p className="text-(--ui-text-muted)">Over (+)</p>
                <p className="text-xl font-bold text-(--ui-success-fg)">
                  {completeSummary.items_over} items (+{completeSummary.total_over})
                </p>
              </div>
              <div className="bg-(--ui-danger-bg) rounded-(--ui-radius-sm) p-3 text-center">
                <p className="text-(--ui-text-muted)">Under (-)</p>
                <p className="text-xl font-bold text-(--ui-danger-fg)">
                  {completeSummary.items_under} items (-{completeSummary.total_under})
                </p>
              </div>
            </div>
            {count.status === "completed" && (
              <p className="text-xs text-(--ui-text-muted) mt-3 text-center">
                {!autoAdjust
                  ? "No auto-adjustments were made."
                  : fullCount
                  ? "Full count: stock was set to the counted quantities, and everything not counted was set to 0."
                  : `Stock was adjusted for the counted items only. ${completeSummary.items_not_counted} items not counted were left unchanged.`}
              </p>
            )}
          </SectionCard>
          <div className="flex justify-center gap-3">
            <Button tone="plain" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to List
            </Button>
            <Button tone="plain" onClick={handleExportVariance}>
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
            <Button tone="plain" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Button tone="plain" onClick={handleExportVariance}>
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
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-(--ui-text-muted)" />
                <input
                  ref={scanRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  placeholder="Scan barcode or type SKU..."
                  className="w-full pl-10 pr-4 py-3 text-lg border border-(--ui-border-strong) rounded-(--ui-radius-sm) focus:ring-2 focus:ring-(--ui-focus) focus:outline-none"
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
                    ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
                    : "bg-(--ui-success-bg) text-(--ui-success-fg)"
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
        <div className="flex items-center justify-between text-sm text-(--ui-text-muted)">
          <span>{countedCount} of {items.length} products counted</span>
          <span className="font-mono">
            {items.length ? Math.round((countedCount / items.length) * 100) : 0}%
          </span>
        </div>
        <div className="w-full bg-(--ui-muted-surface) rounded-full h-2">
          <div
            className="bg-(--ui-primary) h-2 rounded-full transition-all"
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
                    ? "bg-(--ui-primary) text-white"
                    : "bg-(--ui-muted-surface) text-(--ui-text-muted) hover:bg-(--ui-border-strong)"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative grow max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-(--ui-text-muted)" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-(--ui-border-strong) rounded-(--ui-radius-sm)"
            />
          </div>
        </div>

        {/* Items table */}
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
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
                    <td colSpan={5} className="py-8 text-center text-(--ui-text-muted)">
                      No items match filter
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const variance = item.counted_qty - item.system_qty;
                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-(--ui-border) last:border-0 ${
                          lastScanned && !lastScanned.error && lastScanned.product_id === item.product_id
                            ? "bg-(--ui-success-bg)"
                            : ""
                        }`}
                      >
                        <td className="py-2 pr-4">
                          <div className="font-medium">{item.product_name}</div>
                          <div className="text-xs text-(--ui-text-muted)">
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
                                className="w-16 text-center border border-(--ui-border-strong) rounded px-1 py-0.5 text-sm"
                                autoFocus
                              />
                              <button
                                onClick={() => handleManualQty(item.id)}
                                className="text-(--ui-link) text-xs font-medium"
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
                          {isCounted(item) ? (
                            <span
                              className={`font-mono font-medium ${
                                variance > 0
                                  ? "text-(--ui-success-fg)"
                                  : variance < 0
                                  ? "text-(--ui-danger-fg)"
                                  : "text-(--ui-text-muted)"
                              }`}
                            >
                              {variance > 0 ? "+" : ""}
                              {variance}
                            </span>
                          ) : (
                            <span className="text-(--ui-text-muted)">—</span>
                          )}
                        </td>
                        <td className="py-2 text-xs text-(--ui-text-muted)">
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
      <Modal
        open={showComplete}
        onClose={completing ? undefined : () => setShowComplete(false)}
        title="Complete Stock Count"
        size="md"
      >
        <p className="text-sm text-(--ui-text-muted) mb-4">
          {countedCount} of {items.length} products have been counted.
          {items.length - countedCount > 0 && (
            <span className="text-(--ui-warning-fg) font-medium">
              {" "}{items.length - countedCount} products were not counted
              {autoAdjust && fullCount ? " and will be set to 0." : " and will be left unchanged."}
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
        <label className={`flex items-start gap-2 mb-4 ml-6 ${autoAdjust ? "cursor-pointer" : "opacity-50"}`}>
          <input
            type="checkbox"
            checked={autoAdjust && fullCount}
            disabled={!autoAdjust}
            onChange={(e) => setFullCount(e.target.checked)}
            className="rounded mt-0.5"
          />
          <span className="text-sm">
            Full count: set everything not counted to 0
            <span className="block text-xs text-(--ui-text-muted)">
              Only tick this if you counted the whole shop. Leave it off for a shelf-by-shelf count.
            </span>
          </span>
        </label>
        <ModalFooter>
          <Button onClick={() => setShowComplete(false)} disabled={completing}>
            Cancel
          </Button>
          <Button tone="primary" onClick={handleComplete} disabled={completing}>
            {completing ? "Completing..." : "Finalize Count"}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function StockCountRedesign() {
  const { hasPerm } = useAuth();
  const toast = useToast();
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
      toast.error(err.message || "Failed to load stock counts");
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
      <NewCountDialog
        open={view === "new"}
        outlets={outlets}
        onConfirm={handleCreateCount}
        onCancel={() => setView("list")}
        saving={saving}
      />
    </>
  );
}
