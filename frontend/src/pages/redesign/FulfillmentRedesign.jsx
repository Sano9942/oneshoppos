import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ClipboardList,
  Package,
  PackageCheck,
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
];

// ── Main component ──────────────────────────────────────────────────

export default function FulfillmentRedesign() {
  const [tab, setTab] = useState("queue");
  const [activePicklist, setActivePicklist] = useState(null);
  const { fmt } = useCurrency();

  return (
    <PageShell
      title="Fulfillment"
      subtitle="Pick, pack, and dispatch e-commerce orders"
    >
      {activePicklist ? (
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
      const data = await api.get("/fulfillment/unfulfilled-orders");
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
      await api.post("/fulfillment/picklists", {
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
      const data = await api.get(`/fulfillment/picklists?${params}`);
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
      const data = await api.post("/fulfillment/scan-dispatch", { scan_value: val });

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
      const data = await api.get(`/fulfillment/picklists/${picklistId}`);
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
        ? `/fulfillment/picklists/${picklistId}/pick-scan`
        : `/fulfillment/picklists/${picklistId}/pack-scan`;

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
      await api.post(`/fulfillment/picklists/${picklistId}/complete-picking`);
      success("Picking complete");
      load();
    } catch (err) {
      error(err.message);
    }
  };

  const completePacking = async () => {
    try {
      await api.post(`/fulfillment/picklists/${picklistId}/complete-packing`);
      success("Packing complete");
      load();
    } catch (err) {
      error(err.message);
    }
  };

  const dispatch = async () => {
    try {
      await api.post(`/fulfillment/picklists/${picklistId}/dispatch`);
      success("Dispatched — orders marked as fulfilled");
      load();
    } catch (err) {
      error(err.message);
    }
  };

  const cancel = async () => {
    try {
      await api.del(`/fulfillment/picklists/${picklistId}`);
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
