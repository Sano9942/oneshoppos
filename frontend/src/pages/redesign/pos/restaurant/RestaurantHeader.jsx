import { useState, useEffect, useRef } from "react";
import { ChevronLeft, Users, Clock, User as UserIcon } from "lucide-react";
import { usePOS } from "../POSContext";

// Phase 2-R.0 Day 3 — Header strip for the check view.
// Shows table label + guest count + server name + elapsed time.
// Auto-collapses to a 36px strip once the user scrolls > 40px in the
// supplied scrollable container, so the menu/cart get more vertical space.

export default function RestaurantHeader({ onBack, scrollRef }) {
  const { orderContext, tableSessionId, tableLabel, tabName, seatCount, employee } = usePOS();
  const [collapsed, setCollapsed] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [tableSessionId, orderContext]);

  useEffect(() => {
    const node = scrollRef?.current;
    if (!node) return;
    const onScroll = () => setCollapsed(node.scrollTop > 40);
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  const contextLabel =
    orderContext === "dine_in"   ? `Table ${tableLabel || tableSessionId || "—"}` :
    orderContext === "takeout"   ? "Takeaway" :
    orderContext === "delivery"  ? "Delivery" :
    orderContext === "drive_thru" ? "Drive-Thru" :
    orderContext === "bar"       ? `Tab: ${tabName || "—"}` :
    "New Check";

  const elapsed = formatElapsed(elapsedSec);
  const serverName = employee?.name || employee?.username || "—";

  if (collapsed) {
    return (
      <div className="sticky top-0 z-40 h-9 px-4 flex items-center justify-between bg-(--ui-primary) text-white border-b border-(--ui-primary)">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs font-semibold text-white/70 hover:text-white"
        >
          <ChevronLeft size={14} />
          Floor
        </button>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-bold">{contextLabel}</span>
          {seatCount > 0 && <span className="text-white/60">· {seatCount}g</span>}
          <span className="text-white/60">· {elapsed}</span>
        </div>
        <span className="text-xs text-white/60 truncate max-w-[120px]">{serverName}</span>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-40 bg-(--ui-primary) text-white border-b border-(--ui-primary)">
      <div className="px-6 py-3 flex items-center gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-semibold transition"
        >
          <ChevronLeft size={16} />
          Floor
        </button>
        <div className="flex-1 flex items-center gap-6">
          <div>
            <div className="text-xl font-black tracking-tight">{contextLabel}</div>
            <div className="text-[10px] uppercase tracking-wider text-white/60 mt-0.5">
              {orderContext === "dine_in" ? "Dine-in" : orderContext}
            </div>
          </div>
          {orderContext === "dine_in" && seatCount > 0 && (
            <Stat icon={Users} label="Guests" value={seatCount} />
          )}
          <Stat icon={Clock} label="Elapsed" value={elapsed} />
          <Stat icon={UserIcon} label="Server" value={serverName} />
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/70">
        <Icon size={14} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-white/60">{label}</div>
        <div className="text-sm font-bold">{value}</div>
      </div>
    </div>
  );
}

function formatElapsed(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
