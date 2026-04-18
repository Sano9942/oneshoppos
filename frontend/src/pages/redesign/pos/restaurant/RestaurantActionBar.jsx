import { useEffect, useState } from "react";
import { Send, Flame, CreditCard, MoreVertical, WifiOff } from "lucide-react";
import { api } from "../../../../api";
import { usePOS } from "../POSContext";
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

export default function RestaurantActionBar({ onOpenSplit, onOpenTransfer, onOpen86, onOpenVoidComp }) {
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
  } = usePOS();

  const [sending, setSending] = useState(false);
  const [firing, setFiring] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const online = useOnlineStatus();

  const cartEmpty = cart.length === 0;

  const sendToKitchen = async () => {
    if (cartEmpty || !online) return;
    setSending(true);
    try {
      const draftId = await ensureDraftOrder();
      if (!draftId) throw new Error("Could not create draft order");
      await api.post(`/api/restaurant/checks/${draftId}/send-to-kitchen`, {});
      showNotice?.("Sent to kitchen.");
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

  return (
    <div className="sticky bottom-0 z-40 bg-white border-t border-slate-200 px-4 py-3 shadow-[0_-10px_24px_-12px_rgba(0,0,0,0.12)]">
      {!online && (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
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
        <ActionButton
          icon={Flame}
          label={firing ? "Firing…" : `Fire C${activeCourse || 1}`}
          onClick={fireNextCourse}
          disabled={firing || !online}
          tone="ghost"
        />
        <button
          onClick={onPay}
          disabled={cartEmpty}
          className="flex-1 h-12 rounded-xl flex items-center justify-between px-4 bg-[#8066FF] hover:bg-[#7055E6] text-white font-black text-base shadow-[0_10px_20px_-10px_rgba(128,102,255,0.6)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
            className="h-12 w-12 rounded-xl flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
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
      ? "bg-slate-100 hover:bg-slate-200 text-slate-800"
      : "bg-[#8066FF] hover:bg-[#7055E6] text-white";
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
