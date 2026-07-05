import { useEffect, useState } from "react";
import { Send, Flame, CreditCard, MoreVertical, WifiOff, QrCode } from "lucide-react";
import { api } from "../../../../api";
import { usePOS } from "../POSContext";
import { usePreset } from "../../../../contexts/PresetContext";
import RestaurantOverflowMenu from "./RestaurantOverflowMenu";

function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine !== false : true,
  );
  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);
  return online;
}

// Phase 2-R.0 Day 5 + 6 — Sticky bottom action bar.
// Three primary actions: Send to Kitchen / Fire Course N / Pay.
// "More" button opens RestaurantOverflowMenu (Day 6): Split, Comp,
// Discount, Transfer Table, Add Seat, Note.
//
// Send to Kitchen lazily creates the backing draft order via
// ensureDraftOrder() so the user can build a check first and the draft
// row only appears when they actually fire it.

export default function RestaurantActionBar({ onOpenSplit, onOpenTransfer, onOpen86, onOpenVoidComp, onOpenPayAtTable }) {
  const {
    cart,
    money,
    total,
    openCheckout,
    ensureDraftOrder,
    showNotice,
    setError,
    activeCourse,
    setActiveCourse,
    orderContext,
    posFlags,
  } = usePOS();

  const { pos_layout_mode } = usePreset();
  const isCounter = pos_layout_mode === "counter";

  const [sending, setSending] = useState(false);
  const [firing, setFiring] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const online = useOnlineStatus();

  const cartEmpty = cart.length === 0;

  // Sync the local cart into draft_order_items via PUT before any kitchen
  // action. The backend PUT handler delete-and-rebuilds the items array, so
  // calling this each fire/send keeps the backend draft in step with whatever
  // the cashier has on screen — including 86'd lines, qty bumps, etc. Without
  // this, ensureDraftOrder() leaves an empty draft and fire-course fires
  // nothing (the draft has zero items to advance to "fired").
  //
  // W16 follow-up: when the cart is fully composed of items already
  // 'sent'/'fired' (post-rehydrate, no new additions), skip the PUT — there's
  // nothing new to send. Without this skip, re-clicking Send-to-Kitchen on a
  // rehydrated cart would delete-and-rebuild the same items, re-firing them.
  const syncCartToDraft = async (draftId) => {
    if (!draftId) return;
    if (cart.every((i) => i.kitchen_status === "sent" || i.kitchen_status === "fired")) {
      return;
    }
    const items = cart.map((i) => ({
      product_id: i.id,
      variant_id: i.variant_id || null,
      name: i.name,
      quantity: i.quantity,
      price: i.price,
      seat_number: i.seat_number ?? null,
      course_name: i.course_name || "main",
    }));
    await api.put(`/api/draft-orders/${draftId}`, { items });
  };

  const sendToKitchen = async () => {
    if (cartEmpty || !online) return;
    setSending(true);
    try {
      const draftId = await ensureDraftOrder();
      if (!draftId) throw new Error("Could not create draft order");
      await syncCartToDraft(draftId);
      const result = await api.post(`/api/restaurant/checks/${draftId}/send-to-kitchen`, {});
      // W15 defense: backend silently returns zero tickets when no KDS
      // stations are configured for the outlet. Surface that as a clear
      // warning so the cashier doesn't think the kitchen got the order.
      const ticketCount = Array.isArray(result?.tickets) ? result.tickets.length : 0;
      if (ticketCount === 0) {
        setError?.("No kitchen stations configured. Set one up in KDS settings before sending orders.");
      } else {
        showNotice?.(`Sent ${ticketCount} ticket${ticketCount === 1 ? "" : "s"} to kitchen.`);
      }
    } catch (e) {
      setError?.(e.message || "Failed to send to kitchen");
    } finally {
      setSending(false);
    }
  };

  const fireNextCourse = async () => {
    if (!online) return;
    setFiring(true);
    try {
      const draftId = await ensureDraftOrder();
      if (!draftId) throw new Error("Could not create draft order");
      await syncCartToDraft(draftId);
      const courseName = `course_${activeCourse || 1}`;
      await api.post(`/api/restaurant/checks/${draftId}/fire-course`, {
        course_name: courseName,
      });
      showNotice?.(`Fired ${courseName}.`);
      setActiveCourse(Math.min(5, (Number(activeCourse) || 1) + 1));
    } catch (e) {
      setError?.(e.message || "Failed to fire course");
    } finally {
      setFiring(false);
    }
  };

  const onPay = () => {
    if (cartEmpty) return;
    openCheckout();
  };

  // 2-R.3 — "Request QR" is only meaningful on dine-in checks and when the
  // tenant has the pay-at-table flag on. Retail and non-restaurant tenants
  // never see it; takeout/delivery/drive-thru go through the existing
  // checkout flow because those guests aren't at a table to scan.
  const showPayAtTable =
    !!posFlags?.phase4_restaurant_pay_at_table &&
    orderContext === "dine_in";

  const onRequestQR = async () => {
    if (cartEmpty || !online) return;
    try {
      const draftId = await ensureDraftOrder();
      if (!draftId) throw new Error("Could not create draft order");
      await syncCartToDraft(draftId);
      onOpenPayAtTable?.(draftId);
    } catch (e) {
      setError?.(e.message || "Failed to open QR payment");
    }
  };

  return (
    <div className="sticky bottom-0 z-40 bg-(--ui-surface) border-t border-(--ui-border-strong) px-4 py-3">
      {!online && (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-(--ui-warning-bg) border border-(--ui-warning-fg)/30 text-(--ui-warning-fg) text-xs font-bold">
          <WifiOff size={14} />
          <span>Kitchen firing requires connection. Pay still works offline.</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <ActionButton
          icon={Send}
          label={sending ? "Sending…" : "Send to Kitchen"}
          onClick={sendToKitchen}
          disabled={cartEmpty || sending || !online}
          tone="ghost"
        />
        {!isCounter && (
          <ActionButton
            icon={Flame}
            label={firing ? "Firing…" : `Fire C${activeCourse || 1}`}
            onClick={fireNextCourse}
            disabled={firing || !online}
            tone="ghost"
          />
        )}
        {showPayAtTable && (
          <ActionButton
            icon={QrCode}
            label="Request QR"
            onClick={onRequestQR}
            disabled={cartEmpty || !online}
            tone="ghost"
          />
        )}
        <button
          onClick={onPay}
          disabled={cartEmpty}
          className="flex-1 h-12 rounded-xl flex items-center justify-between px-4 bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-black text-base disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <span className="flex items-center gap-2">
            <CreditCard size={18} />
            Pay
          </span>
          <span className="tracking-tight">{money(total)}</span>
        </button>
        <div className="relative">
          <button
            onClick={() => setShowMore((v) => !v)}
            className="h-12 w-12 rounded-xl flex items-center justify-center bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) text-(--ui-text) transition"
          >
            <MoreVertical size={18} />
          </button>
          <RestaurantOverflowMenu
            open={showMore}
            onClose={() => setShowMore(false)}
            onOpenSplit={onOpenSplit}
            onOpenTransfer={onOpenTransfer}
            onOpen86={onOpen86}
            onOpenVoidComp={onOpenVoidComp}
          />
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled, tone = "ghost" }) {
  const base =
    tone === "ghost"
      ? "bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) text-(--ui-text)"
      : "bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-12 px-4 rounded-xl flex items-center gap-2 font-bold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed ${base}`}
    >
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );
}
