import { useState, useEffect, useCallback, useMemo } from "react";
import { Users, Package, Truck, ShoppingBag, Wine, X, Save, Trash2 } from "lucide-react";
import { api } from "../../../../api";
import { usePOS } from "../POSContext";
import ReservationBadge from "./ReservationBadge";

// Phase 2-R.0 Day 2 — Floor grid for /pos/restaurant.
// Ports the plan loader, 10s polling, and seat modal from
// RestaurantFloorRedesign. Restyled for the POS shell (Square design tokens).
//
// Adds the takeaway/delivery/drive-thru sticky entry row. All four entry
// points (3 takeout buttons + tapping a seated table) flow into the same
// openCheck() context method on POSContext, then notify the parent shell
// to transition view -> "check".

const STATUS_TONE = {
  seated:          "bg-(--ui-warning-bg) text-(--ui-warning-fg) border-(--ui-warning-fg)/30",
  ordering:        "bg-(--ui-warning-bg) text-(--ui-warning-fg) border-(--ui-warning-fg)/30",
  served:          "bg-(--ui-success-bg) text-(--ui-success-fg) border-(--ui-success-fg)/30",
  check_requested: "bg-(--ui-danger-bg) text-(--ui-danger-fg) border-(--ui-danger-fg)/30",
  dirty:           "bg-(--ui-warning-bg) text-(--ui-warning-fg) border-(--ui-warning-fg)/30",
  closed:          "bg-(--ui-muted-surface) text-(--ui-text-muted) border-(--ui-border-strong)",
};

export default function RestaurantFloorGrid({ onOpenCheck }) {
  const { openCheck, cart, setCart, parkSale, tableSessionId, tableLabel, orderContext, posFlags, selectedOutletId } = usePOS();

  const [plans, setPlans] = useState([]);
  const [activePlan, setActivePlan] = useState(null);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seatModalTableId, setSeatModalTableId] = useState(null);
  const [seatForm, setSeatForm] = useState({ guest_count: 2 });
  const [seatBusy, setSeatBusy] = useState(false);
  // W18 — Open Tab modal state
  const [tabModalOpen, setTabModalOpen] = useState(false);
  const [tabName, setTabName] = useState("");
  const [tabBusy, setTabBusy] = useState(false);
  // Cart-collision prompt: when the cart has items from a prior check
  // and the user opens a different table / takeout context, ask before
  // wiping the cart. `pendingOpen` is the deferred openCheck() args.
  const [pendingOpen, setPendingOpen] = useState(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/restaurant/floor-plans");
      const list = data.floor_plans || [];
      setPlans(list);
      setActivePlan((prev) => prev || list[0]?.id || null);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFloorDetail = useCallback(async () => {
    if (!activePlan) return;
    try {
      const data = await api.get(`/api/restaurant/floor-plans/${activePlan}`);
      setTables(data.tables || []);
    } catch {
      setTables([]);
    }
  }, [activePlan]);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => { loadFloorDetail(); }, [loadFloorDetail]);
  useEffect(() => {
    if (!activePlan) return;
    const t = setInterval(loadFloorDetail, 10000);
    return () => clearInterval(t);
  }, [activePlan, loadFloorDetail]);

  // Phase 2-R.4 — reservations in the next 30 minutes, flag-gated.
  const [upcomingReservations, setUpcomingReservations] = useState([]);
  useEffect(() => {
    if (!posFlags?.phase4_restaurant_reservations) return;
    let cancelled = false;
    const load = async () => {
      try {
        const from = new Date().toISOString();
        const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const data = await api.get(
          `/api/restaurant/reservations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=confirmed`
        );
        if (!cancelled) setUpcomingReservations(data.reservations || []);
      } catch { if (!cancelled) setUpcomingReservations([]); }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [posFlags?.phase4_restaurant_reservations]);

  const reservationByTable = useMemo(() => {
    const map = new Map();
    const cutoff = Date.now() + 30 * 60 * 1000;
    for (const r of upcomingReservations) {
      if (!r.table_id) continue;
      if (new Date(r.reservation_start).getTime() > cutoff) continue;
      if (!map.has(r.table_id)) map.set(r.table_id, r);
    }
    return map;
  }, [upcomingReservations]);

  // Decide whether opening `next` would discard a cart that belongs to a
  // different in-progress check. Same destination (tapping the currently
  // open table) returns false — that's just resuming, not a collision.
  // A non-empty cart with no current context still collides — the user
  // backed out without saving and is now opening a fresh check.
  const wouldCollide = useCallback((next) => {
    if (!cart || cart.length === 0) return false;
    const sameTable = next.tableSessionId != null
      && next.tableSessionId === tableSessionId;
    const sameContext = next.context && next.context === orderContext;
    if (sameTable) return false;
    if (!next.tableSessionId && sameContext) return false;
    return true;
  }, [cart, orderContext, tableSessionId]);

  const performOpen = useCallback(async (next) => {
    openCheck(next);
    onOpenCheck?.();
    // W16: when re-entering a seated table, rehydrate the cart from the
    // existing open draft so the cashier sees what's already been sent to
    // the kitchen. Without this, the cart shows empty and items can be
    // accidentally re-added. Best-effort — failures are silent because
    // openCheck already cleared the cart and that's a usable empty state.
    if (next?.tableSessionId) {
      try {
        const list = await api.get("/api/draft-orders", {
          table_session_id: next.tableSessionId,
          status: "open,claimed",
        });
        const draft = list?.draftOrders?.[0];
        if (draft?.id) {
          const detail = await api.get(`/api/draft-orders/${draft.id}`);
          const items = detail?.items || [];
          if (items.length) {
            setCart(items.map((it) => ({
              id: it.product_id,
              variant_id: it.variant_id || null,
              name: it.product_name,
              price: Number(it.price),
              originalPrice: Number(it.price),
              quantity: Number(it.quantity),
              seat_number: it.seat_number ?? null,
              course_name: it.course_name || "main",
              // W16: kitchen_status preserved so a future Send-to-Kitchen sync
              // can skip items already 'sent' / 'fired' rather than re-firing
              // them (current PUT delete-and-rebuilds — items keep going). The
              // syncCartToDraft helper in RestaurantActionBar should filter
              // these; until that filter ships, adding a NEW item then
              // clicking Send-to-Kitchen will redundantly re-fire the
              // restored ones. Visually fine for the cashier to see what's
              // in the kitchen.
              kitchen_status: it.kitchen_status || "pending",
              availableStock: 99999,
            })));
          }
        }
      } catch {
        // silent — empty cart is the safe default
      }
    }
  }, [openCheck, onOpenCheck, setCart]);

  const requestOpen = useCallback((next) => {
    if (wouldCollide(next)) {
      setPendingOpen(next);
      return;
    }
    performOpen(next);
  }, [wouldCollide, performOpen]);

  const enterTakeoutContext = (context) => {
    requestOpen({ context });
  };

  // W18 — Open a bar tab. Posts to /api/restaurant/tabs to mint a tabId, then
  // transitions to the POS check view with order_context='bar' so subsequent
  // cart actions create a draft linked to this tab via tab_id (resolved by
  // ensureDraftOrder). Header renders "Tab: <customer_name>" via RestaurantHeader.
  const openBarTab = async () => {
    const trimmed = (tabName || "").trim();
    if (!trimmed) return;
    if (!selectedOutletId) {
      console.warn("Open Tab requires an active outlet");
      return;
    }
    setTabBusy(true);
    try {
      // selectedOutletId from useShiftGate is stored as a String — coerce to
      // number so the backend Zod schema (createTabSchema expects int) accepts it.
      const tab = await api.post("/api/restaurant/tabs", {
        outlet_id: Number(selectedOutletId),
        customer_name: trimmed,
      });
      setTabModalOpen(false);
      setTabName("");
      requestOpen({
        context: "bar",
        tabId: tab?.id ?? null,
        tabName: tab?.customer_name || trimmed,
      });
    } catch (e) {
      console.error("Failed to open tab:", e);
    } finally {
      setTabBusy(false);
    }
  };

  const openTableCheck = (table) => {
    requestOpen({
      context: "dine_in",
      tableSessionId: table.session_id,
      tableLabel: table.label || null,
      seatCount: Number(table.guest_count) || 1,
    });
  };

  // Save / Discard / Cancel handlers for the collision prompt.
  const handleSavePending = useCallback(async () => {
    const next = pendingOpen;
    setPendingOpen(null);
    if (!next) return;
    // parkSale clears the cart on success; if it fails (no shift, etc.)
    // we still proceed because the user explicitly opted to switch.
    try { await parkSale(); } catch { /* notice surfaced by POSContext */ }
    performOpen(next);
  }, [pendingOpen, parkSale, performOpen]);

  const handleDiscardPending = useCallback(() => {
    const next = pendingOpen;
    setPendingOpen(null);
    if (!next) return;
    setCart([]);
    performOpen(next);
  }, [pendingOpen, setCart, performOpen]);

  const handleCancelPending = useCallback(() => {
    setPendingOpen(null);
  }, []);

  const seatTable = async () => {
    if (!seatModalTableId) return;
    setSeatBusy(true);
    try {
      const data = await api.post("/api/restaurant/table-sessions", {
        table_id: seatModalTableId,
        guest_count: Number(seatForm.guest_count) || 1,
      });
      const seatedTable = tables.find((t) => t.id === seatModalTableId);
      setSeatModalTableId(null);
      // Skip the next poll round — go straight into the check.
      const sessionId = data?.session?.id ?? data?.id ?? null;
      requestOpen({
        context: "dine_in",
        tableSessionId: sessionId,
        tableLabel: seatedTable?.label || null,
        seatCount: Number(seatForm.guest_count) || 1,
      });
    } catch (e) {
      // best-effort; the parent shell shows the global notice/error banners.
      console.error("Failed to seat table:", e);
    } finally {
      setSeatBusy(false);
    }
  };

  // W17 — busser action: a 'dirty' table is post-settle, awaiting clean-up.
  // Clearing flips the session to 'closed' so the table card returns to the
  // empty "Tap to seat" state and a new party can be seated.
  const clearDirtyTable = async (sessionId) => {
    if (!sessionId) return;
    try {
      await api.put(`/api/restaurant/table-sessions/${sessionId}`, { status: "closed" });
      loadFloorDetail();
    } catch (e) {
      console.error("Failed to clear table:", e);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-(--ui-bg)">
      {/* Sticky takeout entry strip */}
      <div className="sticky top-0 z-30 bg-(--ui-surface) border-b border-(--ui-border-strong) px-6 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <EntryButton
            icon={ShoppingBag}
            label="New Takeaway"
            onClick={() => enterTakeoutContext("takeout")}
          />
          <EntryButton
            icon={Truck}
            label="New Delivery"
            onClick={() => enterTakeoutContext("delivery")}
          />
          <EntryButton
            icon={Package}
            label="New Drive-Thru"
            // 2-R.9: when phase4_restaurant_drive_thru is ON the button
            // writes drive_thru order_context (distinct from takeout in
            // reports/analytics). Flag OFF keeps legacy takeout mapping
            // so stale UI on tenants without the migration still works.
            onClick={() =>
              enterTakeoutContext(
                posFlags?.phase4_restaurant_drive_thru ? "drive_thru" : "takeout",
              )
            }
          />
          {/* W18: Open Tab — bar-tab pattern (named patron, persistent ledger,
              not seated). Backend support has shipped since v32; this is the
              first frontend entry point. */}
          <EntryButton
            icon={Wine}
            label="Open Tab"
            onClick={() => { setTabName(""); setTabModalOpen(true); }}
          />
        </div>
      </div>

      {/* Plan tabs */}
      {plans.length > 1 && (
        <div className="flex gap-2 px-6 pt-4">
          {plans.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePlan(p.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                activePlan === p.id
                  ? "bg-(--ui-primary) text-white"
                  : "bg-(--ui-surface) text-(--ui-text-muted) border border-(--ui-border-strong) hover:border-(--ui-border-strong)"
              }`}
            >
              {p.name}
              <span className="ml-2 text-xs opacity-70">{p.table_count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Tables */}
      <div className="flex-1 px-6 py-4">
        {loading && tables.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" aria-label="Loading floor plan">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="h-28 rounded-2xl border border-(--ui-border-strong) bg-(--ui-surface) animate-pulse"
              />
            ))}
          </div>
        ) : tables.length === 0 ? (
          <div className="text-center py-12 text-(--ui-text-muted) text-sm">
            No tables in this floor plan yet. Add tables in <span className="font-semibold">Settings → Restaurant Floor</span>.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {tables.map((t) => (
              <TableTile
                key={t.id}
                table={t}
                reservation={reservationByTable.get(t.id)}
                onSeat={() => { setSeatForm({ guest_count: Math.max(1, Math.min(t.capacity || 4, 2)) }); setSeatModalTableId(t.id); }}
                onOpen={() => openTableCheck(t)}
                onClear={() => clearDirtyTable(t.session_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cart-collision prompt (Phase 2-R.0 Day 10).
          Triggered when the user opens a different check while the
          current cart still has items. */}
      {pendingOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={handleCancelPending}
        >
          <div
            className="w-full max-w-sm bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-(--ui-text)">Save current check?</h3>
            <p className="mt-1 text-sm text-(--ui-text-muted)">
              {orderContext === "dine_in" && tableSessionId
                ? `Save the cart for Table ${tableLabel || tableSessionId} before switching?`
                : "Save the current cart as a draft before switching?"}
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <button
                onClick={handleSavePending}
                className="py-3 rounded-xl bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-bold text-sm flex flex-col items-center gap-1"
              >
                <Save size={16} />
                Save
              </button>
              <button
                onClick={handleDiscardPending}
                className="py-3 rounded-xl bg-(--ui-danger-bg) hover:bg-(--ui-danger-bg) text-(--ui-danger-fg) border border-(--ui-danger-fg)/30 font-bold text-sm flex flex-col items-center gap-1"
              >
                <Trash2 size={16} />
                Discard
              </button>
              <button
                onClick={handleCancelPending}
                className="py-3 rounded-xl bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) text-(--ui-text) font-bold text-sm flex flex-col items-center gap-1"
              >
                <X size={16} />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Seat modal */}
      {seatModalTableId != null && (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setSeatModalTableId(null)}
        >
          <div
            className="w-full max-w-sm bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-(--ui-text)">Seat Table</h3>
              <button
                onClick={() => setSeatModalTableId(null)}
                className="p-1 text-(--ui-text-muted) hover:text-(--ui-text)"
              >
                <X size={18} />
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2">
              Guests
            </label>
            <input
              type="number"
              min={1}
              value={seatForm.guest_count}
              onChange={(e) => setSeatForm({ guest_count: Number(e.target.value) || 1 })}
              className="w-full text-2xl font-bold text-center px-3 py-3 rounded-xl border border-(--ui-border-strong) focus:outline-none focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus)"
              autoFocus
            />
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setSeatModalTableId(null)}
                className="flex-1 py-3 rounded-xl border border-(--ui-border-strong) text-(--ui-text) font-semibold hover:bg-(--ui-muted-surface)"
              >
                Cancel
              </button>
              <button
                onClick={seatTable}
                disabled={seatBusy}
                className="flex-1 py-3 rounded-xl bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-bold disabled:opacity-50"
              >
                {seatBusy ? "Seating…" : "Seat"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* W18 — Open Tab modal */}
      {tabModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => !tabBusy && setTabModalOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-(--ui-text)">Open Tab</h3>
              <button
                onClick={() => !tabBusy && setTabModalOpen(false)}
                className="p-1 text-(--ui-text-muted) hover:text-(--ui-text)"
              >
                <X size={18} />
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2">
              Tab name
            </label>
            <input
              type="text"
              placeholder="e.g. John W"
              value={tabName}
              onChange={(e) => setTabName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && tabName.trim()) openBarTab(); }}
              className="w-full text-lg px-3 py-3 rounded-xl border border-(--ui-border-strong) focus:outline-none focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus)"
              autoFocus
              maxLength={80}
            />
            <p className="mt-2 text-xs text-(--ui-text-muted)">
              Stays open until you settle. Add items, send to kitchen, pay later.
            </p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setTabModalOpen(false)}
                disabled={tabBusy}
                className="flex-1 py-3 rounded-xl border border-(--ui-border-strong) text-(--ui-text) font-semibold hover:bg-(--ui-muted-surface) disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={openBarTab}
                disabled={tabBusy || !tabName.trim()}
                className="flex-1 py-3 rounded-xl bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-bold disabled:opacity-50"
              >
                {tabBusy ? "Opening…" : "Open Tab"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EntryButton({ icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-3 py-5 rounded-2xl bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-bold text-base transition-all active:scale-[0.99]"
    >
      <Icon size={22} />
      <span>{label}</span>
    </button>
  );
}

function TableTile({ table, onSeat, onOpen, onClear, reservation }) {
  const dirty = table.session_status === "dirty";
  const seated = Boolean(table.session_id) && !dirty;
  const tone = STATUS_TONE[table.session_status] || STATUS_TONE.closed;

  // W17: a 'dirty' table is post-settle, awaiting clean-up. The card stays
  // visually distinct so a busser knows to clear it; click on the card itself
  // is a no-op so a server doesn't accidentally open the closed check, but a
  // dedicated "Clear" pill flips the session to closed.
  const handleClick = () => {
    if (dirty) return;
    if (seated) onOpen?.(); else onSeat?.();
  };

  return (
    <button
      onClick={handleClick}
      className={`relative text-left rounded-2xl border p-4 transition ${
        dirty
          ? "bg-(--ui-primary) text-white border-(--ui-primary) hover:border-(--ui-text-muted)"
          : seated
          ? "bg-(--ui-primary) text-white border-(--ui-primary) hover:border-(--ui-text-muted)"
          : "bg-(--ui-surface) text-(--ui-text) border-(--ui-border-strong) hover:border-(--ui-primary)"
      }`}
    >
      {!seated && !dirty && reservation && <ReservationBadge reservation={reservation} />}
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-black tracking-tight">{table.label}</span>
        <span className={`text-[10px] uppercase tracking-wider opacity-70 ${(seated || dirty) ? "text-white/70" : "text-(--ui-text-muted)"}`}>
          Cap {table.capacity}
        </span>
      </div>
      {dirty ? (
        <div className="mt-3 space-y-2">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${tone}`}>
            Needs Bussing
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onClear?.(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onClear?.(); } }}
            className="block w-full text-center text-xs font-semibold py-1.5 rounded-md bg-white hover:bg-(--ui-muted-surface) text-(--ui-text)"
          >
            Clear Table
          </span>
        </div>
      ) : seated ? (
        <div className="mt-3 space-y-1.5">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${tone}`}>
            {table.session_status}
          </span>
          <div className="flex items-center gap-1.5 text-xs text-white/70">
            <Users size={12} />
            <span>{table.guest_count} guests</span>
          </div>
          {table.server_name && (
            <div className="text-xs text-white/60 truncate">{table.server_name}</div>
          )}
        </div>
      ) : (
        <div className="mt-3 text-xs text-(--ui-text-muted)">Tap to seat</div>
      )}
    </button>
  );
}
