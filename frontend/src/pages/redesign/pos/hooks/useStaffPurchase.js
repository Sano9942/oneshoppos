// One Toy Store F3b part 2: the till's Staff button. A staff member takes a
// toy at cost: normal price on the lines, a "Staff" discount down to cost.
// The server works the cost out (POST /api/staff-pay/staff-quote) and again
// when the sale is saved; the till only shows it. Cost needs the server, so
// the button is off while offline.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../../api";

export const CUT_FROM_SALARY = "Cut from salary";

// A staff bill may be paid Cash, Online - …, or Cut from salary.
export function staffPaymentAllowed(method) {
  const m = String(method || "");
  return m === "Cash" || m === CUT_FROM_SALARY || m.startsWith("Online - ");
}

const cartKey = (cart) =>
  cart.map((i) => `${i.id}:${i.variant_id || ""}:${i.quantity}:${i.price}`).join("|");

export function useStaffPurchase({ cart }) {
  const [staff, setStaff] = useState(null); // { id, name }
  const [staffList, setStaffList] = useState([]);
  const [listError, setListError] = useState("");
  const [result, setResult] = useState(null); // { key, quote } | { key, error }

  const key = useMemo(() => (staff ? `${staff.id}#${cartKey(cart)}` : ""), [staff, cart]);

  useEffect(() => {
    if (!staff || !cart.length) return undefined;
    let live = true;
    api.post("/api/staff-pay/staff-quote", {
      employee_id: staff.id,
      items: cart.map((i) => ({ id: i.id, variant_id: i.variant_id || null, quantity: i.quantity, price: i.price })),
    })
      .then((quote) => { if (live) setResult({ key, quote }); })
      .catch((err) => { if (live) setResult({ key, error: err.message || "Couldn't get the cost price" }); });
    return () => { live = false; };
  }, [key, staff, cart]);

  // Only a quote for exactly this cart counts.
  const current = result && result.key === key ? result : null;

  const loadStaff = useCallback(() => {
    setListError("");
    return api.get("/api/staff-pay/staff-list")
      .then((d) => setStaffList(d.staff || []))
      .catch((err) => setListError(err.message || "Couldn't load staff"));
  }, []);

  const clearStaff = useCallback(() => {
    setStaff(null);
    setResult(null);
  }, []);

  return {
    staff,
    setStaff,
    clearStaff,
    staffList,
    listError,
    loadStaff,
    quote: current?.quote || null,
    quoteError: current?.error || "",
    quotePending: !!staff && cart.length > 0 && !current,
  };
}
