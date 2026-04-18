import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api";
import { useAuth } from "../../../auth/AuthProvider";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { usePreset } from "../../../contexts/PresetContext";
import { useCart } from "./hooks/useCart";
import { useShiftGate } from "./hooks/useShiftGate";
import { useReceipt } from "./hooks/useReceipt";
import { useCustomerDisplay } from "./hooks/useCustomerDisplay";
import { useLoyaltyWallet } from "./hooks/useLoyaltyWallet";
import { useFolioCharging } from "./hooks/useFolioCharging";
import { useOfflineQueue } from "./hooks/useOfflineQueue";
import { useCheckout } from "./hooks/useCheckout";

/* ──────────────────────────────────────────────────────────────────────────────
 * WAVE-C SNAPSHOT — usePOS() value object keys (pre-split, for diff verification)
 * Every key below must remain in the orchestrator's `value` object after the split.
 *
 * employee, authHeaders, logout, handleLogout, isLocked, setIsLocked, lockPin,
 * setLockPin, lockError, setLockError, outlets, customers, selectedOutletId,
 * setSelectedOutletId, activeShift, attendanceStatus, attendanceCode, gateLoading,
 * canOpenShift, canSwitchOutlet, isReadyForCheckout, openingDenoms,
 * setOpeningDenoms, openingFloat, openingShiftBusy, openShiftFromPOS,
 * closeShiftOpen, setCloseShiftOpen, refreshGateStatus, search, setSearch,
 * barcodeSearch, setBarcodeSearch, skuSearch, setSkuSearch, priceSearch,
 * setPriceSearch, results, setResults, showResults, setShowResults, searchRef,
 * cart, setCart, taxInclusive, setTaxInclusive, discountType, setDiscountType,
 * discountInput, setDiscountInput, orderNote, setOrderNote, showDiscountModal,
 * setShowDiscountModal, showNoteModal, setShowNoteModal, selectedCustomerId,
 * setSelectedCustomerId, customerSearch, setCustomerSearch, showCustomerDD,
 * setShowCustomerDD, parkedSales, setParkedSales, showParked, setShowParked,
 * checkoutOpen, setCheckoutOpen, payments, setPayments, paymentMethod,
 * setPaymentMethod, paymentAmount, setPaymentAmount, checkoutCustomerId,
 * setCheckoutCustomerId, checkoutCustSearch, setCheckoutCustSearch,
 * showCheckoutCustDD, setShowCheckoutCustDD, submitting, setSubmitting,
 * payAmountRef, custMode, setCustMode, newCustName, setNewCustName,
 * newCustMobile, setNewCustMobile, newCustSaving, setNewCustSaving, newCustError,
 * setNewCustError, slip, setSlip, slipOpen, setSlipOpen, receiptTemplate, notice,
 * setNotice, error, setError, success, setSuccess, money, currencyDenominations,
 * currencySymbol, presetLabels, showNotice, loadParked, triggerSearch,
 * handleSearchChange, addToCart, updateQty, setQty, removeFromCart, grossTotal,
 * discountValue, taxTotal, total, totalPaid, remaining, change, selectedCustomer,
 * filteredCustomers, filteredCheckoutCustomers, parkSale, posFlags, restoreParked,
 * openCheckout, handleQuickCreateCustomer, addPayment, printSlip, completeSale,
 * chargeToRoomFolioId, setChargeToRoomFolioId, openBookings, openBookingsLoading,
 * chargeToTreatmentFolioId, setChargeToTreatmentFolioId, openTreatmentPlans,
 * setOpenTreatmentPlans, handleLock, handleUnlock, recentSalesOpen,
 * setRecentSalesOpen, recentSales, recentSalesLoading, recentSalesSearch,
 * setRecentSalesSearch, loadRecentSales, returnModalOpen, setReturnModalOpen,
 * returnSourceSale, setReturnSourceSale, openReturnFromSale,
 * checkoutWalletBalance, checkoutWalletLoading, redeemPointsOn, setRedeemPointsOn,
 * payWithWalletOn, setPayWithWalletOn, checkoutCustomerPoints, checkoutCustomerTier,
 * pointsEarned, pointsDiscount, pointsRedeemed, LOYALTY_EARN_RATE,
 * LOYALTY_REDEEM_RATE, sessionExpired, setSessionExpired, retryPendingSale,
 * offlineQueueCount, offlineSyncing, offlineSyncResult, syncQueue,
 * showShortcutsOverlay, setShowShortcutsOverlay, endlessAisleProduct,
 * handleEndlessAisle, closeEndlessAisle, priceListItems, posLayout, suggestions,
 * appliedPromotions, promoDiscount
 * ────────────────────────────────────────────────────────────────────────────── */

const POSContext = createContext();

export const usePOS = () => {
  const context = useContext(POSContext);
  if (!context) throw new Error("usePOS must be used within a POSProvider");
  return context;
};

export const POSProvider = ({ children }) => {
  const navigate = useNavigate();
  const { employee, authHeaders, logout } = useAuth();
  const { fmt: money, denominations: currencyDenominations, symbol: currencySymbol } = useCurrency();
  const { labels: presetLabels } = usePreset();

  // ── Notices (shared across hooks via showNotice / setError) ──────────────
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const noticeTimer = useRef(null);
  const showNotice = useCallback((msg) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  }, []);

  // ── Feature flags ────────────────────────────────────────────────────────
  const [posFlags, setPosFlags] = useState({});
  useEffect(() => {
    api.get("/api/feature-flags").then(d => {
      const map = {};
      for (const f of (d.flags || [])) map[f.key] = f.enabled;
      setPosFlags(map);
    }).catch(() => {});
  }, []);

  // ── Lock state ───────────────────────────────────────────────────────────
  const [isLocked, setIsLocked] = useState(
    () => sessionStorage.getItem("posLocked") === "1",
  );
  const [lockPin, setLockPin] = useState("");
  const [lockError, setLockError] = useState("");

  // ── Customers (shared across hooks) ──────────────────────────────────────
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDD, setShowCustomerDD] = useState(false);

  useEffect(() => {
    api.get("/api/customers")
      .then((custData) => setCustomers(custData.customers || []))
      .catch(() => {});
  }, []);

  // ── Parked sales ────────────────────────────────────────────────────────
  const [parkedSales, setParkedSales] = useState([]);
  const [showParked, setShowParked] = useState(false);

  // ── Endless aisle ────────────────────────────────────────────────────────
  const [endlessAisleProduct, setEndlessAisleProduct] = useState(null);
  const handleEndlessAisle = useCallback((product) => setEndlessAisleProduct(product), []);
  const closeEndlessAisle = useCallback(() => setEndlessAisleProduct(null), []);

  // ── Return / Exchange Modal ──────────────────────────────────────────────
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnSourceSale, setReturnSourceSale] = useState(null);
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);

  // ── Checkout state lifted here so folio + loyalty can depend on it ──────
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutCustomerId, setCheckoutCustomerId] = useState("");

  // ── Compose hooks (bottom-up) ────────────────────────────────────────────
  const shift = useShiftGate({ setError, showNotice });

  const cartHook = useCart({
    selectedOutletId: shift.selectedOutletId,
    selectedCustomerId,
    customers,
    posFlags,
    showNotice,
  });

  // ── Restaurant shell state (Phase 2-R.0) ──────────────────────────────────
  // Additive — retail POS never sets these so all values stay at defaults.
  // openCheck/closeCheck flip them as the restaurant shell transitions
  // between floor and check views; ensureDraftOrder lazily creates the draft
  // backing the current check on first kitchen action.
  const [draftOrderId, setDraftOrderId] = useState(null);
  const [orderContext, setOrderContext] = useState(null);
  const [tableSessionId, setTableSessionId] = useState(null);
  const [seatCount, setSeatCount] = useState(0);
  const [activeSeat, setActiveSeat] = useState(1);
  const [activeCourse, setActiveCourse] = useState(1);

  const openCheck = useCallback(({ context, tableSessionId: tsid = null, draftOrderId: doid = null, seatCount: sc = 0 } = {}) => {
    setOrderContext(context || null);
    setTableSessionId(tsid);
    setDraftOrderId(doid);
    setSeatCount(sc);
    setActiveSeat(1);
    setActiveCourse(1);
    cartHook.setCart([]);
  }, [cartHook]);

  const closeCheck = useCallback(() => {
    setDraftOrderId(null);
    setOrderContext(null);
    setTableSessionId(null);
    setSeatCount(0);
    setActiveSeat(1);
    setActiveCourse(1);
  }, []);

  const ensureDraftOrder = useCallback(async () => {
    if (draftOrderId) return draftOrderId;
    const data = await api.post("/api/draft-orders", {
      order_context: orderContext,
      table_session_id: tableSessionId,
      seat_count: seatCount,
    });
    const newId = data?.draftOrder?.id ?? data?.id ?? null;
    setDraftOrderId(newId);
    return newId;
  }, [draftOrderId, orderContext, tableSessionId, seatCount]);

  // ── Modifier picker (Phase 2.1 A2 wiring) ──────────────────────────────────
  // When a product with linked modifier groups is added, pause the add flow
  // and show POSModifierModal. After selection, add with price delta applied.
  const [modifierModalState, setModifierModalState] = useState(null);
  // Phase 2-R.0: when a restaurant check is open (orderContext set), stamp
  // every cart line with the picker's active seat + course. Retail flow
  // leaves orderContext null so no overlay is built and the cart line gets
  // the schema defaults (seat_number=null, course_name="main").
  const buildSeatCourseOverlay = useCallback(() => {
    if (!orderContext) return undefined;
    return {
      seat_number: activeSeat ?? null,
      course_name: `course_${activeCourse || 1}`,
    };
  }, [orderContext, activeSeat, activeCourse]);

  const addToCartWithModifiers = useCallback(async (product) => {
    if (!product || !product.id) return;
    const overlay = buildSeatCourseOverlay();
    // Skip tree lookup for bundles, weighted, or non-restaurant tenants.
    if (product.is_bundle) {
      cartHook.addToCart(product, overlay);
      return;
    }
    try {
      const res = await api.get(`/api/products/${product.id}/modifier-tree`);
      const groups = Array.isArray(res?.groups) ? res.groups : [];
      if (!groups.length) {
        cartHook.addToCart(product, overlay);
        return;
      }
      setModifierModalState({ product, groups });
    } catch {
      // 404 / feature-flag off / network — fall back to plain add so POS never breaks.
      cartHook.addToCart(product, overlay);
    }
  }, [cartHook, buildSeatCourseOverlay]);

  const confirmModifiers = useCallback((modifiers, priceDelta) => {
    const state = modifierModalState;
    if (!state) return;
    const base = state.product;
    const adjusted = {
      ...base,
      price: Number(base.price) + Number(priceDelta || 0),
      originalPrice: Number(base.price),
      modifiers,
      modifier_price_delta: Number(priceDelta || 0),
    };
    cartHook.addToCart(adjusted, buildSeatCourseOverlay());
    setModifierModalState(null);
  }, [modifierModalState, cartHook, buildSeatCourseOverlay]);

  const cancelModifiers = useCallback(() => setModifierModalState(null), []);

  // ── Employees (server picker for restaurant tips, Phase 2.1 C1 wiring) ────
  const [employeesList, setEmployeesList] = useState([]);
  useEffect(() => {
    api.get("/api/employees")
      .then((d) => setEmployeesList(Array.isArray(d) ? d : (d?.employees || [])))
      .catch(() => setEmployeesList([]));
  }, []);

  const receipt = useReceipt({ selectedOutletId: shift.selectedOutletId });

  useCustomerDisplay({
    cart: cartHook.cart,
    grossTotal: cartHook.grossTotal,
    taxTotal: cartHook.taxTotal,
    total: cartHook.total,
    activeShift: shift.activeShift,
  });

  const loyalty = useLoyaltyWallet({
    customers,
    checkoutCustomerId,
    total: cartHook.total,
  });

  const folio = useFolioCharging({
    selectedOutletId: shift.selectedOutletId,
    checkoutOpen,
    checkoutCustomerId,
  });

  const offlineQueue = useOfflineQueue({ showNotice });

  // parked-sales loader — needed by useCheckout
  const loadParked = useCallback(async (outletId = shift.selectedOutletId) => {
    try {
      const query = outletId ? { outlet_id: outletId } : undefined;
      const data = await api.get("/api/parked-sales", query);
      setParkedSales(data.parkedSales || []);
    } catch {
      setParkedSales([]);
    }
  }, [shift.selectedOutletId]);

  const checkout = useCheckout({
    selectedOutletId: shift.selectedOutletId,
    activeShift: shift.activeShift,
    attendanceCode: shift.attendanceCode,
    cart: cartHook.cart, setCart: cartHook.setCart,
    total: cartHook.total,
    grossTotal: cartHook.grossTotal,
    taxTotal: cartHook.taxTotal,
    taxInclusive: cartHook.taxInclusive,
    discountType: cartHook.discountType,
    discountInput: cartHook.discountInput, setDiscountInput: cartHook.setDiscountInput,
    discountValue: cartHook.discountValue,
    orderNote: cartHook.orderNote, setOrderNote: cartHook.setOrderNote,
    promoDiscount: cartHook.promoDiscount,
    customers, setCustomers,
    selectedCustomerId, setSelectedCustomerId,
    outlets: shift.outlets,
    checkoutOpen, setCheckoutOpen,
    checkoutCustomerId, setCheckoutCustomerId,
    chargeToRoomFolioId: folio.chargeToRoomFolioId,
    setChargeToRoomFolioId: folio.setChargeToRoomFolioId,
    chargeToTreatmentFolioId: folio.chargeToTreatmentFolioId,
    redeemPointsOn: loyalty.redeemPointsOn,
    setRedeemPointsOn: loyalty.setRedeemPointsOn,
    setPayWithWalletOn: loyalty.setPayWithWalletOn,
    pointsEarned: loyalty.pointsEarned,
    pointsRedeemed: loyalty.pointsRedeemed,
    pointsDiscount: loyalty.pointsDiscount,
    setSlip: receipt.setSlip, setSlipOpen: receipt.setSlipOpen,
    enqueueSale: offlineQueue.enqueueSale,
    loadParked,
    setError,
    showNotice,
  });

  // ── Reload parked on outlet change ──────────────────────────────────────
  useEffect(() => {
    if (shift.selectedOutletId) {
      loadParked(shift.selectedOutletId);
    } else {
      setParkedSales([]);
    }
  }, [shift.selectedOutletId]);

  // ── Park / restore sale ─────────────────────────────────────────────────
  const parkSale = useCallback(async () => {
    if (!cartHook.cart.length || !shift.selectedOutletId) return;
    const itemPayload = cartHook.cart.map((i) => ({
      product_id: i.id,
      variant_id: i.variant_id || null,
      product_name: i.name,
      quantity: i.quantity,
      price: i.price,
      effective_tax_rate: i.effectiveTaxRate || 0,
    }));
    try {
      if (posFlags.phase2_draft_orders) {
        await api.post("/api/draft-orders", {
          outlet_id: Number(shift.selectedOutletId),
          customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
          notes: cartHook.orderNote || null,
          items: itemPayload,
        });
      } else {
        await api.post("/api/parked-sales", {
          employee_id: employee?.id || null,
          outlet_id: Number(shift.selectedOutletId),
          customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
          notes: cartHook.orderNote || null,
          items: itemPayload,
        });
      }
      cartHook.setCart([]);
      cartHook.setDiscountInput("");
      cartHook.setOrderNote("");
      setSelectedCustomerId("");
      await loadParked(shift.selectedOutletId);
      showNotice("Sale parked successfully.");
    } catch (e) {
      setError(e.message || "Failed to park sale");
    }
  }, [cartHook, shift.selectedOutletId, posFlags, selectedCustomerId, employee?.id, loadParked, showNotice]);

  const restoreParked = useCallback(async (row) => {
    try {
      const data = await api.get(`/api/parked-sales/${row.id}`);
      cartHook.setCart(
        (data.items || []).map((i) => ({
          id: i.product_id,
          variant_id: i.variant_id || null,
          name: i.product_name,
          quantity: Number(i.quantity),
          price: Number(i.price),
          availableStock: 99999,
        })),
      );
      cartHook.setOrderNote(data.parkedSale?.notes || "");
      if (data.parkedSale?.customer_id)
        setSelectedCustomerId(String(data.parkedSale.customer_id));
      await api.del(`/api/parked-sales/${row.id}`);
      await loadParked(shift.selectedOutletId);
      setShowParked(false);
      showNotice("Parked sale restored.");
    } catch (e) {
      if (e.message?.includes("Parked sale not found")) {
        await loadParked(shift.selectedOutletId);
        showNotice("That parked sale was already restored on another terminal.");
        return;
      }
      setError(e.message || "Failed to restore parked sale");
    }
  }, [cartHook, shift.selectedOutletId, loadParked, showNotice]);

  // ── Return-from-sale ────────────────────────────────────────────────────
  const openReturnFromSale = useCallback((sale) => {
    setReturnSourceSale(sale);
    setReturnModalOpen(true);
    receipt.setRecentSalesOpen(false);
  }, [receipt]);

  // ── Lock / unlock ───────────────────────────────────────────────────────
  const handleLock = useCallback(() => {
    sessionStorage.setItem("posLocked", "1");
    setIsLocked(true);
    setLockPin("");
    setLockError("");
  }, []);

  const handleUnlock = useCallback(async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!lockPin) return;
    try {
      const data = await api.post("/api/employees/validate-pin", { pin_code: lockPin });
      if (!data.employee) {
        setLockError("Invalid PIN");
        setLockPin("");
        return;
      }
      if (employee?.id && data.employee.id !== employee.id) {
        setLockError("PIN does not match the logged-in user");
        setLockPin("");
        return;
      }
      sessionStorage.removeItem("posLocked");
      setIsLocked(false);
      setLockPin("");
      setLockError("");
    } catch {
      setLockError("Failed to connect to server");
    }
  }, [lockPin, employee?.id]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/login", { replace: true });
  }, [logout, navigate]);

  // ── Customer filtering ──────────────────────────────────────────────────
  const effectiveCustomerId = checkoutOpen ? checkoutCustomerId : selectedCustomerId;
  const selectedCustomer = useMemo(
    () =>
      customers.find((c) => String(c.id) === String(effectiveCustomerId)) || null,
    [customers, effectiveCustomerId],
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 15);
    return customers
      .filter((c) =>
        String(c.name || "").toLowerCase().includes(q) ||
        String(c.mobile || "").includes(q),
      )
      .slice(0, 15);
  }, [customers, customerSearch]);

  const filteredCheckoutCustomers = useMemo(() => {
    const q = checkout.checkoutCustSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 15);
    return customers
      .filter((c) =>
        String(c.name || "").toLowerCase().includes(q) ||
        String(c.mobile || "").includes(q),
      )
      .slice(0, 15);
  }, [customers, checkout.checkoutCustSearch]);

  // ── Barcode scanner + F-key shortcuts (uses ref indirection) ────────────
  const parkSaleRef = useRef(parkSale);
  const openCheckoutRef = useRef(checkout.openCheckout);
  const removeFromCartRef = useRef(cartHook.removeFromCart);
  useEffect(() => { parkSaleRef.current = parkSale; }, [parkSale]);
  useEffect(() => { openCheckoutRef.current = checkout.openCheckout; }, [checkout.openCheckout]);
  useEffect(() => { removeFromCartRef.current = cartHook.removeFromCart; }, [cartHook.removeFromCart]);

  const barcodeBuffer = useRef("");
  const barcodeTimer = useRef(null);

  const handleBarcodeScanned = useCallback(async (barcode) => {
    try {
      const res = await api.raw(`/api/products/scan/${encodeURIComponent(barcode)}`, {
        headers: { "x-employee-id": String(employee?.id || "") },
      });
      if (!res.ok) return;
      const data = await res.json();
      const product = data.product;
      if (product) addToCartWithModifiers(product);
    } catch (err) {
      console.error("Barcode lookup failed:", err);
    }
  }, [employee?.id, addToCartWithModifiers]);

  useEffect(() => {
    function handleKeyDown(e) {
      const fkeys = {
        F1: () => { e.preventDefault(); setShowShortcutsOverlay((v) => !v); },
        F2: () => { e.preventDefault(); if (cartHook.cart.length) cartHook.setShowDiscountModal(true); },
        F3: () => { e.preventDefault(); if (cartHook.cart.length) parkSaleRef.current?.(); },
        F4: () => { e.preventDefault(); const el = document.querySelector('[data-pos-customer-search]'); if (el) el.focus(); },
        F5: () => { e.preventDefault(); setShowParked(true); },
        F8: () => { e.preventDefault(); if (cartHook.cart.length) removeFromCartRef.current?.(cartHook.cart[cartHook.cart.length - 1].id); },
        F9: () => { e.preventDefault(); if (cartHook.cart.length) openCheckoutRef.current?.(); },
        F10: () => { e.preventDefault(); if (cartHook.cart.length && window.confirm("Clear entire cart?")) cartHook.setCart([]); },
        Escape: () => { cartHook.setShowDiscountModal(false); setShowParked(false); setShowShortcutsOverlay(false); },
      };

      if (fkeys[e.key]) { fkeys[e.key](); return; }

      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        barcodeBuffer.current = "";
        clearTimeout(barcodeTimer.current);
        if (code.length >= 3) handleBarcodeScanned(code);
        return;
      }

      if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = ""; }, 100);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleBarcodeScanned, cartHook.cart, cartHook.setCart, cartHook.setShowDiscountModal]);

  const value = {
    employee,
    authHeaders,
    logout,
    handleLogout,
    isLocked,
    setIsLocked,
    lockPin,
    setLockPin,
    lockError,
    setLockError,
    outlets: shift.outlets,
    customers,
    selectedOutletId: shift.selectedOutletId,
    setSelectedOutletId: shift.setSelectedOutletId,
    activeShift: shift.activeShift,
    attendanceStatus: shift.attendanceStatus,
    attendanceCode: shift.attendanceCode,
    gateLoading: shift.gateLoading,
    canOpenShift: shift.canOpenShift,
    canSwitchOutlet: shift.canSwitchOutlet,
    isReadyForCheckout: shift.isReadyForCheckout,
    openingDenoms: shift.openingDenoms,
    setOpeningDenoms: shift.setOpeningDenoms,
    openingFloat: shift.openingFloat,
    openingShiftBusy: shift.openingShiftBusy,
    openShiftFromPOS: shift.openShiftFromPOS,
    closeShiftOpen: shift.closeShiftOpen,
    setCloseShiftOpen: shift.setCloseShiftOpen,
    refreshGateStatus: shift.refreshGateStatus,
    search: cartHook.search,
    setSearch: cartHook.setSearch,
    barcodeSearch: cartHook.barcodeSearch,
    setBarcodeSearch: cartHook.setBarcodeSearch,
    skuSearch: cartHook.skuSearch,
    setSkuSearch: cartHook.setSkuSearch,
    priceSearch: cartHook.priceSearch,
    setPriceSearch: cartHook.setPriceSearch,
    results: cartHook.results,
    setResults: cartHook.setResults,
    showResults: cartHook.showResults,
    setShowResults: cartHook.setShowResults,
    searchRef: cartHook.searchRef,
    cart: cartHook.cart,
    setCart: cartHook.setCart,
    taxInclusive: cartHook.taxInclusive,
    setTaxInclusive: cartHook.setTaxInclusive,
    discountType: cartHook.discountType,
    setDiscountType: cartHook.setDiscountType,
    discountInput: cartHook.discountInput,
    setDiscountInput: cartHook.setDiscountInput,
    orderNote: cartHook.orderNote,
    setOrderNote: cartHook.setOrderNote,
    showDiscountModal: cartHook.showDiscountModal,
    setShowDiscountModal: cartHook.setShowDiscountModal,
    showNoteModal: cartHook.showNoteModal,
    setShowNoteModal: cartHook.setShowNoteModal,
    selectedCustomerId,
    setSelectedCustomerId,
    customerSearch,
    setCustomerSearch,
    showCustomerDD,
    setShowCustomerDD,
    parkedSales,
    setParkedSales,
    showParked,
    setShowParked,
    checkoutOpen,
    setCheckoutOpen,
    payments: checkout.payments,
    setPayments: checkout.setPayments,
    paymentMethod: checkout.paymentMethod,
    setPaymentMethod: checkout.setPaymentMethod,
    paymentAmount: checkout.paymentAmount,
    setPaymentAmount: checkout.setPaymentAmount,
    checkoutCustomerId,
    setCheckoutCustomerId,
    checkoutCustSearch: checkout.checkoutCustSearch,
    setCheckoutCustSearch: checkout.setCheckoutCustSearch,
    showCheckoutCustDD: checkout.showCheckoutCustDD,
    setShowCheckoutCustDD: checkout.setShowCheckoutCustDD,
    submitting: checkout.submitting,
    setSubmitting: checkout.setSubmitting,
    payAmountRef: checkout.payAmountRef,
    custMode: checkout.custMode,
    setCustMode: checkout.setCustMode,
    newCustName: checkout.newCustName,
    setNewCustName: checkout.setNewCustName,
    newCustMobile: checkout.newCustMobile,
    setNewCustMobile: checkout.setNewCustMobile,
    newCustSaving: checkout.newCustSaving,
    setNewCustSaving: checkout.setNewCustSaving,
    newCustError: checkout.newCustError,
    setNewCustError: checkout.setNewCustError,
    // Phase 2.1 C1 — tip + server state for restaurant flow
    tipAmount: checkout.tipAmount,
    setTipAmount: checkout.setTipAmount,
    tipMethod: checkout.tipMethod,
    setTipMethod: checkout.setTipMethod,
    serverId: checkout.serverId,
    setServerId: checkout.setServerId,
    slip: receipt.slip,
    setSlip: receipt.setSlip,
    slipOpen: receipt.slipOpen,
    setSlipOpen: receipt.setSlipOpen,
    receiptTemplate: receipt.receiptTemplate,
    notice,
    setNotice,
    error,
    setError,
    success,
    setSuccess,
    money,
    currencyDenominations,
    currencySymbol,
    presetLabels,
    showNotice,
    loadParked,
    triggerSearch: cartHook.triggerSearch,
    handleSearchChange: cartHook.handleSearchChange,
    addToCart: addToCartWithModifiers,
    modifierModalState,
    confirmModifiers,
    cancelModifiers,
    employeesList,
    updateQty: cartHook.updateQty,
    setQty: cartHook.setQty,
    removeFromCart: cartHook.removeFromCart,
    grossTotal: cartHook.grossTotal,
    discountValue: cartHook.discountValue,
    taxTotal: cartHook.taxTotal,
    total: cartHook.total,
    totalPaid: checkout.totalPaid,
    remaining: checkout.remaining,
    change: checkout.change,
    selectedCustomer,
    filteredCustomers,
    filteredCheckoutCustomers,
    parkSale,
    posFlags,
    restoreParked,
    openCheckout: checkout.openCheckout,
    handleQuickCreateCustomer: checkout.handleQuickCreateCustomer,
    addPayment: checkout.addPayment,
    printSlip: receipt.printSlip,
    completeSale: checkout.completeSale,
    // M9 charge-to-room
    chargeToRoomFolioId: folio.chargeToRoomFolioId,
    setChargeToRoomFolioId: folio.setChargeToRoomFolioId,
    openBookings: folio.openBookings,
    openBookingsLoading: folio.openBookingsLoading,
    // M10 charge-to-plan
    chargeToTreatmentFolioId: folio.chargeToTreatmentFolioId,
    setChargeToTreatmentFolioId: folio.setChargeToTreatmentFolioId,
    openTreatmentPlans: folio.openTreatmentPlans,
    setOpenTreatmentPlans: folio.setOpenTreatmentPlans,
    handleLock,
    handleUnlock,
    recentSalesOpen: receipt.recentSalesOpen,
    setRecentSalesOpen: receipt.setRecentSalesOpen,
    recentSales: receipt.recentSales,
    recentSalesLoading: receipt.recentSalesLoading,
    recentSalesSearch: receipt.recentSalesSearch,
    setRecentSalesSearch: receipt.setRecentSalesSearch,
    loadRecentSales: receipt.loadRecentSales,
    returnModalOpen,
    setReturnModalOpen,
    returnSourceSale,
    setReturnSourceSale,
    openReturnFromSale,
    // Loyalty & wallet
    checkoutWalletBalance: loyalty.checkoutWalletBalance,
    checkoutWalletLoading: loyalty.checkoutWalletLoading,
    redeemPointsOn: loyalty.redeemPointsOn,
    setRedeemPointsOn: loyalty.setRedeemPointsOn,
    payWithWalletOn: loyalty.payWithWalletOn,
    setPayWithWalletOn: loyalty.setPayWithWalletOn,
    checkoutCustomerPoints: loyalty.checkoutCustomerPoints,
    checkoutCustomerTier: loyalty.checkoutCustomerTier,
    pointsEarned: loyalty.pointsEarned,
    pointsDiscount: loyalty.pointsDiscount,
    pointsRedeemed: loyalty.pointsRedeemed,
    LOYALTY_EARN_RATE: loyalty.LOYALTY_EARN_RATE,
    LOYALTY_REDEEM_RATE: loyalty.LOYALTY_REDEEM_RATE,
    sessionExpired: checkout.sessionExpired,
    setSessionExpired: checkout.setSessionExpired,
    retryPendingSale: checkout.retryPendingSale,
    // Offline queue
    offlineQueueCount: offlineQueue.offlineQueueCount,
    offlineSyncing: offlineQueue.offlineSyncing,
    offlineSyncResult: offlineQueue.offlineSyncResult,
    syncQueue: offlineQueue.syncQueue,
    showShortcutsOverlay,
    setShowShortcutsOverlay,
    // Endless aisle
    endlessAisleProduct,
    handleEndlessAisle,
    closeEndlessAisle,
    // Price lists
    priceListItems: cartHook.priceListItems,
    // POS layout + suggestions (Phase 2B)
    posLayout: cartHook.posLayout,
    suggestions: cartHook.suggestions,
    // Auto-apply promotions (Phase 2)
    appliedPromotions: cartHook.appliedPromotions,
    promoDiscount: cartHook.promoDiscount,
    // Restaurant shell state (Phase 2-R.0) — additive; null/0/1 defaults for retail
    draftOrderId,
    orderContext,
    tableSessionId,
    seatCount,
    activeSeat,
    setActiveSeat,
    activeCourse,
    setActiveCourse,
    openCheck,
    closeCheck,
    ensureDraftOrder,
  };

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
};
