import { Clock } from "lucide-react";

// Phase 2-R.4 — tiny chip that overlays a table tile when a reservation
// is within the next 30 minutes. The fetcher lives in RestaurantFloorGrid
// and passes in the matched reservation; this component is pure presentation
// so it can be reused on other surfaces later.

export default function ReservationBadge({ reservation }) {
  if (!reservation) return null;
  const when = new Date(reservation.reservation_start).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="absolute top-1 right-1 flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 text-[10px] font-bold shadow">
      <Clock size={10} />
      <span>{reservation.customer_name.split(" ")[0]} · {when}</span>
    </div>
  );
}
