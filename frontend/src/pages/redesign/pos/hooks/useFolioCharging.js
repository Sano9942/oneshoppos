import { useState, useEffect } from "react";
import { api } from "../../../../api";

export function useFolioCharging({ selectedOutletId, checkoutOpen, checkoutCustomerId }) {
  // M9 — charge-to-room (room_management mode only)
  const [chargeToRoomFolioId, setChargeToRoomFolioId] = useState("");
  const [openBookings, setOpenBookings] = useState([]);
  const [openBookingsLoading, setOpenBookingsLoading] = useState(false);

  // M10 — charge-to-plan (treatment_plans mode only)
  const [chargeToTreatmentFolioId, setChargeToTreatmentFolioId] = useState("");
  const [openTreatmentPlans, setOpenTreatmentPlans] = useState([]);

  // Load open room bookings when checkout opens — silent fail if mode off
  useEffect(() => {
    if (!checkoutOpen || !selectedOutletId) return;
    let cancelled = false;
    (async () => {
      try {
        setOpenBookingsLoading(true);
        const data = await api.get(
          `/api/room-bookings?status=checked_in&outlet_id=${selectedOutletId}`
        );
        if (cancelled) return;
        setOpenBookings(Array.isArray(data?.bookings) ? data.bookings : []);
      } catch {
        if (!cancelled) setOpenBookings([]);
      } finally {
        if (!cancelled) setOpenBookingsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [checkoutOpen, selectedOutletId]);

  // M10 — fetch open treatment plans for checkout customer
  useEffect(() => {
    if (!checkoutCustomerId) {
      setOpenTreatmentPlans([]);
      setChargeToTreatmentFolioId("");
      return;
    }
    api.get("/api/treatment-plans", { customer_id: checkoutCustomerId, status: "active" })
      .then((r) => setOpenTreatmentPlans(r.plans || []))
      .catch(() => setOpenTreatmentPlans([]));
  }, [checkoutCustomerId]);

  return {
    chargeToRoomFolioId, setChargeToRoomFolioId,
    openBookings,
    openBookingsLoading,
    chargeToTreatmentFolioId, setChargeToTreatmentFolioId,
    openTreatmentPlans, setOpenTreatmentPlans,
  };
}
