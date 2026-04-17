import { useState, useRef, useCallback } from "react";
import { api } from "../../../../api";
import { useAuth } from "../../../../auth/AuthProvider";

export function useCheckout({
  // shift gate
  selectedOutletId,
  activeShift,
  attendanceCode,
  // cart
  cart, setCart,
  total,
  grossTotal,
  taxTotal,
  taxInclusive,
  discountType,
  discountInput, setDiscountInput,
  discountValue,
  orderNote, setOrderNote,
  promoDiscount,
  // customers (shared at orchestrator)
  customers, setCustomers,
  selectedCustomerId, setSelectedCustomerId,
  outlets,
  // checkout state (lifted to orchestrator so folio/loyalty can depend on it)
  checkoutOpen, setCheckoutOpen,
  checkoutCustomerId, setCheckoutCustomerId,
  // folio
  chargeToRoomFolioId, setChargeToRoomFolioId,
  chargeToTreatmentFolioId,
  // loyalty / wallet
  redeemPointsOn, setRedeemPointsOn,
  setPayWithWalletOn,
  pointsEarned,
  pointsRedeemed,
  pointsDiscount,
  // receipt
  setSlip, setSlipOpen,
  // offline queue
  enqueueSale,
  // parked sales reload
  loadParked,
  // notices
  setError,
  showNotice,
}) {
  const { employee } = useAuth();

  const [payments, setPayments] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [checkoutCustSearch, setCheckoutCustSearch] = useState("");
  const [showCheckoutCustDD, setShowCheckoutCustDD] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const payAmountRef = useRef(null);

  // Quick-create customer inside checkout
  const [custMode, setCustMode] = useState("search");
  const [newCustName, setNewCustName] = useState("");
  const [newCustMobile, setNewCustMobile] = useState("");
  const [newCustSaving, setNewCustSaving] = useState(false);
  const [newCustError, setNewCustError] = useState("");

  // Session expiry
  const [sessionExpired, setSessionExpired] = useState(false);
  const pendingSaleRef = useRef(null);

  // Phase 2.1 C1 — tip + server capture for restaurant sales. Stored here so
  // any preset can use them; backend ignores tips when tip_amount = 0 and
  // staff_id is nullable on sale_items.
  const [tipAmount, setTipAmount] = useState("");
  const [tipMethod, setTipMethod] = useState("Cash");
  const [serverId, setServerId] = useState("");

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  // Tip is collected alongside the sale total — included in what the guest owes.
  const tipNumeric = Math.max(0, Number(tipAmount || 0));
  const remaining = Math.max(0, total + tipNumeric - totalPaid - pointsDiscount);
  const change = Math.max(0, totalPaid - total - tipNumeric + pointsDiscount);

  const openCheckout = useCallback(() => {
    if (!cart.length) return;
    if (!selectedOutletId) {
      setError?.("Select a branch before using POS.");
      return;
    }
    if (!activeShift) {
      setError?.("Open the shift before completing sales.");
      return;
    }
    if (attendanceCode !== "clocked_in") {
      setError?.(
        attendanceCode === "on_break"
          ? "Clock back in before using POS."
          : "Clock in at the kiosk before using POS.",
      );
      return;
    }
    setPayments([]);
    setPaymentMethod("Cash");
    setTipAmount("");
    setServerId("");
    setPaymentAmount(total.toFixed(2));
    setCheckoutCustomerId(selectedCustomerId);
    setCheckoutCustSearch(
      selectedCustomerId
        ? customers.find((c) => String(c.id) === String(selectedCustomerId))?.name || ""
        : "",
    );
    setCustMode("search");
    setNewCustName("");
    setNewCustMobile("");
    setNewCustError("");
    setRedeemPointsOn(false);
    setPayWithWalletOn(false);
    setChargeToRoomFolioId("");
    setCheckoutOpen(true);
  }, [cart.length, selectedOutletId, activeShift, attendanceCode, total, selectedCustomerId, customers, setError, setRedeemPointsOn, setPayWithWalletOn, setChargeToRoomFolioId, setCheckoutCustomerId, setCheckoutOpen]);

  const handleQuickCreateCustomer = useCallback(async () => {
    if (!newCustName.trim()) {
      setNewCustError("Name is required");
      return;
    }
    setNewCustSaving(true);
    setNewCustError("");
    try {
      const data = await api.post("/api/customers", {
        name: newCustName.trim(),
        mobile: newCustMobile.trim() || null,
      });
      setCustomers((prev) => [...prev, data]);
      setCheckoutCustomerId(String(data.id));
      setCheckoutCustSearch(data.name);
      setCustMode("search");
      setNewCustName("");
      setNewCustMobile("");
    } catch {
      setNewCustError("Network error");
    } finally {
      setNewCustSaving(false);
    }
  }, [newCustName, newCustMobile, setCustomers, setCheckoutCustomerId]);

  const addPayment = useCallback((e) => {
    if (e && e.preventDefault) e.preventDefault();
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return;
    setPayments((prev) => [...prev, { method: paymentMethod, amount }]);
    setPaymentAmount(
      remaining - amount > 0 ? (remaining - amount).toFixed(2) : "",
    );
  }, [paymentAmount, paymentMethod, remaining]);

  const buildSuccessSlip = useCallback((data, custObj, opts = {}) => ({
    saleId: data.saleId,
    invoiceNumber: data.invoiceNumber || "-",
    cart: [...cart],
    payments: opts.payments ?? [...payments],
    total,
    change,
    customer: custObj || null,
    outlet: outlets.find((o) => String(o.id) === String(selectedOutletId)),
    employee,
    discountAmount: discountValue,
    discountInput: opts.discountInput ?? Number(discountInput || 0),
    discountType: opts.discountType ?? discountType,
    taxAmount: taxInclusive && taxTotal > 0 ? taxTotal : 0,
    taxInclusive,
    orderNote: opts.orderNote ?? (orderNote || null),
    timestamp: new Date().toLocaleString(),
  }), [cart, payments, total, change, outlets, selectedOutletId, employee, discountValue, discountInput, discountType, taxInclusive, taxTotal, orderNote]);

  const clearAfterSale = useCallback(() => {
    setCart([]);
    setDiscountInput("");
    setOrderNote("");
    setSelectedCustomerId("");
    setCheckoutOpen(false);
    setPayments([]);
    setTipAmount("");
    setServerId("");
  }, [setCart, setDiscountInput, setOrderNote, setSelectedCustomerId, setCheckoutOpen]);

  const completeSale = useCallback(async () => {
    if (!selectedOutletId || !cart.length) return;
    if (!chargeToRoomFolioId && !chargeToTreatmentFolioId && remaining > 0) return;
    if (!activeShift) {
      setError?.("Cannot checkout until a shift is open.");
      return;
    }
    if (attendanceCode !== "clocked_in") {
      setError?.(
        attendanceCode === "on_break"
          ? "Cannot checkout while on break."
          : "Cannot checkout until you are clocked in.",
      );
      return;
    }
    setSubmitting(true);
    setError?.("");
    // Phase 2.1 wiring: stamp every cart line with the server (staff_id) so
    // sale_items.staff_id captures server-of-record, and forward tip fields.
    const tipNum = Number(tipAmount || 0);
    const serverNum = serverId ? Number(serverId) : null;
    const stampedCart = cart.map((i) => ({
      ...i,
      staff_id: i.staff_id || serverNum,
      // Modifiers ride along as a snapshot — backend persists on sale_items
      // when the column exists (Phase 2.2 will add modifier persistence).
      modifiers: i.modifiers || null,
    }));
    const salePayload = {
      cartItems: stampedCart,
      payments,
      outlet_id: Number(selectedOutletId),
      employee_id: employee?.id || null,
      customer_id: checkoutCustomerId ? Number(checkoutCustomerId) : null,
      discount_amount: Number(discountInput || 0) + promoDiscount,
      discount_type: promoDiscount > 0 && !Number(discountInput || 0) ? "fixed" : discountType,
      notes: orderNote || null,
      points_earned: checkoutCustomerId ? pointsEarned : 0,
      points_redeemed: checkoutCustomerId ? pointsRedeemed : 0,
      idempotency_key: crypto.randomUUID(),
      folio_id: chargeToRoomFolioId ? Number(chargeToRoomFolioId) : null,
      treatment_folio_id: chargeToTreatmentFolioId ? Number(chargeToTreatmentFolioId) : null,
      // Phase 2.1 C1 tip capture — backend requires both fields or skips tips.
      tip_amount: tipNum > 0 ? tipNum : 0,
      tip_method: tipNum > 0 ? tipMethod : null,
      server_id: serverNum,
    };

    const queueSaleOffline = async () => {
      try {
        const count = await enqueueSale(salePayload);
        const custObj = checkoutCustomerId
          ? customers.find((c) => String(c.id) === String(checkoutCustomerId))
          : null;
        setSlip({
          saleId: null,
          invoiceNumber: "PENDING",
          cart: [...cart],
          payments: [...payments],
          total,
          change,
          customer: custObj || null,
          outlet: outlets.find((o) => String(o.id) === String(selectedOutletId)),
          employee,
          discountAmount: discountValue,
          discountInput: Number(discountInput || 0),
          discountType,
          taxAmount: taxInclusive && taxTotal > 0 ? taxTotal : 0,
          taxInclusive,
          orderNote: orderNote || null,
          timestamp: new Date().toLocaleString(),
          offline: true,
        });
        setSlipOpen(true);
        clearAfterSale();
        showNotice?.(`Sale queued offline (${count} pending). Will sync when online.`);
      } catch (queueErr) {
        setError?.(queueErr.message);
      }
    };

    if (!navigator.onLine) {
      await queueSaleOffline();
      setSubmitting(false);
      return;
    }

    try {
      const res = await api.raw(`/api/sales`, {
        method: "POST",
        body: JSON.stringify(salePayload),
      });
      const data = await res.json();
      if (res.status === 401) {
        pendingSaleRef.current = salePayload;
        setSessionExpired(true);
        setSubmitting(false);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to complete sale");

      const custObj = checkoutCustomerId
        ? customers.find((c) => String(c.id) === String(checkoutCustomerId))
        : null;
      setSlip(buildSuccessSlip(data, custObj));
      setSlipOpen(true);

      if (activeShift?.id) {
        api.post("/api/pos/customer-display", {
          shift_id: activeShift.id,
          items: cart.map((i) => ({ name: i.name, qty: i.quantity, price: i.price, total: i.quantity * i.price })),
          subtotal: grossTotal,
          tax: taxTotal,
          total,
          status: "paid",
        }).catch(() => {});
      }

      clearAfterSale();
      showNotice?.(
        `Sale #${data.saleId} completed. Invoice: ${data.invoiceNumber || "-"}`,
      );
      await loadParked?.(selectedOutletId);
    } catch (e) {
      if (e instanceof TypeError || !navigator.onLine) {
        await queueSaleOffline();
      } else {
        setError?.(e.message || "Failed to complete sale");
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedOutletId, cart, chargeToRoomFolioId, chargeToTreatmentFolioId, remaining,
    activeShift, attendanceCode, payments, employee, checkoutCustomerId,
    discountInput, promoDiscount, discountType, orderNote, pointsEarned, pointsRedeemed,
    customers, total, change, outlets, discountValue, taxInclusive, taxTotal, grossTotal,
    enqueueSale, setSlip, setSlipOpen, clearAfterSale, showNotice, setError,
    buildSuccessSlip, loadParked, tipAmount, tipMethod, serverId,
  ]);

  const retryPendingSale = useCallback(async () => {
    const payload = pendingSaleRef.current;
    if (!payload) return;
    pendingSaleRef.current = null;
    setSessionExpired(false);
    setSubmitting(true);
    setError?.("");
    try {
      const data = await api.post("/api/sales", payload);

      const custObj = payload.customer_id
        ? customers.find((c) => String(c.id) === String(payload.customer_id))
        : null;
      setSlip(buildSuccessSlip(data, custObj, {
        payments: payload.payments,
        discountInput: payload.discount_amount,
        discountType: payload.discount_type,
        orderNote: payload.notes || null,
      }));
      setSlipOpen(true);
      clearAfterSale();
      showNotice?.(`Sale #${data.saleId} completed. Invoice: ${data.invoiceNumber || "-"}`);
      await loadParked?.(selectedOutletId);
    } catch (e) {
      setError?.(e.message || "Failed to complete sale");
    } finally {
      setSubmitting(false);
    }
  }, [customers, setSlip, setSlipOpen, clearAfterSale, showNotice, setError, buildSuccessSlip, loadParked, selectedOutletId]);

  return {
    payments, setPayments,
    paymentMethod, setPaymentMethod,
    paymentAmount, setPaymentAmount,
    checkoutCustSearch, setCheckoutCustSearch,
    showCheckoutCustDD, setShowCheckoutCustDD,
    submitting, setSubmitting,
    payAmountRef,
    custMode, setCustMode,
    newCustName, setNewCustName,
    newCustMobile, setNewCustMobile,
    newCustSaving, setNewCustSaving,
    newCustError, setNewCustError,
    totalPaid,
    remaining,
    change,
    openCheckout,
    handleQuickCreateCustomer,
    addPayment,
    completeSale,
    sessionExpired, setSessionExpired,
    retryPendingSale,
    // Phase 2.1 C1 wiring
    tipAmount, setTipAmount,
    tipMethod, setTipMethod,
    serverId, setServerId,
  };
}
