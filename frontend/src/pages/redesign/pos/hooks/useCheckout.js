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
  // F06 — appointment checkout link: id rides the sale payload; the backend
  // completes the appointment on commit. Cleared with the cart after a sale.
  activeAppointmentId,
  clearActiveAppointment,
  // Phase 2-R.0 — restaurant shell context (all nullable; retail leaves at defaults)
  draftOrderId,
  orderContext,
  tableSessionId,
  seatCount,
  closeCheck,
  // Phase 2-R.0 Day 8 — guest handoff: when a signature was captured,
  // stash it in notes JSON so the column holds { text, signature_svg }.
  signatureSvg,
  setSignatureSvg,
  setShowGuestMode,
  // notices
  setError,
  showNotice,
  // 2-G.15 Day 4: when the backend rejects with insufficient_stock, we hand
  // the error payload up to POSContext so it can open POSInsufficientStockModal.
  onInsufficientStock,
  // Tier 0.1 wholesale — when /api/sales rejects a Credit-tender sale with
  // CREDIT_LIMIT_EXCEEDED (hard-mode + no override), open the manager-PIN
  // modal upstream. Caller invokes retryWithManagerPin(pin) to re-submit.
  onCreditLimitExceeded,
  // V04 salon — the preset drives the walk-in performed-by guard: for a salon
  // walk-in (no linked appointment) every line must carry an explicit
  // performer, never silently inherit the cashier.
  industryType,
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

  // Tier 0.1 wholesale — when /api/sales rejects a Credit sale with
  // CREDIT_LIMIT_EXCEEDED, the salePayload is parked in pendingSaleRef and
  // managerPinRef is filled by retryWithManagerPin(pin) which calls
  // completeSale() again. On the retry, the payload now carries manager_pin.
  // A non-null creditWarning surfaced from a successful sale (mode='warn'
  // path) is exposed so POS can show a non-blocking notice.
  const managerPinRef = useRef(null);
  const [creditWarning, setCreditWarning] = useState(null);

  // V02 wholesale backorders — staged remainder from an accepted shortfall
  // offer (POSInsufficientStockModal). Rides the next completeSale payload as
  // backorder_items; requires a customer. Cleared after the sale (or cart
  // clear) so a later unrelated sale never inherits stale rows.
  const backorderItemsRef = useRef([]);
  const stageBackorderItems = useCallback((items) => {
    backorderItemsRef.current = Array.isArray(items) ? items.filter(Boolean) : [];
  }, []);

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

  // Phase 2-G Wave 2 (2-G.2): optional `extras` slot lets the caller
  // attach method-specific fields (e.g. `code` for gift_card tender)
  // without changing the signature for Cash/Card/Wallet callers.
  const addPayment = useCallback((e, extras) => {
    if (e && e.preventDefault) e.preventDefault();
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return;
    const entry = { method: paymentMethod, amount, ...(extras || {}) };
    setPayments((prev) => [...prev, entry]);
    setPaymentAmount(
      remaining - amount > 0 ? (remaining - amount).toFixed(2) : "",
    );
  }, [paymentAmount, paymentMethod, remaining]);

  // P8 (3.14): per-rate tax breakdown derived from cart effectiveTaxRate.
  // Inclusive: backs out tax inside sticker price. Exclusive: tax on top.
  // Empty array when no line carries a positive rate.
  const buildTaxBreakdown = useCallback(() => {
    const map = new Map();
    for (const i of cart) {
      const rate = Number(i.effectiveTaxRate || 0);
      if (rate <= 0) continue;
      const lineGross = Number(i.price || 0) * Number(i.quantity || 0);
      const amount = taxInclusive
        ? lineGross - lineGross / (1 + rate / 100)
        : lineGross * rate / 100;
      map.set(rate, (map.get(rate) || 0) + amount);
    }
    return Array.from(map.entries())
      .map(([rate, amount]) => ({ rate, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.rate - a.rate);
  }, [cart, taxInclusive]);

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
    // P8 (3.14): keep taxAmount as a single-line fallback (older render
    // paths still read it); also pass tax_breakdown for the new per-rate
    // rendering. Exclusive sales include tax on top so the legacy
    // "GST (incl.)" line is replaced by the per-rate block.
    taxAmount: taxTotal > 0 ? taxTotal : 0,
    taxInclusive,
    tax_breakdown: buildTaxBreakdown(),
    orderNote: opts.orderNote ?? (orderNote || null),
    timestamp: new Date().toLocaleString(),
    // Phase 2-G Wave 2 (2-G.2) — codes issued on this sale (empty
    // array for any sale that didn't include a gift-card SKU).
    issuedGiftCards: Array.isArray(data?.issuedGiftCards) ? data.issuedGiftCards : [],
    // Tier 0.1 wholesale — A/R invoice details for on-account sales, null
    // for cash/card sales. POSReceiptModal renders an "On-Account" line
    // with invoice_number + due_date when present.
    arInvoice: data?.arInvoice || null,
  }), [cart, payments, total, change, outlets, selectedOutletId, employee, discountValue, discountInput, discountType, taxInclusive, taxTotal, orderNote, buildTaxBreakdown]);

  const clearAfterSale = useCallback(() => {
    setCart([]);
    setDiscountInput("");
    setOrderNote("");
    setSelectedCustomerId("");
    setCheckoutOpen(false);
    setPayments([]);
    setTipAmount("");
    setServerId("");
    // Phase 2-R.0 Day 8 — drop any captured guest signature + overlay state
    setSignatureSvg?.(null);
    setShowGuestMode?.(false);
    // Phase 2-R.0 — drop the restaurant shell back to its default state
    // (cart already cleared above). No-op for retail because closeCheck
    // is undefined when the restaurant shell isn't mounted.
    closeCheck?.();
    // F06 — the appointment link is consumed by the completed sale.
    clearActiveAppointment?.();
  }, [setCart, setDiscountInput, setOrderNote, setSelectedCustomerId, setCheckoutOpen, closeCheck, setSignatureSvg, setShowGuestMode, clearActiveAppointment]);

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
    const tipNum = Number(tipAmount || 0);
    const serverNum = serverId ? Number(serverId) : null;
    // V04 salon walk-in performed-by harden: an appointment checkout already
    // stamps each line with the segment's stylist, but a walk-in (no linked
    // appointment) previously fell back to the cashier (serverNum default) —
    // wrong stylist paid. Require an explicit performer pick (blocking, not a
    // default) before a salon walk-in can complete.
    const isSalonWalkIn = industryType === "salon" && !activeAppointmentId;
    if (isSalonWalkIn && cart.some((i) => !i.staff_id) && !serverNum) {
      setError?.("Select who performed the service (Performed by) before checkout.");
      return;
    }
    setSubmitting(true);
    setError?.("");
    // Phase 2.1 wiring: stamp every cart line with the server (staff_id) so
    // sale_items.staff_id captures server-of-record, and forward tip fields.
    const stampedCart = cart.map((i) => ({
      ...i,
      staff_id: i.staff_id || serverNum,
      // Modifiers ride along as a snapshot — backend persists on sale_items
      // when the column exists (Phase 2.2 will add modifier persistence).
      modifiers: i.modifiers || null,
    }));
    // Phase 2-R.0 Day 8 — signature_svg rides along in notes JSON when the
    // guest signed on the handoff screen. DB column is still plain TEXT in
    // 2-R.0; a dedicated sales.signature_svg column lands in 2-R.x.
    const notesForSale = signatureSvg
      ? JSON.stringify({ text: orderNote || null, signature_svg: signatureSvg })
      : (orderNote || null);
    const salePayload = {
      cartItems: stampedCart,
      payments,
      outlet_id: Number(selectedOutletId),
      employee_id: employee?.id || null,
      customer_id: checkoutCustomerId ? Number(checkoutCustomerId) : null,
      discount_amount: Number(discountInput || 0) + promoDiscount,
      discount_type: promoDiscount > 0 && !Number(discountInput || 0) ? "fixed" : discountType,
      notes: notesForSale,
      points_earned: checkoutCustomerId ? pointsEarned : 0,
      points_redeemed: checkoutCustomerId ? pointsRedeemed : 0,
      idempotency_key: crypto.randomUUID(),
      folio_id: chargeToRoomFolioId ? Number(chargeToRoomFolioId) : null,
      treatment_folio_id: chargeToTreatmentFolioId ? Number(chargeToTreatmentFolioId) : null,
      // Phase 2.1 C1 tip capture — backend requires both fields or skips tips.
      // W24: tip_method must be lowercase to satisfy the tip_captures CHECK
      // constraint (cash|card|split). The UI buttons store the capitalised
      // label for display; lowercase at the wire so DB inserts succeed.
      tip_amount: tipNum > 0 ? tipNum : 0,
      tip_method: tipNum > 0 ? String(tipMethod).toLowerCase() : null,
      server_id: serverNum,
      // Phase 2-R.0 — restaurant shell context. All nullable; backend at
      // routes/sales.js:445,1007 already accepts draft_order_id. The other
      // three fields are forward-compat for the shell's check workflow.
      draft_order_id: draftOrderId ?? null,
      order_context: orderContext ?? null,
      table_session_id: tableSessionId ?? null,
      seat_count: seatCount || null,
      // P8 (3.14): cart tax-inclusive toggle state. Backend resolves the
      // effective mode against company_profile.tax_mode and snapshots
      // per-line tax onto sale_items.
      tax_inclusive: !!taxInclusive,
      // Tier 0.1 wholesale — manager PIN to override a hard credit-limit block
      // on a Credit tender. Read once and cleared so retries don't reuse.
      manager_pin: managerPinRef.current || undefined,
      // F06 — appointment checkout link; backend completes the appointment.
      appointment_id: activeAppointmentId || null,
      // V02 wholesale backorders — accepted shortfall remainder (see
      // stageBackorderItems). Only sent with an identified customer; the
      // backend rejects backorders without one.
      backorder_items:
        backorderItemsRef.current.length && checkoutCustomerId
          ? backorderItemsRef.current
          : undefined,
    };
    // Clear the pin immediately after stamping the payload; if the retry
    // itself fails the user is prompted to enter again rather than silently
    // re-using a stale PIN. The salePayload above keeps the captured value.
    managerPinRef.current = null;

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
          taxAmount: taxTotal > 0 ? taxTotal : 0,
          taxInclusive,
          tax_breakdown: buildTaxBreakdown(),
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
      // 2-G.15 Day 4: insufficient_stock is a 400 with structured body.
      // Surface the modal instead of a generic toast so the cashier can
      // clamp/oversell/cancel without retyping the cart.
      if (!res.ok && data?.code === "insufficient_stock" && onInsufficientStock) {
        onInsufficientStock({
          product_id: data.product_id,
          variant_id: data.variant_id,
          available: data.available,
          requested: data.requested,
          // V02 — backend hint: flag on + customer attached + partial stock.
          backorder_available: data.backorder_available === true,
          message: data.error,
        });
        setSubmitting(false);
        return;
      }
      // Tier 0.1 wholesale — 403 CREDIT_LIMIT_EXCEEDED when a Credit-tender
      // sale would push the customer past their limit in hard-block mode.
      // Park the payload so retryWithManagerPin can re-submit with manager_pin.
      if (!res.ok && data?.code === "CREDIT_LIMIT_EXCEEDED" && onCreditLimitExceeded) {
        pendingSaleRef.current = salePayload;
        onCreditLimitExceeded({
          limit: Number(data.limit) || 0,
          outstanding: Number(data.outstanding) || 0,
          attempted: Number(data.attempted) || 0,
          deficit: Number(data.deficit) || 0,
          message: data.error,
        });
        setSubmitting(false);
        return;
      }
      if (!res.ok && data?.code === "CREDIT_REQUIRES_CUSTOMER") {
        setError?.("Credit tender requires a customer to be selected.");
        setSubmitting(false);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to complete sale");

      // Tier 0.1 wholesale — non-blocking creditWarning surfaced as a notice
      // when mode='warn' and the sale crossed the limit. (Backend always
      // populates this field; null on non-credit sales.)
      if (data?.creditWarning) {
        setCreditWarning(data.creditWarning);
        showNotice?.(data.creditWarning);
      } else {
        setCreditWarning(null);
      }

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

      // V02 — staged backorders are consumed by this sale (success) either
      // way; confirm to the cashier when the backend actually created rows.
      backorderItemsRef.current = [];
      clearAfterSale();
      if (Array.isArray(data?.backorders) && data.backorders.length) {
        showNotice?.(
          `Sale #${data.saleId} completed — ${data.backorders.length} item(s) backordered at today's price. Customer will be notified when stock arrives.`,
        );
      } else {
        showNotice?.(
          `Sale #${data.saleId} completed. Invoice: ${data.invoiceNumber || "-"}`,
        );
      }
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
    draftOrderId, orderContext, tableSessionId, seatCount, signatureSvg,
    onInsufficientStock, activeAppointmentId,
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

  // Tier 0.1 wholesale — re-submit a parked Credit-tender salePayload with a
  // verified manager PIN. The salePayload was stashed in pendingSaleRef by
  // the 403 CREDIT_LIMIT_EXCEEDED branch above. We stamp manager_pin onto a
  // shallow clone (NOT mutate the parked payload) so a failed retry can be
  // attempted again with a fresh PIN.
  const retryWithManagerPin = useCallback(async (pin) => {
    const parked = pendingSaleRef.current;
    if (!parked || !pin) return { ok: false, error: "No pending sale or PIN missing" };
    setSubmitting(true);
    setError?.("");
    try {
      const payload = { ...parked, manager_pin: String(pin) };
      const res = await api.raw(`/api/sales`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.status === 403 && data?.code === "CREDIT_LIMIT_EXCEEDED") {
        // PIN wrong / employee lacks override. Keep payload parked so a
        // fresh PIN can be tried.
        return { ok: false, error: data.error || "Invalid manager PIN" };
      }
      if (!res.ok) {
        pendingSaleRef.current = null;
        return { ok: false, error: data?.error || "Failed to complete sale" };
      }
      // Success — clear parked payload, render success slip exactly like the
      // primary completeSale path.
      pendingSaleRef.current = null;
      const custObj = parked.customer_id
        ? customers.find((c) => String(c.id) === String(parked.customer_id))
        : null;
      setSlip(buildSuccessSlip(data, custObj, {
        payments: parked.payments,
        discountInput: parked.discount_amount,
        discountType: parked.discount_type,
        orderNote: parked.notes || null,
      }));
      setSlipOpen(true);
      if (data?.creditWarning) {
        setCreditWarning(data.creditWarning);
        showNotice?.(data.creditWarning);
      }
      clearAfterSale();
      showNotice?.(`Sale #${data.saleId} completed. Invoice: ${data.invoiceNumber || "-"}`);
      await loadParked?.(selectedOutletId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || "Failed to complete sale" };
    } finally {
      setSubmitting(false);
    }
  }, [customers, setSlip, setSlipOpen, clearAfterSale, showNotice, setError, buildSuccessSlip, loadParked, selectedOutletId]);

  const cancelCreditOverride = useCallback(() => {
    pendingSaleRef.current = null;
  }, []);

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
    // Tier 0.1 wholesale — Credit-tender manager-PIN override
    retryWithManagerPin,
    cancelCreditOverride,
    creditWarning, setCreditWarning,
    // V02 wholesale backorders — stage the accepted shortfall remainder for
    // the next completeSale.
    stageBackorderItems,
    // Phase 2.1 C1 wiring
    tipAmount, setTipAmount,
    tipMethod, setTipMethod,
    serverId, setServerId,
  };
}
