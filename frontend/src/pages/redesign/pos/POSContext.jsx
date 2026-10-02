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
import { logErrorState } from "../../../utils/errorLog";
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
import { useOfflineCatalogue } from "./hooks/useOfflineCatalogue";
import { scanProduct, serverReachable, isUnreachableError } from "./offlineLookup";
import { saveLastKnown, readLastKnown, isUnreachable } from "../../../utils/lastKnown";
import { useCheckout } from "./hooks/useCheckout";
import { useStaffPurchase } from "./hooks/useStaffPurchase";
import { variantCartLine } from "./variantCartLine";
import { needsModifierLookup } from "./modifierLookup";

/* ──────────────────────────────────────────────────────────────────────────────
 * WAVE-C SNAPSHOT — usePOS() value object keys (pre-split, for diff verification)
 * Every key below must remain in the orchestrator's `value` object after the split.
 *
 * employee, authHeaders, logout, navigate, handleLogout, isLocked, setIsLocked, lockPin,
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
 * loyaltyEnabled, checkoutWalletBalance, checkoutWalletLoading, redeemPointsOn, setRedeemPointsOn,
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
  const { employee, authHeaders, logout, hasPerm, company } = useAuth();
  // P8 (3.14): tenant-wide tax stance — drives toggle default + visibility.
  const taxMode = company?.tax_mode || "none";
  const { fmt: money, denominations: currencyDenominations, symbol: currencySymbol } = useCurrency();
  const { labels: presetLabels, pos_layout_mode, industry_type } = usePreset();

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
      saveLastKnown("pos_flags", map);
    }).catch((err) => {
      // Offline reload: the flags last seen online (they switch on POS
      // features such as the scan box) — One Toy Store blocker 3h.
      const saved = isUnreachable(err) ? readLastKnown("pos_flags") : null;
      if (saved) setPosFlags(saved.value);
    });
  }, []);

  // ── Price override (Phase 2-G Wave 3 — 2-G.5) ────────────────────────────
  // Holds the cart line id that the cashier opened the override modal for.
  // null = modal closed. Actual override metadata is stamped onto the cart
  // item via applyPriceOverride (defined further down, once cartHook exists).
  const [priceOverrideLineId, setPriceOverrideLineId] = useState(null);

  // ── Loyalty config (Phase 2-G Wave 2 — 2-G.3) ──────────────────────────
  // Replaces the hardcoded 1pt/PKR-100 earn and PKR-10/100pts redeem
  // rates with tenant-configured values. Falls back to the defaults if
  // the endpoint errors or the tenant DB predates v63.
  const [loyaltyConfig, setLoyaltyConfig] = useState(null);
  useEffect(() => {
    api.get("/api/loyalty/config")
      .then((d) => setLoyaltyConfig({
        earn_rate: Number(d.earn_rate ?? 1),
        redeem_rate: Number(d.redeem_rate ?? 10),
      }))
      .catch(() => setLoyaltyConfig(null));
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

  // ── F06 appointments checkout link ──────────────────────────────────────
  // activeAppointment ties the in-progress cart to the appointment it was
  // prefilled from; completeSale sends appointment_id and the backend marks
  // the appointment completed with the sale backlink.
  const [showAppointments, setShowAppointments] = useState(false);
  const [activeAppointment, setActiveAppointment] = useState(null);
  const clearActiveAppointment = useCallback(() => setActiveAppointment(null), []);

  // ── Endless aisle ────────────────────────────────────────────────────────
  const [endlessAisleProduct, setEndlessAisleProduct] = useState(null);
  const handleEndlessAisle = useCallback((product) => setEndlessAisleProduct(product), []);
  const closeEndlessAisle = useCallback(() => setEndlessAisleProduct(null), []);

  // ── 2-G.0 omni-input pending interlocks (consumed by 2-G.1 variant modal
  //    and 2-G.6 serial modal in later waves; no reader exists today). ──────
  const [pendingVariantProductId, setPendingVariantProductId] = useState(null);
  // pendingSerial carries either a plain product id (legacy shape) or an
  // object { product_id, variant_id?, quantity?, cartLine? } so the serial
  // modal can render N slots and know what cart line to commit on success.
  // Keep pendingSerialProductId exported for the existing 2-G.0 contract.
  const [pendingSerialProductId, setPendingSerialProductId] = useState(null);
  const [pendingSerialContext, setPendingSerialContext] = useState(null);

  // ── Return / Exchange Modal ──────────────────────────────────────────────
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnSourceSale, setReturnSourceSale] = useState(null);
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);

  // ── 2-G.9 Holds modals ──────────────────────────────────────────────────
  const [holdCreateOpen, setHoldCreateOpen] = useState(false);
  const [holdPickupOpen, setHoldPickupOpen] = useState(false);

  // ── Checkout state lifted here so folio + loyalty can depend on it ──────
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutCustomerId, setCheckoutCustomerId] = useState("");

  // ── 2-G.15 Day 2 — stale-shift recovery ─────────────────────────────────
  // Shown when an active shift was opened > 20h ago AND current local time
  // is before noon. Dismissed for the rest of the session via state.
  const [shiftRecoveryOpen, setShiftRecoveryOpen] = useState(false);
  const [shiftRecoveryDismissed, setShiftRecoveryDismissed] = useState(false);

  // ── 2-G.15 Day 3 — refund collision + cart resume ───────────────────────
  // Collision modal is opened by POSReturnExchangeModal when /api/returns
  // returns 409 { code: "duplicate_return" }. Payload carries the existing
  // return reference so the cashier can see who/when/how-much.
  const [collisionModal, setCollisionModal] = useState(null); // { existing: {...} } | null
  // Cart resume modal shows when a sessionStorage checkpoint is loaded and
  // cart is empty. Checkpoint key is scoped per employee so a second cashier
  // logging in on the same terminal never sees the first cashier's cart.
  const [cartResumePrompt, setCartResumePrompt] = useState(null); // { cart, selectedOutletId, customer, timestamp } | null

  // ── 2-G.15 Day 4 — barcode miss + insufficient stock ─────────────────────
  // Barcode miss prompt: shown only when the cashier has inventory perms so
  // they can quick-create the product right from POS. Everyone else just
  // gets a toast (see handleBarcodeScanned below).
  const [barcodeMissPrompt, setBarcodeMissPrompt] = useState(null); // { barcode } | null
  // Insufficient-stock prompt: opened by checkout hook when the sale POST
  // returns { code: "insufficient_stock", available, product_id }.
  const [insufficientStockPrompt, setInsufficientStockPrompt] = useState(null); // { product_id, product_name, requested, available } | null
  // Tier 0.1 wholesale — Credit-limit-exceeded prompt. Opened by checkout
  // hook when /api/sales returns 403 CREDIT_LIMIT_EXCEEDED. Carries the
  // limit/outstanding/attempted/deficit so the modal can show context, and
  // the salePayload is parked inside useCheckout's pendingSaleRef.
  const [creditLimitPrompt, setCreditLimitPrompt] = useState(null); // { limit, outstanding, attempted, deficit, message } | null

  // ── Compose hooks (bottom-up) ────────────────────────────────────────────
  const shift = useShiftGate({ setError, showNotice });

  // 2-G.15 Day 2 — stale-shift detection. Fires when the gate finishes
  // loading and we land on an active shift opened long enough ago that
  // the cashier probably forgot to close it yesterday.
  // Bucket F: before-noon filter removed — overnight/extended shifts that
  // cross into the afternoon without a proper close are also stale. The
  // 20h threshold is still the load-bearing guard against noise.
  useEffect(() => {
    if (shiftRecoveryDismissed) return;
    if (!shift.activeShift?.opened_at) return;
    const now = new Date();
    const opened = new Date(shift.activeShift.opened_at);
    const ageHours = (now.getTime() - opened.getTime()) / 3_600_000;
    if (ageHours > 20) {
      setShiftRecoveryOpen(true);
    }
  }, [shift.activeShift?.opened_at, shiftRecoveryDismissed]);

  // 2-G.13: per-device POS identity. A stable browser UUID is generated
  // once, registered with the backend to obtain a surrogate integer id,
  // and both are cached in localStorage. The integer id is what
  // pos_layouts scope_id references for scope_type='device'.
  const [posDeviceId, setPosDeviceId] = useState(null);
  useEffect(() => {
    // /api/pos-devices/register is gated by phase2_pos_layouts on the
    // backend (returns 503 when off). Skip the round-trip when the flag is
    // off so fresh tenants don't log phantom Sentry/console errors.
    // Effect re-fires once posFlags loads (initial value is {}).
    if (!shift.selectedOutletId || !posFlags.phase2_pos_layouts) return;
    let uuid;
    try {
      uuid = localStorage.getItem("pos_device_uuid");
      if (!uuid) {
        uuid = (crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        localStorage.setItem("pos_device_uuid", uuid);
      }
    } catch { return; }
    // Register (idempotent) — picks up outlet + bumps last_seen. Silent fail
    // kept as defense-in-depth in case the flag flips while POS is open.
    api.post("/api/pos-devices/register", {
      device_uuid: uuid,
      outlet_id: shift.selectedOutletId,
    }).then((r) => {
      if (r?.device?.id) {
        setPosDeviceId(r.device.id);
        try { localStorage.setItem("pos_device_id", String(r.device.id)); } catch { /* noop */ }
      }
    }).catch(() => { /* flag off or unreachable — cascade falls back to outlet/global */ });
  }, [shift.selectedOutletId, posFlags.phase2_pos_layouts]);

  const cartHook = useCart({
    selectedOutletId: shift.selectedOutletId,
    selectedCustomerId,
    customers,
    posFlags,
    showNotice,
    posDeviceId,
    taxMode,
  });

  // One Toy Store F3b part 2 — Staff button: the bill is sold to a staff
  // member at cost. While on, the server's quote sets the discount and the
  // total (the manual discount, customer and promotions don't apply).
  const staffBuy = useStaffPurchase({ cart: cartHook.cart });
  const staffOn = !!staffBuy.staff;
  const effectiveTotal = staffOn
    ? (staffBuy.quote ? staffBuy.quote.total : cartHook.grossTotal)
    : cartHook.total;
  const effectiveDiscount = staffOn ? (staffBuy.quote?.staff_discount || 0) : cartHook.discountValue;

  // ── 2-G.15 Day 3 — cart resume checkpoint ───────────────────────────────
  // On mount (or employee change), if a recent checkpoint exists for this
  // employee AND the cart is currently empty, offer to restore it. Key is
  // scoped per employee so a second cashier on the same terminal doesn't
  // inherit the previous cashier's cart. 8h TTL as a secondary guard.
  const cartCheckpointKey = employee?.id ? `pos_cart_checkpoint_${employee.id}` : null;
  const cartCheckpointPromptedRef = useRef(false);

  useEffect(() => {
    if (!cartCheckpointKey) return;
    if (cartCheckpointPromptedRef.current) return;
    if (cartHook.cart.length > 0) return;
    // Only on arrival. Without this the check re-ran every time the cart went
    // back to empty — including right after a completed sale, when this effect
    // runs before the writer below deletes the checkpoint — and offered to
    // "resume" the cart that had just been paid for (a double-sale trap).
    cartCheckpointPromptedRef.current = true;
    try {
      const raw = sessionStorage.getItem(cartCheckpointKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const age = Date.now() - Number(parsed?.timestamp || 0);
      if (!(age >= 0 && age <= 8 * 3_600_000)) {
        sessionStorage.removeItem(cartCheckpointKey);
        return;
      }
      if (!Array.isArray(parsed.cart) || parsed.cart.length === 0) return;
      setCartResumePrompt(parsed);
      cartCheckpointPromptedRef.current = true;
    } catch {
      /* bad JSON — drop the key and move on */
      try { sessionStorage.removeItem(cartCheckpointKey); } catch { /* noop */ }
    }
  }, [cartCheckpointKey, cartHook.cart.length]);

  // Debounced checkpoint write — fires 1s after the last cart/customer/outlet
  // change while the cart is non-empty. When the cart drops back to empty
  // (completed sale or explicit clear), wipe the checkpoint so we don't
  // re-prompt on the next navigation.
  useEffect(() => {
    if (!cartCheckpointKey) return;
    if (cartHook.cart.length === 0) {
      try { sessionStorage.removeItem(cartCheckpointKey); } catch { /* noop */ }
      return;
    }
    const t = setTimeout(() => {
      try {
        const payload = {
          cart: cartHook.cart,
          selectedOutletId: shift.selectedOutletId,
          customer: selectedCustomerId
            ? customers.find((c) => String(c.id) === String(selectedCustomerId)) || null
            : null,
          timestamp: Date.now(),
        };
        sessionStorage.setItem(cartCheckpointKey, JSON.stringify(payload));
      } catch { /* quota / serialization — best effort */ }
    }, 1000);
    return () => clearTimeout(t);
  }, [cartCheckpointKey, cartHook.cart, shift.selectedOutletId, selectedCustomerId, customers]);

  const resumeCartFromCheckpoint = useCallback(() => {
    if (!cartResumePrompt) return;
    try {
      cartHook.setCart(cartResumePrompt.cart);
      if (cartResumePrompt.selectedOutletId && !shift.selectedOutletId) {
        shift.setSelectedOutletId(cartResumePrompt.selectedOutletId);
      }
      if (cartResumePrompt.customer?.id) {
        setSelectedCustomerId(String(cartResumePrompt.customer.id));
      }
    } catch { /* noop */ }
    setCartResumePrompt(null);
  }, [cartResumePrompt, cartHook, shift, setSelectedCustomerId]);

  const discardCartCheckpoint = useCallback(() => {
    if (cartCheckpointKey) {
      try { sessionStorage.removeItem(cartCheckpointKey); } catch { /* noop */ }
    }
    setCartResumePrompt(null);
  }, [cartCheckpointKey]);

  // ── Price override apply (Phase 2-G Wave 3 — 2-G.5) ─────────────────────
  // Stamps the override metadata onto a cart line and swaps in the new price.
  // The backend validates approval_event_id on sale submission.
  const applyPriceOverride = useCallback(
    (lineId, { amount, reason_id, approval_event_id, original_price }) => {
      const newPrice = Number(amount);
      if (!Number.isFinite(newPrice) || newPrice < 0) return;
      cartHook.setCart((prev) =>
        prev.map((x) =>
          x.id === lineId
            ? {
                ...x,
                originalPrice: x.originalPrice ?? Number(original_price ?? x.price),
                price: newPrice,
                price_override: {
                  original_price: Number(original_price ?? x.originalPrice ?? x.price),
                  reason_id: reason_id ?? null,
                  approval_event_id: approval_event_id ?? null,
                },
              }
            : x,
        ),
      );
    },
    [cartHook],
  );

  // ── Restaurant shell state (Phase 2-R.0) ──────────────────────────────────
  // Additive — retail POS never sets these so all values stay at defaults.
  // openCheck/closeCheck flip them as the restaurant shell transitions
  // between floor and check views; ensureDraftOrder lazily creates the draft
  // backing the current check on first kitchen action.
  const [draftOrderId, setDraftOrderId] = useState(null);
  const [orderContext, setOrderContext] = useState(null);
  const [tableSessionId, setTableSessionId] = useState(null);
  const [tableLabel, setTableLabel] = useState(null);
  const [tabId, setTabId] = useState(null);
  const [tabName, setTabName] = useState(null);
  const [seatCount, setSeatCount] = useState(0);
  const [activeSeat, setActiveSeat] = useState(1);
  const [activeCourse, setActiveCourse] = useState(1);

  // Phase 2-R.0 Day 8 — Guest handoff overlay state (tip + signature + receipt).
  const [showGuestMode, setShowGuestMode] = useState(false);
  const [signatureSvg, setSignatureSvg] = useState(null);

  const openCheck = useCallback(({ context, tableSessionId: tsid = null, tableLabel: tlabel = null, tabId: tbid = null, tabName: tbname = null, draftOrderId: doid = null, seatCount: sc = 0 } = {}) => {
    setOrderContext(context || null);
    setTableSessionId(tsid);
    setTableLabel(tlabel);
    setTabId(tbid);
    setTabName(tbname);
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
    setTableLabel(null);
    setTabId(null);
    setTabName(null);
    setSeatCount(0);
    setActiveSeat(1);
    setActiveCourse(1);
  }, []);

  const ensureDraftOrder = useCallback(async () => {
    if (draftOrderId) return draftOrderId;
    const data = await api.post("/api/draft-orders", {
      order_context: orderContext,
      table_session_id: tableSessionId,
      tab_id: tabId,
      seat_count: seatCount,
    });
    const newId = data?.draftOrder?.id ?? data?.id ?? null;
    setDraftOrderId(newId);
    return newId;
  }, [draftOrderId, orderContext, tableSessionId, tabId, seatCount]);

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
    // W42: counter-service tenants (cafe / quick-service) inherit the
    // restaurant POS shell but never use seats or courses. Force the cart
    // line to fall through to schema defaults (seat_number=null,
    // course_name='main') so KDS routing, reports, and FBR exports treat
    // these as standard sales — and so the picker UI can stay hidden.
    if (pos_layout_mode === "counter") return undefined;
    return {
      seat_number: activeSeat ?? null,
      course_name: `course_${activeCourse || 1}`,
    };
  }, [orderContext, activeSeat, activeCourse, pos_layout_mode]);

  const addToCartWithModifiers = useCallback(async (product) => {
    if (!product || !product.id) return;
    const overlay = buildSeatCourseOverlay();
    // Skip tree lookup for bundles, shops without the restaurant feature (D62:
    // that was a refused server trip on every add) and items from the offline
    // catalogue copy (no server to ask).
    if (!needsModifierLookup(product, posFlags)) {
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
  }, [cartHook, buildSeatCourseOverlay, posFlags]);

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
    total: effectiveTotal,
    activeShift: shift.activeShift,
  });

  // Loyalty/wallet checkout surface is gated on phase2g_loyalty (Business
  // Modules): with the flag off the hook zeroes all derived values and never
  // fetches the wallet balance.
  const loyaltyEnabled = !!posFlags.phase2g_loyalty;
  const loyalty = useLoyaltyWallet({
    customers,
    checkoutCustomerId,
    total: effectiveTotal,
    loyaltyConfig,
    enabled: loyaltyEnabled,
  });

  const folio = useFolioCharging({
    selectedOutletId: shift.selectedOutletId,
    checkoutOpen,
    checkoutCustomerId,
  });

  const offlineQueue = useOfflineQueue({ showNotice });
  // The counter's offline copy of the catalogue (One Toy Store blocker 3a).
  const offlineCatalogue = useOfflineCatalogue();

  // parked-sales loader — needed by useCheckout
  // When phase2_draft_orders is on, parkSale writes to /api/draft-orders
  // instead of /api/parked-sales. The reader must mirror that. We also fetch
  // legacy /api/parked-sales rows so tenants who flipped the flag mid-life
  // don't lose access to anything they parked before the flip. Draft rows
  // are normalized (created_at -> parked_at, _source flag) so the existing
  // POSParkedModal render code keeps working without a shape branch.
  const loadParked = useCallback(async (outletId = shift.selectedOutletId) => {
    const query = outletId ? { outlet_id: outletId } : undefined;
    const draftsEnabled = !!posFlags.phase2_draft_orders;
    try {
      const requests = [
        api.get("/api/parked-sales", query).then(
          (d) => (d.parkedSales || []).map((r) => ({ ...r, _source: "parked" })),
          () => [],
        ),
      ];
      if (draftsEnabled) {
        const draftQuery = { ...(query || {}), status: "open,claimed" };
        requests.push(
          api.get("/api/draft-orders", draftQuery).then(
            (d) => (d.draftOrders || []).map((r) => ({
              ...r,
              parked_at: r.parked_at || r.created_at,
              _source: "draft",
            })),
            () => [],
          ),
        );
      }
      const lists = await Promise.all(requests);
      const merged = lists.flat().sort((a, b) => {
        const ta = new Date(a.parked_at || a.created_at || 0).getTime();
        const tb = new Date(b.parked_at || b.created_at || 0).getTime();
        return tb - ta;
      });
      setParkedSales(merged);
    } catch {
      setParkedSales([]);
    }
  }, [shift.selectedOutletId, posFlags.phase2_draft_orders]);

  const checkout = useCheckout({
    selectedOutletId: shift.selectedOutletId,
    activeShift: shift.activeShift,
    attendanceCode: shift.attendanceCode,
    cart: cartHook.cart, setCart: cartHook.setCart,
    total: effectiveTotal,
    grossTotal: cartHook.grossTotal,
    taxTotal: cartHook.taxTotal,
    taxInclusive: cartHook.taxInclusive,
    discountType: cartHook.discountType,
    discountInput: cartHook.discountInput, setDiscountInput: cartHook.setDiscountInput,
    discountValue: effectiveDiscount,
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
    // Bucket F: offline refund queue. Gated at the call site via the
    // `offline_returns` feature flag — hook exports the function either way.
    enqueueReturn: offlineQueue.enqueueReturn,
    loadParked,
    // F06 — appointment checkout link (id rides the sale payload; cleared
    // together with the cart after a completed sale).
    activeAppointmentId: activeAppointment?.id || null,
    clearActiveAppointment,
    // Phase 2-R.0 — restaurant shell context wired into completeSale payload
    draftOrderId,
    orderContext,
    tableSessionId,
    tableLabel,
    tabId,
    tabName,
    seatCount,
    closeCheck,
    signatureSvg,
    setSignatureSvg,
    setShowGuestMode,
    setError,
    showNotice,
    // 2-G.15 Day 4: hand insufficient_stock errors up to context so the
    // dedicated modal opens instead of just a toast.
    onInsufficientStock: (info) => {
      const line = cartHook.cart.find((i) => i.id === info.product_id);
      setInsufficientStockPrompt({
        product_id: info.product_id,
        variant_id: info.variant_id || null,
        product_name: line?.name || `Product ${info.product_id}`,
        available: info.available,
        requested: info.requested,
        // V02 wholesale backorders — offer "fulfill available + backorder
        // remainder" when the backend says the split is possible. The line's
        // current price becomes the ORDER-time snapshot.
        backorder_available: info.backorder_available === true,
        price: line ? Number(line.price) : null,
      });
      logErrorState("pos_insufficient_stock", `Insufficient stock for product ${info.product_id}`, info);
    },
    // Tier 0.1 wholesale — credit-limit modal trigger.
    onCreditLimitExceeded: (info) => {
      setCreditLimitPrompt(info);
      logErrorState("pos_credit_limit_exceeded", info.message || "Credit limit exceeded", info);
    },
    // V04 salon — drives the walk-in performed-by guard in completeSale.
    industryType: industry_type,
    staffPurchase: staffBuy.staff,
    staffQuote: staffBuy.quote,
    staffQuoteError: staffBuy.quoteError,
    clearStaffPurchase: staffBuy.clearStaff,
  });

  // Staff button: picking a person drops the manual discount and customer
  // (a staff bill has neither); the server's quote sets the price.
  const { setStaff: setStaffBuyer } = staffBuy;
  const { setDiscountInput: setCartDiscountInput } = cartHook;
  const startStaffPurchase = useCallback((person) => {
    setCartDiscountInput("");
    setSelectedCustomerId("");
    setStaffBuyer(person ? { id: person.id, name: person.name } : null);
  }, [setCartDiscountInput, setSelectedCustomerId, setStaffBuyer]);

  // ── Reload parked on outlet change ──────────────────────────────────────
  useEffect(() => {
    if (shift.selectedOutletId) {
      loadParked(shift.selectedOutletId);
    } else {
      setParkedSales([]);
    }
  }, [shift.selectedOutletId]);

  // ── Park / restore sale ─────────────────────────────────────────────────
  // Returns true when the cart is safely off the terminal (parked, or there
  // was nothing to park) and false when the park failed and the cart is still
  // live. Callers that navigate away on the strength of a park — the
  // session-expired modal — MUST check this; dropping the cart because a park
  // silently 401'd loses the sale. Fire-and-forget callers (F3, the subheader
  // button, the restaurant table switch) may ignore it: the error is still
  // surfaced through setError either way.
  const parkSale = useCallback(async () => {
    if (!cartHook.cart.length || !shift.selectedOutletId) return true;
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
      return true;
    } catch (e) {
      setError(e.message || "Failed to park sale");
      return false;
    }
  }, [cartHook, shift.selectedOutletId, posFlags, selectedCustomerId, employee?.id, loadParked, showNotice]);

  const restoreParked = useCallback(async (row) => {
    // Pick the matching endpoint based on where this row came from. The
    // _source tag is set by loadParked when it merges the two lists. Fall
    // back to draft when the flag is on and source is missing (e.g. row
    // came from a stale closure) so we don't 404 against the legacy table.
    const isDraft =
      row._source === "draft" ||
      (!row._source && !!posFlags.phase2_draft_orders);
    const detailUrl = isDraft
      ? `/api/draft-orders/${row.id}`
      : `/api/parked-sales/${row.id}`;
    try {
      const data = await api.get(detailUrl);
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
      const header = data.parkedSale || data.draftOrder || {};
      cartHook.setOrderNote(header.notes || "");
      if (header.customer_id)
        setSelectedCustomerId(String(header.customer_id));
      await api.del(detailUrl);
      await loadParked(shift.selectedOutletId);
      setShowParked(false);
      showNotice("Parked sale restored.");
    } catch (e) {
      if (
        e.message?.includes("Parked sale not found") ||
        e.message?.includes("Draft order not found")
      ) {
        await loadParked(shift.selectedOutletId);
        showNotice("That parked sale was already restored on another terminal.");
        return;
      }
      setError(e.message || "Failed to restore parked sale");
    }
  }, [cartHook, shift.selectedOutletId, loadParked, showNotice, posFlags.phase2_draft_orders]);

  // ── F06: prefill cart from a "today's appointments" row ────────────────
  const loadAppointmentToCart = useCallback((appt) => {
    // Multi-segment visit (color+cut): one line per segment, each with its
    // own provider so commissions attribute to the stylist who did the work.
    const segments = Array.isArray(appt.segments) && appt.segments.length ? appt.segments : null;
    if (segments) {
      const lines = segments.filter((s) => s.product_id).map((s) => ({
        id: s.product_id,
        variant_id: null,
        name: s.service_name || s.product_name,
        quantity: 1,
        price: Number(s.service_price ?? s.product_price ?? 0),
        originalPrice: Number(s.product_price ?? s.service_price ?? 0),
        effectiveTaxRate: s.product_tax_rate != null ? Number(s.product_tax_rate)
          : s.product_gst != null ? Number(s.product_gst) : 0,
        effectiveTaxName: s.product_tax_name || (s.product_gst != null ? "GST" : "No Tax"),
        availableStock: 99999,
        staff_id: s.employee_id || null,
      }));
      if (lines.length) cartHook.setCart((prev) => [...lines, ...prev]);
      if (lines.length < segments.length) {
        showNotice("Some services have no POS product linked — add those lines manually.");
      }
    } else if (appt.service_product_id) {
      const line = {
        id: appt.service_product_id,
        variant_id: null,
        name: appt.service_name || appt.product_name,
        quantity: 1,
        // Service price wins over the product's own price; cashier can still
        // override per the normal price-override flow.
        price: Number(appt.service_price ?? appt.product_price ?? 0),
        originalPrice: Number(appt.product_price ?? appt.service_price ?? 0),
        effectiveTaxRate: Number(appt.effective_tax_rate || 0),
        effectiveTaxName: appt.effective_tax_name || "No Tax",
        availableStock: 99999,
        // Provider gets the per-line commission attribution.
        staff_id: appt.employee_id || null,
      };
      cartHook.setCart((prev) => [line, ...prev]);
    } else {
      showNotice("No POS product linked to this service — add the lines manually.");
    }
    if (appt.customer_id) setSelectedCustomerId(String(appt.customer_id));
    setActiveAppointment({ id: appt.id, service_name: appt.service_name });
    setShowAppointments(false);
    showNotice(`Appointment #${appt.id} attached — checkout will complete it.`);
  }, [cartHook, showNotice]);

  // ── Return-from-sale ────────────────────────────────────────────────────
  const openReturnFromSale = useCallback((sale) => {
    setReturnSourceSale(sale);
    setReturnModalOpen(true);
    receipt.setRecentSalesOpen(false);
  }, [receipt]);

  // ── Lock / unlock ───────────────────────────────────────────────────────
  const handleLock = useCallback(async () => {
    // Unlocking checks the PIN on the server, so a screen locked during an
    // outage couldn't be unlocked until the internet came back. Owner decision
    // 2026-09-26: no locking while offline (blocker 3).
    if (!(await serverReachable())) {
      showNotice("Lock needs the internet");
      return;
    }
    sessionStorage.setItem("posLocked", "1");
    setIsLocked(true);
    setLockPin("");
    setLockError("");
  }, [showNotice]);

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
    } catch (err) {
      setLockPin("");
      setLockError(
        isUnreachableError(err)
          ? "You're offline. The PIN is checked online, so the screen unlocks when the internet is back."
          : "Failed to connect to server",
      );
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
      // Server first; the offline catalogue copy when it can't be reached (3a).
      const data = await scanProduct(barcode);
      if (!data.found) {
        if (data.offline) {
          // Offline: can't create a product, just say what happened.
          setError(data.error);
          return;
        }
        // 2-G.15 Day 4: 404 → offer quick-create when the cashier can manage
        // inventory; otherwise surface a visible toast instead of the old
        // silent-return that left cashiers thinking the scanner was broken.
        if (data.status === 404) {
          logErrorState("pos_barcode_miss", `Barcode ${barcode} not found`, { barcode });
          if (hasPerm && hasPerm("manage_inventory")) {
            setBarcodeMissPrompt({ barcode });
          } else {
            setError(`Barcode ${barcode} not found`);
          }
        }
        return;
      }
      const product = data.product;
      // The scanned code was one variant's own barcode — add exactly that variant.
      if (data.variant) {
        addToCartWithModifiers(variantCartLine(product, data.variant, data.variant.sku));
        return;
      }
      // 2-G.6: serialized products intercept the add-to-cart flow. The
      // serial modal collects one serial per unit and commits the line
      // itself (with `serials: [ids]` attached).
      if (product.serial_required) {
        setPendingSerialContext({
          product_id: product.id,
          variant_id: null,
          quantity: 1,
        });
        setPendingSerialProductId(product.id);
        return;
      }
      addToCartWithModifiers(product);
    } catch (err) {
      console.error("Barcode lookup failed:", err);
    }
  }, [addToCartWithModifiers, hasPerm, setError]);

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
    // Consumed by POSLockScreen ("Sign out completely") and
    // POSSessionExpiredModal (Cancel) — both call it after logout() so the
    // cleared session lets /login render instead of bouncing to
    // /context-select. Was omitted here for a long time; both call sites
    // destructured it and threw on undefined.
    navigate,
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
    // 2-G.15 Day 2 — stale shift recovery
    shiftRecoveryOpen,
    setShiftRecoveryOpen,
    setShiftRecoveryDismissed,
    // 2-G.15 Day 3 — refund collision + cart resume
    collisionModal,
    setCollisionModal,
    cartResumePrompt,
    resumeCartFromCheckpoint,
    discardCartCheckpoint,
    // 2-G.15 Day 4 — barcode miss + insufficient stock
    barcodeMissPrompt,
    setBarcodeMissPrompt,
    insufficientStockPrompt,
    setInsufficientStockPrompt,
    // V02 wholesale backorders — stage the accepted shortfall remainder
    stageBackorderItems: checkout.stageBackorderItems,
    // Tier 0.1 wholesale — credit-limit override flow
    creditLimitPrompt,
    setCreditLimitPrompt,
    retryWithManagerPin: checkout.retryWithManagerPin,
    cancelCreditOverride: checkout.cancelCreditOverride,
    creditWarning: checkout.creditWarning,
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
    // P8 (3.14): expose tenant tax_mode so POSSubHeader can hide the toggle
    // for unregistered tenants.
    taxMode,
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
    // F06 — appointments checkout entry point
    showAppointments,
    setShowAppointments,
    activeAppointment,
    clearActiveAppointment,
    loadAppointmentToCart,
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
    addDecodedLine: cartHook.addDecodedLine,
    confirmCopyLine: cartHook.confirmCopyLine,
    undoCopyLine: cartHook.undoCopyLine,
    modifierModalState,
    confirmModifiers,
    cancelModifiers,
    employeesList,
    industryType: industry_type,
    updateQty: cartHook.updateQty,
    setQty: cartHook.setQty,
    removeFromCart: cartHook.removeFromCart,
    grossTotal: cartHook.grossTotal,
    discountValue: effectiveDiscount,
    taxTotal: cartHook.taxTotal,
    total: effectiveTotal,
    totalPaid: checkout.totalPaid,
    remaining: checkout.remaining,
    // One Toy Store F3b part 2 — staff toy at cost.
    staffPurchase: staffBuy.staff,
    staffQuote: staffBuy.quote,
    staffQuoteError: staffBuy.quoteError,
    staffQuotePending: staffBuy.quotePending,
    staffList: staffBuy.staffList,
    staffListError: staffBuy.listError,
    loadStaffList: staffBuy.loadStaff,
    startStaffPurchase,
    clearStaffPurchase: staffBuy.clearStaff,
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
    printBrowserFallback: receipt.printBrowserFallback,
    receiptRetryPrompt: receipt.retryPrompt,
    dismissReceiptRetry: receipt.dismissRetryPrompt,
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
    // 2-G.9 Holds
    holdCreateOpen,
    setHoldCreateOpen,
    holdPickupOpen,
    setHoldPickupOpen,
    // Loyalty & wallet
    loyaltyEnabled,
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
    // Bucket F: type-split counts so POSRedesign banner can show e.g.
    // "3 sales + 1 refund queued offline".
    queuedSalesCount: offlineQueue.queuedSalesCount,
    queuedReturnsCount: offlineQueue.queuedReturnsCount,
    offlineSyncing: offlineQueue.offlineSyncing,
    offlineSyncResult: offlineQueue.offlineSyncResult,
    syncQueue: offlineQueue.syncQueue,
    syncReport: offlineQueue.syncReport,
    dismissSyncReport: offlineQueue.dismissSyncReport,
    offlineCatalogue,
    discountsOffline: cartHook.discountsOffline,
    showShortcutsOverlay,
    setShowShortcutsOverlay,
    // Endless aisle
    endlessAisleProduct,
    handleEndlessAisle,
    closeEndlessAisle,
    // 2-G.0 pending interlocks (consumed by 2-G.1 / 2-G.6 in later waves)
    pendingVariantProductId,
    setPendingVariantProductId,
    pendingSerialProductId,
    setPendingSerialProductId,
    // 2-G.6 — richer pending-serial payload (object form) so the serial
    // modal can present N slots and know what cart line to commit on success.
    pendingSerialContext,
    setPendingSerialContext,
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
    setTableSessionId,
    tableLabel,
    setTableLabel,
    tabId,
    setTabId,
    tabName,
    setTabName,
    seatCount,
    setSeatCount,
    activeSeat,
    setActiveSeat,
    activeCourse,
    setActiveCourse,
    openCheck,
    closeCheck,
    ensureDraftOrder,
    // Phase 2-R.0 Day 8 — guest handoff
    showGuestMode,
    setShowGuestMode,
    signatureSvg,
    setSignatureSvg,
    // Phase 2-G Wave 3 — 2-G.5 price override
    priceOverrideLineId,
    setPriceOverrideLineId,
    applyPriceOverride,
  };

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
};
