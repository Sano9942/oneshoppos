import { useEffect, useRef } from "react";
import { api } from "../../../../api";

// Pure side-effect: debounced 500ms POST to /api/pos/customer-display
// whenever cart / totals / shift change.
export function useCustomerDisplay({ cart, grossTotal, taxTotal, total, activeShift }) {
  const customerDisplayTimerRef = useRef(null);
  useEffect(() => {
    if (!activeShift?.id) return;
    clearTimeout(customerDisplayTimerRef.current);
    customerDisplayTimerRef.current = setTimeout(() => {
      const items = cart.map((i) => ({
        name: i.name,
        qty: i.quantity,
        price: i.price,
        total: i.quantity * i.price,
      }));
      api.post("/api/pos/customer-display", {
        shift_id: activeShift.id,
        items,
        subtotal: grossTotal,
        tax: taxTotal,
        total,
        status: cart.length > 0 ? "active" : "idle",
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(customerDisplayTimerRef.current);
  }, [cart, grossTotal, taxTotal, total, activeShift]);
}
