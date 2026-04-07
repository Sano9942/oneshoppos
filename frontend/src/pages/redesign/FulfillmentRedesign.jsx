import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Package,
  PackageCheck,
  Printer,
  RefreshCw,
  ScanBarcode,
  Search,
  ShoppingCart,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import { api } from "../../api";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";

// ── Status config ───────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending:     { label: "Pending",     tone: "default" },
  picking:     { label: "Picking",     tone: "info"    },
  picked:      { label: "Picked",      tone: "info"    },
  packing:     { label: "Packing",     tone: "warning" },
  packed:      { label: "Packed",      tone: "success" },
  dispatched:  { label: "Dispatched",  tone: "default" },
  cancelled:   { label: "Cancelled",   tone: "danger"  },
};

const LS_STATUS_CONFIG = {
  draft:        { label: "Draft",        tone: "default" },
  finalized:    { label: "Finalized",    tone: "info"    },
  handed_over:  { label: "Handed Over",  tone: "success" },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

// ── Progress bar ────────────────────────────────────────────────────

function ProgressBar({ current, total, color = "bg-blue-500" }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 grow rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 tabular-nums">{pct}%</span>
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────

const TABS = [
  { key: "queue", label: "Orders Queue", icon: ShoppingCart },
  { key: "picklists", label: "Picklists", icon: ClipboardList },
  { key: "dispatch", label: "Quick Dispatch", icon: Zap },
  { key: "loadsheets", label: "Loadsheets", icon: FileSpreadsheet },
];

// ── Main component ──────────────────────────────────────────────────

export default function FulfillmentRedesign() {
  const [tab, setTab] = useState("queue");
  const [activePicklist, setActivePicklist] = useState(null);
  const [activeLoadsheet, setActiveLoadsheet] = useState(null);
  const { fmt } = useCurrency();

  return (
    <PageShell
      title="Fulfillment"
      subtitle="Pick, pack, and dispatch e-commerce orders"
    >
      {activeLoadsheet ? (
        <LoadsheetDetail
          loadsheetId={activeLoadsheet}
          onBack={() => setActiveLoadsheet(null)}
          fmt={fmt}
        />
      ) : activePicklist ? (
        <PicklistDetail
          picklistId={activePicklist}
          onBack={() => setActivePicklist(null)}
          fmt={fmt}
        />
      ) : (
        <>
          {/* Tab bar */}
          <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-white shadow-sm dark:bg-gray-700 dark:text-white"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>

          {tab === "queue" && (
            <OrdersQueue onPicklistCreated={() => setTab("picklists")} fmt={fmt} />
          )}
          {tab === "picklists" && (
            <PicklistsTab onOpen={setActivePicklist} fmt={fmt} />
          )}
          {tab === "dispatch" && <QuickDispatchTab />}
          {tab === "loadsheets" && (
            <LoadsheetsTab onOpen={setActiveLoadsheet} fmt={fmt} />
          )}
        </>
      )}
    </PageShell>
  );
}

// ── Orders Queue tab ────────────────────────────────────────────────

function OrdersQueue({ onPicklistCreated, fmt }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const { success, error } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/fulfillment/unfulfilled-orders");
      setOrders(data.orders || []);
    } catch (err) {
      error(err.message);
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => { load(); }, [load]);

  const toggleAll = () => {
    if (selected.size === orders.length) setSelected(new Set());
    else setSelected(new Set(orders.map((o) => o.id)));
  };

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const createPicklist = async () => {
    if (!selected.size) return;
    setCreating(true);
    try {
      // Use outlet from first selected order (or 1 as fallback)
      const firstOrder = orders.find((o) => selected.has(o.id));
      await api.post("/api/fulfillment/picklists", {
        order_ids: [...selected],
        outlet_id: firstOrder?.outlet_id || 1,
      });
      success("Picklist created");
      setSelected(new Set());
      onPicklistCreated();
    } catch (err) {
      error(err.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <SectionCard><p className="py-8 text-center text-gray-400">Loading orders…</p></SectionCard>;
  }

  if (!orders.length) {
    return <EmptyState title="No unfulfilled orders" body="All orders have been fulfilled or none exist yet." />;
  }

  return (
    <SectionCard>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-gray-500">{orders.length} unfulfilled order(s)</p>
        <Button
          onClick={createPicklist}
          disabled={!selected.size || creating}
        >
          <ClipboardList className="mr-1.5 h-4 w-4" />
          Create Picklist ({selected.size})
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-gray-500 dark:border-gray-700">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.size === orders.length && orders.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-3 py-2">Order #</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Ordered</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {orders.map((o) => (
              <tr
                key={o.id}
                className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                  selected.has(o.id) ? "bg-blue-50 dark:bg-blue-900/20" : ""
                }`}
                onClick={() => toggle(o.id)}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="px-3 py-2 font-medium">{o.external_order_number || `#${o.id}`}</td>
                <td className="px-3 py-2">{o.customer_name || "—"}</td>
                <td className="px-3 py-2">{o.item_count}</td>
                <td className="px-3 py-2">{fmt(o.grand_total)}</td>
                <td className="px-3 py-2"><Badge tone={o.payment_status === "paid" ? "success" : "warning"}>{o.payment_status}</Badge></td>
                <td className="px-3 py-2 text-gray-500">{o.ordered_at ? fmtUtcDateTime(o.ordered_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ── Picklists tab ───────────────────────────────────────────────────

function PicklistsTab({ onOpen }) {
  const [picklists, setPicklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const { error } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const data = await api.get(`/api/fulfillment/picklists?${params}`);
      setPicklists(data.picklists || []);
    } catch (err) {
      error(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, error]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <SectionCard><p className="py-8 text-center text-gray-400">Loading picklists…</p></SectionCard>;
  }

  return (
    <SectionCard>
      <div className="mb-3 flex items-center justify-between">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
        <Button variant="ghost" onClick={load}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {!picklists.length ? (
        <EmptyState title="No picklists" body="Create a picklist from the Orders Queue tab." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500 dark:border-gray-700">
              <tr>
                <th className="px-3 py-2">Picklist #</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Orders</th>
                <th className="px-3 py-2">Items</th>
                <th className="px-3 py-2">Pick Progress</th>
                <th className="px-3 py-2">Outlet</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {picklists.map((pl) => (
                <tr
                  key={pl.id}
                  className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => onOpen(pl.id)}
                >
                  <td className="px-3 py-2 font-medium">{pl.picklist_number}</td>
                  <td className="px-3 py-2"><StatusBadge status={pl.status} /></td>
                  <td className="px-3 py-2">{pl.order_count}</td>
                  <td className="px-3 py-2">{pl.item_count}</td>
                  <td className="px-3 py-2 min-w-30">
                    <ProgressBar current={pl.items_picked} total={pl.item_count} />
                  </td>
                  <td className="px-3 py-2">{pl.outlet_name || "—"}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtUtcDateTime(pl.created_at)}</td>
                  <td className="px-3 py-2">
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onOpen(pl.id); }}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ── Quick Dispatch tab ──────────────────────────────────────────────

const BEEP_OK = typeof AudioContext !== "undefined" ? (() => {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine"; osc.frequency.value = 880; gain.gain.value = 0.15;
    osc.start(); osc.stop(ctx.currentTime + 0.12);
  } catch {}
}) : () => {};

const BEEP_ERR = typeof AudioContext !== "undefined" ? (() => {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "square"; osc.frequency.value = 300; gain.gain.value = 0.15;
    osc.start(); osc.stop(ctx.currentTime + 0.25);
  } catch {}
}) : () => {};

function QuickDispatchTab() {
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState(null); // "success" | "error" | "warning"
  const [lastResult, setLastResult] = useState(null);
  const [history, setHistory] = useState([]);
  const inputRef = useRef(null);
  const { error: toastError } = useToast();

  const sessionCount = history.filter((h) => h.type === "success").length;

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doFlash = (type) => {
    setFlash(type);
    setTimeout(() => setFlash(null), 800);
  };

  const handleScan = async (e) => {
    e.preventDefault();
    const val = inputRef.current?.value?.trim();
    if (!val || scanning) return;

    setScanning(true);
    try {
      const data = await api.post("/api/fulfillment/scan-dispatch", { scan_value: val });

      if (data.warning) {
        // Already dispatched
        doFlash("warning");
        BEEP_ERR();
        setLastResult({ type: "warning", message: data.warning, order: data.order });
        setHistory((h) => [{ type: "warning", order: data.order, time: new Date(), scan: val }, ...h].slice(0, 20));
      } else {
        // Success
        doFlash("success");
        BEEP_OK();
        setLastResult({ type: "success", order: data.order });
        setHistory((h) => [{ type: "success", order: data.order, time: new Date(), scan: val }, ...h].slice(0, 20));
      }
    } catch (err) {
      doFlash("error");
      BEEP_ERR();
      const msg = err.message || "Order not found";
      setLastResult({ type: "error", message: msg });
      setHistory((h) => [{ type: "error", message: msg, time: new Date(), scan: val }, ...h].slice(0, 20));
      if (err.status !== 404) toastError(msg);
    } finally {
      setScanning(false);
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.focus();
      }
    }
  };

  const flashColors = {
    success: "ring-2 ring-green-500 bg-green-50 dark:bg-green-900/20",
    error: "ring-2 ring-red-500 bg-red-50 dark:bg-red-900/20",
    warning: "ring-2 ring-yellow-500 bg-yellow-50 dark:bg-yellow-900/20",
  };

  return (
    <div>
      {/* Scan input */}
      <SectionCard className={`mb-4 transition-colors ${flash ? flashColors[flash] || "" : ""}`}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            <h3 className="text-sm font-semibold">Scan & Dispatch</h3>
          </div>
          <Badge tone="info">{sessionCount} dispatched this session</Badge>
        </div>

        <form onSubmit={handleScan} className="flex items-center gap-3">
          <ScanBarcode className="h-5 w-5 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Scan tracking number, order number, or order ID…"
            className="grow rounded-md border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
            autoFocus
          />
          <Button type="submit" disabled={scanning}>
            <Truck className="mr-1.5 h-4 w-4" />
            Dispatch
          </Button>
        </form>
      </SectionCard>

      {/* Last result card */}
      {lastResult && (
        <SectionCard className={`mb-4 ${
          lastResult.type === "success" ? "border-l-4 border-l-green-500"
          : lastResult.type === "warning" ? "border-l-4 border-l-yellow-500"
          : "border-l-4 border-l-red-500"
        }`}>
          <div className="flex items-center gap-3">
            {lastResult.type === "success" && <CheckCircle className="h-6 w-6 text-green-500 shrink-0" />}
            {lastResult.type === "warning" && <AlertTriangle className="h-6 w-6 text-yellow-500 shrink-0" />}
            {lastResult.type === "error" && <X className="h-6 w-6 text-red-500 shrink-0" />}
            <div>
              {lastResult.order ? (
                <>
                  <p className="font-semibold">
                    {lastResult.order.order_number}
                    {lastResult.order.customer_name && (
                      <span className="ml-2 font-normal text-gray-500">— {lastResult.order.customer_name}</span>
                    )}
                  </p>
                  <p className={`text-sm ${
                    lastResult.type === "success" ? "text-green-600 dark:text-green-400"
                    : "text-yellow-600 dark:text-yellow-400"
                  }`}>
                    {lastResult.type === "success" ? "Dispatched successfully" : lastResult.message}
                  </p>
                </>
              ) : (
                <p className="text-sm font-medium text-red-600 dark:text-red-400">{lastResult.message}</p>
              )}
            </div>
          </div>
        </SectionCard>
      )}

      {/* History */}
      {history.length > 0 && (
        <SectionCard>
          <h3 className="mb-2 text-sm font-semibold">Recent Scans</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-gray-500 dark:border-gray-700">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Scanned Value</th>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {history.map((h, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      {h.type === "success" && <Badge tone="success">Dispatched</Badge>}
                      {h.type === "warning" && <Badge tone="warning">Already Done</Badge>}
                      {h.type === "error" && <Badge tone="danger">Not Found</Badge>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{h.scan}</td>
                    <td className="px-3 py-2">{h.order?.order_number || "—"}</td>
                    <td className="px-3 py-2">{h.order?.customer_name || "—"}</td>
                    <td className="px-3 py-2 text-gray-500">{h.time.toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ── Picklist detail view ────────────────────────────────────────────

function PicklistDetail({ picklistId, onBack, fmt }) {
  const [pl, setPl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState(null); // "success" | "error"
  const barcodeRef = useRef(null);
  const { success, error, warning } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/fulfillment/picklists/${picklistId}`);
      setPl(data.picklist);
    } catch (err) {
      error(err.message);
    } finally {
      setLoading(false);
    }
  }, [picklistId, error]);

  useEffect(() => { load(); }, [load]);

  // Auto-focus barcode input
  useEffect(() => {
    if (barcodeRef.current && (pl?.status === "pending" || pl?.status === "picking" || pl?.status === "picked" || pl?.status === "packing")) {
      barcodeRef.current.focus();
    }
  }, [pl?.status]);

  const handleScan = async (e) => {
    e.preventDefault();
    const barcode = barcodeRef.current?.value?.trim();
    if (!barcode || scanning) return;

    setScanning(true);
    try {
      const isPicking = ["pending", "picking"].includes(pl.status);
      const isPacking = ["picked", "packing"].includes(pl.status);

      if (!isPicking && !isPacking) {
        warning("Picklist is not in a scannable state");
        return;
      }

      const endpoint = isPicking
        ? `/api/fulfillment/picklists/${picklistId}/pick-scan`
        : `/api/fulfillment/picklists/${picklistId}/pack-scan`;

      await api.post(endpoint, { barcode });

      // Flash green
      setFlash("success");
      setTimeout(() => setFlash(null), 600);

      // Reload to get updated counts
      await load();
    } catch (err) {
      setFlash("error");
      setTimeout(() => setFlash(null), 600);
      error(err.message);
    } finally {
      setScanning(false);
      if (barcodeRef.current) {
        barcodeRef.current.value = "";
        barcodeRef.current.focus();
      }
    }
  };

  const completePicking = async () => {
    try {
      await api.post(`/api/fulfillment/picklists/${picklistId}/complete-picking`);
      success("Picking complete");
      load();
    } catch (err) {
      error(err.message);
    }
  };

  const completePacking = async () => {
    try {
      await api.post(`/api/fulfillment/picklists/${picklistId}/complete-packing`);
      success("Packing complete");
      load();
    } catch (err) {
      error(err.message);
    }
  };

  const dispatch = async () => {
    try {
      await api.post(`/api/fulfillment/picklists/${picklistId}/dispatch`);
      success("Dispatched — orders marked as fulfilled");
      load();
    } catch (err) {
      error(err.message);
    }
  };

  const cancel = async () => {
    try {
      await api.del(`/api/fulfillment/picklists/${picklistId}`);
      success("Picklist cancelled");
      onBack();
    } catch (err) {
      error(err.message);
    }
  };

  if (loading || !pl) {
    return <SectionCard><p className="py-8 text-center text-gray-400">Loading…</p></SectionCard>;
  }

  const items = pl.items || [];
  const totalQty = items.reduce((s, i) => s + i.qty_to_pick, 0);
  const pickedQty = items.reduce((s, i) => s + i.qty_picked, 0);
  const packedQty = items.reduce((s, i) => s + i.qty_packed, 0);

  const isPicking = ["pending", "picking"].includes(pl.status);
  const isPacking = ["picked", "packing"].includes(pl.status);
  const scannable = isPicking || isPacking;

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onBack} className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="grow">
          <h2 className="text-lg font-semibold">{pl.picklist_number}</h2>
          <p className="text-sm text-gray-500">
            {pl.outlet_name} • Created by {pl.created_by_name || "—"} • {fmtUtcDateTime(pl.created_at)}
          </p>
        </div>
        <StatusBadge status={pl.status} />
      </div>

      {/* Status pipeline */}
      <SectionCard className="mb-4">
        <div className="flex items-center justify-between">
          {["pending", "picking", "picked", "packing", "packed", "dispatched"].map((s, idx, arr) => {
            const stepIdx = arr.indexOf(pl.status);
            const thisIdx = idx;
            const done = thisIdx < stepIdx || pl.status === "dispatched";
            const active = thisIdx === stepIdx;

            return (
              <div key={s} className="flex items-center gap-2">
                {idx > 0 && (
                  <div className={`h-0.5 w-8 ${done || active ? "bg-blue-500" : "bg-gray-200 dark:bg-gray-700"}`} />
                )}
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                  done ? "bg-green-500 text-white"
                  : active ? "bg-blue-500 text-white"
                  : "bg-gray-200 text-gray-500 dark:bg-gray-700"
                }`}>
                  {done ? <CheckCircle className="h-4 w-4" /> : idx + 1}
                </div>
                <span className={`hidden text-xs sm:block ${active ? "font-semibold text-blue-600 dark:text-blue-400" : "text-gray-400"}`}>
                  {STATUS_CONFIG[s].label}
                </span>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Scan bar */}
      {scannable && (
        <SectionCard className={`mb-4 transition-colors ${
          flash === "success" ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-900/20"
          : flash === "error" ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-900/20"
          : ""
        }`}>
          <form onSubmit={handleScan} className="flex items-center gap-3">
            <ScanBarcode className="h-5 w-5 text-gray-400" />
            <input
              ref={barcodeRef}
              type="text"
              placeholder={isPicking ? "Scan barcode to pick…" : "Scan barcode to pack…"}
              className="grow rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
              autoFocus
            />
            <Button type="submit" disabled={scanning}>
              {isPicking ? "Pick" : "Pack"}
            </Button>
          </form>

          <div className="mt-3 flex gap-6">
            <div>
              <p className="text-xs text-gray-500">Picked</p>
              <ProgressBar current={pickedQty} total={totalQty} color="bg-blue-500" />
              <p className="text-xs text-gray-400">{pickedQty} / {totalQty}</p>
            </div>
            {(isPacking || pl.status === "packed" || pl.status === "dispatched") && (
              <div>
                <p className="text-xs text-gray-500">Packed</p>
                <ProgressBar current={packedQty} total={totalQty} color="bg-green-500" />
                <p className="text-xs text-gray-400">{packedQty} / {totalQty}</p>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Action buttons */}
      <div className="mb-4 flex gap-2">
        {isPicking && pickedQty >= totalQty && (
          <Button onClick={completePicking}>
            <PackageCheck className="mr-1.5 h-4 w-4" />
            Complete Picking
          </Button>
        )}
        {isPacking && packedQty >= totalQty && (
          <Button onClick={completePacking}>
            <Package className="mr-1.5 h-4 w-4" />
            Complete Packing
          </Button>
        )}
        {pl.status === "packed" && (
          <Button onClick={dispatch}>
            <Truck className="mr-1.5 h-4 w-4" />
            Dispatch
          </Button>
        )}
        {pl.status === "pending" && (
          <Button variant="ghost" onClick={cancel}>
            <X className="mr-1.5 h-4 w-4" />
            Cancel
          </Button>
        )}
      </div>

      {/* Items table */}
      <SectionCard>
        <h3 className="mb-2 text-sm font-semibold">Items ({items.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500 dark:border-gray-700">
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Variant</th>
                <th className="px-3 py-2">Order #</th>
                <th className="px-3 py-2">Barcode</th>
                <th className="px-3 py-2 text-center">To Pick</th>
                <th className="px-3 py-2 text-center">Picked</th>
                <th className="px-3 py-2 text-center">Packed</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {items.map((it) => {
                const itemDone = it.qty_picked >= it.qty_to_pick;
                const itemPacked = it.qty_packed >= it.qty_to_pick;
                return (
                  <tr key={it.id} className={itemDone ? "bg-green-50/50 dark:bg-green-900/10" : ""}>
                    <td className="px-3 py-2 font-medium">{it.product_name || "—"}</td>
                    <td className="px-3 py-2">{it.variant_name || "—"}</td>
                    <td className="px-3 py-2">{it.external_order_number || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.barcode || it.product_barcode || it.variant_barcode || "—"}</td>
                    <td className="px-3 py-2 text-center">{it.qty_to_pick}</td>
                    <td className={`px-3 py-2 text-center font-medium ${itemDone ? "text-green-600" : ""}`}>{it.qty_picked}</td>
                    <td className={`px-3 py-2 text-center font-medium ${itemPacked ? "text-green-600" : ""}`}>{it.qty_packed}</td>
                    <td className="px-3 py-2">
                      {itemPacked ? (
                        <Badge tone="success">Packed</Badge>
                      ) : itemDone ? (
                        <Badge tone="info">Picked</Badge>
                      ) : it.qty_picked > 0 ? (
                        <Badge tone="warning">Partial</Badge>
                      ) : (
                        <Badge tone="default">Pending</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Print helper (DOM-safe) ────────────────────────────────────────

function openPrintableLoadsheet(ls, orders, fmt) {
  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) return;

  const doc = w.document;
  doc.open();
  doc.close();
  doc.title = ls.loadsheet_number;

  const style = doc.createElement("style");
  style.textContent = "body{font-family:Arial,sans-serif;margin:20px}table{border-collapse:collapse;width:100%}th{background:#f5f5f5;text-align:left}th,td{padding:4px 8px;border:1px solid #ddd}@media print{button{display:none}}";
  doc.head.appendChild(style);

  const h2 = doc.createElement("h2");
  h2.textContent = ls.loadsheet_number;
  doc.body.appendChild(h2);

  const info = doc.createElement("p");
  info.textContent = `Courier: ${ls.courier_name || "\u2014"} \u2022 Outlet: ${ls.outlet_name || "\u2014"} \u2022 Created: ${ls.created_at ? new Date(ls.created_at).toLocaleDateString() : "\u2014"}`;
  doc.body.appendChild(info);

  const table = doc.createElement("table");
  const thead = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  ["Order #", "Customer", "Address", "Phone", "COD", "Tracking #"].forEach((t) => {
    const th = doc.createElement("th");
    th.textContent = t;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement("tbody");
  orders.forEach((o) => {
    const tr = doc.createElement("tr");
    [
      o.external_order_number || `#${o.web_order_id}`,
      o.customer_name || "\u2014",
      o.customer_address || "\u2014",
      o.customer_phone || "\u2014",
      o.is_cod ? fmt(o.cod_amount) : "\u2014",
      o.tracking_number || "\u2014",
    ].forEach((val) => {
      const td = doc.createElement("td");
      td.textContent = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  doc.body.appendChild(table);

  const summary = doc.createElement("p");
  summary.style.marginTop = "16px";
  const b1 = doc.createElement("strong");
  b1.textContent = "Total Orders: ";
  summary.appendChild(b1);
  summary.appendChild(doc.createTextNode(`${orders.length}  \u2022  `));
  const b2 = doc.createElement("strong");
  b2.textContent = "Total COD: ";
  summary.appendChild(b2);
  summary.appendChild(doc.createTextNode(fmt(ls.total_cod)));
  doc.body.appendChild(summary);

  if (ls.handed_over_to) {
    const ho = doc.createElement("p");
    const b3 = doc.createElement("strong");
    b3.textContent = "Handed over to: ";
    ho.appendChild(b3);
    ho.appendChild(doc.createTextNode(ls.handed_over_to));
    doc.body.appendChild(ho);
  }

  const btn = doc.createElement("button");
  btn.textContent = "Print";
  btn.addEventListener("click", () => w.print());
  doc.body.appendChild(doc.createElement("br"));
  doc.body.appendChild(btn);
}

// ── Loadsheets tab ─────────────────────────────────────────────────

function LoadsheetsTab({ onOpen, fmt }) {
  const [loadsheets, setLoadsheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const { error } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const data = await api.get(`/api/fulfillment/loadsheets?${params}`);
      setLoadsheets(data.loadsheets || []);
    } catch (err) {
      error(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, error]);

  useEffect(() => { load(); }, [load]);

  if (showCreate) {
    return (
      <CreateLoadsheet
        onBack={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); load(); }}
        fmt={fmt}
      />
    );
  }

  if (loading) {
    return <SectionCard><p className="py-8 text-center text-gray-400">Loading loadsheets…</p></SectionCard>;
  }

  return (
    <SectionCard>
      <div className="mb-3 flex items-center justify-between">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="">All statuses</option>
          {Object.entries(LS_STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={load}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            New Loadsheet
          </Button>
        </div>
      </div>

      {!loadsheets.length ? (
        <EmptyState title="No loadsheets" body="Create a loadsheet from dispatched orders." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500 dark:border-gray-700">
              <tr>
                <th className="px-3 py-2">Loadsheet #</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Courier</th>
                <th className="px-3 py-2">Orders</th>
                <th className="px-3 py-2">COD Total</th>
                <th className="px-3 py-2">Outlet</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {loadsheets.map((ls) => {
                const cfg = LS_STATUS_CONFIG[ls.status] || LS_STATUS_CONFIG.draft;
                return (
                  <tr
                    key={ls.id}
                    className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                    onClick={() => onOpen(ls.id)}
                  >
                    <td className="px-3 py-2 font-medium">{ls.loadsheet_number}</td>
                    <td className="px-3 py-2"><Badge tone={cfg.tone}>{cfg.label}</Badge></td>
                    <td className="px-3 py-2">{ls.courier_name || "—"}</td>
                    <td className="px-3 py-2">{ls.order_count}</td>
                    <td className="px-3 py-2">{fmt(ls.total_cod)}</td>
                    <td className="px-3 py-2">{ls.outlet_name || "—"}</td>
                    <td className="px-3 py-2 text-gray-500">{fmtUtcDateTime(ls.created_at)}</td>
                    <td className="px-3 py-2">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onOpen(ls.id); }}>
                        Open
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ── Create loadsheet ───────────────────────────────────────────────

function CreateLoadsheet({ onBack, onCreated, fmt }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const { success, error } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/fulfillment/dispatched-orders");
      setOrders(data.orders || []);
    } catch (err) {
      error(err.message);
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const create = async () => {
    if (!selected.size) return;
    setCreating(true);
    try {
      const selectedOrders = orders.filter((o) => selected.has(o.id));
      const courierId = selectedOrders[0]?.courier_id || null;
      await api.post("/api/fulfillment/loadsheets", {
        order_ids: [...selected],
        courier_id: courierId,
        outlet_id: 1,
      });
      success("Loadsheet created");
      onCreated();
    } catch (err) {
      error(err.message);
    } finally {
      setCreating(false);
    }
  };

  // Group orders by courier for display
  const courierGroups = orders.reduce((acc, o) => {
    const key = o.courier_name || "No Courier";
    if (!acc[key]) acc[key] = [];
    acc[key].push(o);
    return acc;
  }, {});

  if (loading) {
    return <SectionCard><p className="py-8 text-center text-gray-400">Loading dispatched orders…</p></SectionCard>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onBack} className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="grow">
          <h2 className="text-lg font-semibold">New Loadsheet</h2>
          <p className="text-sm text-gray-500">Select dispatched orders to group into a loadsheet</p>
        </div>
        <Button onClick={create} disabled={!selected.size || creating}>
          <FileSpreadsheet className="mr-1.5 h-4 w-4" />
          Create Loadsheet ({selected.size})
        </Button>
      </div>

      {!orders.length ? (
        <EmptyState title="No dispatched orders" body="Orders must be dispatched before they can be added to a loadsheet." />
      ) : (
        Object.entries(courierGroups).map(([courier, groupOrders]) => (
          <SectionCard key={courier} className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <Truck className="h-4 w-4 text-gray-400" />
              <h3 className="text-sm font-semibold">{courier}</h3>
              <span className="text-xs text-gray-400">({groupOrders.length} orders)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-xs uppercase text-gray-500 dark:border-gray-700">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={groupOrders.every((o) => selected.has(o.id))}
                        onChange={() => {
                          const next = new Set(selected);
                          const allChecked = groupOrders.every((o) => next.has(o.id));
                          groupOrders.forEach((o) => allChecked ? next.delete(o.id) : next.add(o.id));
                          setSelected(next);
                        }}
                      />
                    </th>
                    <th className="px-3 py-2">Order #</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="px-3 py-2">Payment</th>
                    <th className="px-3 py-2">Tracking</th>
                    <th className="px-3 py-2">Shipped</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {groupOrders.map((o) => (
                    <tr
                      key={o.id}
                      className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                        selected.has(o.id) ? "bg-blue-50 dark:bg-blue-900/20" : ""
                      }`}
                      onClick={() => toggle(o.id)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(o.id)}
                          onChange={() => toggle(o.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{o.external_order_number || `#${o.id}`}</td>
                      <td className="px-3 py-2">{o.customer_name || "—"}</td>
                      <td className="px-3 py-2">{o.customer_phone || "—"}</td>
                      <td className="px-3 py-2">{fmt(o.grand_total)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={o.payment_status === "paid" ? "success" : "warning"}>
                          {o.payment_status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{o.tracking_number || "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{o.shipped_at ? fmtUtcDateTime(o.shipped_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        ))
      )}
    </div>
  );
}

// ── Loadsheet detail view ──────────────────────────────────────────

function LoadsheetDetail({ loadsheetId, onBack, fmt }) {
  const [ls, setLs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [handoverName, setHandoverName] = useState("");
  const [showHandover, setShowHandover] = useState(false);
  const { success, error } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/fulfillment/loadsheets/${loadsheetId}`);
      setLs(data.loadsheet);
    } catch (err) {
      error(err.message);
    } finally {
      setLoading(false);
    }
  }, [loadsheetId, error]);

  useEffect(() => { load(); }, [load]);

  const finalize = async () => {
    try {
      await api.put(`/api/fulfillment/loadsheets/${loadsheetId}/finalize`);
      success("Loadsheet finalized");
      load();
    } catch (err) {
      error(err.message);
    }
  };

  const handover = async () => {
    if (!handoverName.trim()) return;
    try {
      await api.put(`/api/fulfillment/loadsheets/${loadsheetId}/handover`, {
        handed_over_to: handoverName.trim(),
      });
      success("Loadsheet marked as handed over");
      setShowHandover(false);
      setHandoverName("");
      load();
    } catch (err) {
      error(err.message);
    }
  };

  const exportCsv = async () => {
    try {
      const res = await api.raw(`/api/fulfillment/loadsheets/${loadsheetId}/export`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ls?.loadsheet_number || "loadsheet"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      error(err.message);
    }
  };

  const printLoadsheet = () => {
    openPrintableLoadsheet(ls, ls.orders || [], fmt);
  };

  if (loading || !ls) {
    return <SectionCard><p className="py-8 text-center text-gray-400">Loading…</p></SectionCard>;
  }

  const orders = ls.orders || [];
  const cfg = LS_STATUS_CONFIG[ls.status] || LS_STATUS_CONFIG.draft;
  const codOrders = orders.filter((o) => o.is_cod);
  const totalCod = codOrders.reduce((s, o) => s + Number(o.cod_amount), 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onBack} className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="grow">
          <h2 className="text-lg font-semibold">{ls.loadsheet_number}</h2>
          <p className="text-sm text-gray-500">
            {ls.courier_name || "No courier"} • {ls.outlet_name} • Created by {ls.created_by_name || "—"} • {fmtUtcDateTime(ls.created_at)}
          </p>
        </div>
        <Badge tone={cfg.tone}>{cfg.label}</Badge>
      </div>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SectionCard>
          <p className="text-xs text-gray-500">Total Orders</p>
          <p className="text-2xl font-bold">{orders.length}</p>
        </SectionCard>
        <SectionCard>
          <p className="text-xs text-gray-500">COD Orders</p>
          <p className="text-2xl font-bold">{codOrders.length}</p>
        </SectionCard>
        <SectionCard>
          <p className="text-xs text-gray-500">Total COD Amount</p>
          <p className="text-2xl font-bold">{fmt(totalCod)}</p>
        </SectionCard>
        <SectionCard>
          <p className="text-xs text-gray-500">Handed Over To</p>
          <p className="text-2xl font-bold">{ls.handed_over_to || "—"}</p>
        </SectionCard>
      </div>

      {/* Action buttons */}
      <div className="mb-4 flex flex-wrap gap-2">
        {ls.status === "draft" && (
          <Button onClick={finalize}>
            <CheckCircle className="mr-1.5 h-4 w-4" />
            Finalize
          </Button>
        )}
        {ls.status === "finalized" && !showHandover && (
          <Button onClick={() => setShowHandover(true)}>
            <Truck className="mr-1.5 h-4 w-4" />
            Mark Handed Over
          </Button>
        )}
        <Button variant="ghost" onClick={exportCsv}>
          <Download className="mr-1.5 h-4 w-4" />
          Export CSV
        </Button>
        <Button variant="ghost" onClick={printLoadsheet}>
          <Printer className="mr-1.5 h-4 w-4" />
          Print
        </Button>
      </div>

      {/* Handover input */}
      {showHandover && (
        <SectionCard className="mb-4">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Driver / recipient name"
              value={handoverName}
              onChange={(e) => setHandoverName(e.target.value)}
              className="grow"
            />
            <Button onClick={handover} disabled={!handoverName.trim()}>Confirm Handover</Button>
            <Button variant="ghost" onClick={() => setShowHandover(false)}>Cancel</Button>
          </div>
        </SectionCard>
      )}

      {/* Orders table */}
      <SectionCard>
        <h3 className="mb-2 text-sm font-semibold">Orders ({orders.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500 dark:border-gray-700">
              <tr>
                <th className="px-3 py-2">Order #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">COD</th>
                <th className="px-3 py-2">Tracking #</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2 font-medium">{o.external_order_number || `#${o.web_order_id}`}</td>
                  <td className="px-3 py-2">{o.customer_name || "—"}</td>
                  <td className="max-w-48 truncate px-3 py-2 text-gray-500">{o.customer_address || "—"}</td>
                  <td className="px-3 py-2">{o.customer_phone || "—"}</td>
                  <td className="px-3 py-2">{fmt(o.grand_total)}</td>
                  <td className="px-3 py-2">
                    {o.is_cod ? (
                      <Badge tone="warning">{fmt(o.cod_amount)}</Badge>
                    ) : (
                      <span className="text-gray-400">Prepaid</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{o.tracking_number || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
