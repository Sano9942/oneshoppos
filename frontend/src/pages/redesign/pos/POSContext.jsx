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
import { readContext } from "../../../auth/authStore";
import { buildReceiptHtml, buildReceiptSections, printToHardware } from "../../../utils/receipt";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { getQueue, enqueue, dequeue, WARN_THRESHOLD } from "../../../utils/offlineQueue";
import { calcGrossTotal, calcDiscountValue, calcTaxTotal, calcTotal } from "./cartMath.js";

const POSContext = createContext();
const OPENING_DENOMS = [5000, 1000, 500, 100, 50, 20, 10];

export const usePOS = () => {
  const context = useContext(POSContext);
  if (!context) throw new Error("usePOS must be used within a POSProvider");
  return context;
};

export const POSProvider = ({ children }) => {
  const navigate = useNavigate();
  const { employee, authHeaders, logout, hasPerm } = useAuth();

  // ── Lock state ────────────────────────────────────────────────────────────
  const [isLocked, setIsLocked] = useState(
    () => sessionStorage.getItem("posLocked") === "1",
  );
  const [lockPin, setLockPin] = useState("");
  const [lockError, setLockError] = useState("");

  // ── Bootstrap data ────────────────────────────────────────────────────────
  const [outlets, setOutlets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [activeShift, setActiveShift] = useState(null);
  const [attendanceStatus, setAttendanceStatus] = useState(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [openingShiftBusy, setOpeningShiftBusy] = useState(false);
  const [openingDenoms, setOpeningDenoms] = useState(
    OPENING_DENOMS.map((value) => ({ denomination: value, count: 0 })),
  );
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);

  // ── Product search ────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const [priceSearch, setPriceSearch] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef(null);
  const searchTimer = useRef(null);

  // ── Cart ──────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState([]);
  const [taxInclusive, setTaxInclusive] = useState(false);

  // ── Order-level discount / note ───────────────────────────────────────────
  const [discountType, setDiscountType] = useState("percent");
  const [discountInput, setDiscountInput] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);

  // ── Customer (sidebar) ────────────────────────────────────────────────────
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDD, setShowCustomerDD] = useState(false);

  // ── Price list (customer-specific pricing + outlet assignments) ────────────
  const [priceListItems, setPriceListItems] = useState([]);
  const [outletPriceListItems, setOutletPriceListItems] = useState([]);

  // ── Parked sales ──────────────────────────────────────────────────────────
  const [parkedSales, setParkedSales] = useState([]);
  const [showParked, setShowParked] = useState(false);
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);

  // ── Checkout ──────────────────────────────────────────────────────────────
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payments, setPayments] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [checkoutCustomerId, setCheckoutCustomerId] = useState("");
  const [checkoutCustSearch, setCheckoutCustSearch] = useState("");
  const [showCheckoutCustDD, setShowCheckoutCustDD] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const payAmountRef = useRef(null);

  // ── Loyalty & Wallet (checkout) ───────────────────────────────────────────
  // TODO: make earn rate configurable from Company Settings
  const LOYALTY_EARN_RATE = 1; // 1 point per PKR 100 spent
  const LOYALTY_REDEEM_RATE = 10; // 100 points = PKR 10 discount
  const [checkoutWalletBalance, setCheckoutWalletBalance] = useState(0);
  const [checkoutWalletLoading, setCheckoutWalletLoading] = useState(false);
  const [redeemPointsOn, setRedeemPointsOn] = useState(false);
  const [payWithWalletOn, setPayWithWalletOn] = useState(false);

  // ── Quick-create customer inside checkout ─────────────────────────────────
  const [custMode, setCustMode] = useState("search");
  const [newCustName, setNewCustName] = useState("");
  const [newCustMobile, setNewCustMobile] = useState("");
  const [newCustSaving, setNewCustSaving] = useState(false);
  const [newCustError, setNewCustError] = useState("");

  // ── Receipt slip ──────────────────────────────────────────────────────────
  const [slip, setSlip] = useState(null);
  const [slipOpen, setSlipOpen] = useState(false);
  const [receiptTemplate, setReceiptTemplate] = useState(null);

  // ── Recent Sales Panel ────────────────────────────────────────────────────
  const [recentSalesOpen, setRecentSalesOpen] = useState(false);
  const [recentSales, setRecentSales] = useState([]);
  const [recentSalesLoading, setRecentSalesLoading] = useState(false);
  const [recentSalesSearch, setRecentSalesSearch] = useState("");

  // ── Endless Aisle ─────────────────────────────────────────────────────────
  const [endlessAisleProduct, setEndlessAisleProduct] = useState(null);
  const handleEndlessAisle = (product) => setEndlessAisleProduct(product);
  const closeEndlessAisle = () => setEndlessAisleProduct(null);

  // ── Return / Exchange Modal ───────────────────────────────────────────────
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  // Pre-loaded sale when opened from Recent Sales panel (null = no-bill mode)
  const [returnSourceSale, setReturnSourceSale] = useState(null);

  // ── Session expiry ────────────────────────────────────────────────────────
  const [sessionExpired, setSessionExpired] = useState(false);
  const pendingSaleRef = useRef(null);

  // ── Offline queue ───────────────────────────────────────────────────────
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const [offlineSyncResult, setOfflineSyncResult] = useState(null);

  // ── Notices ───────────────────────────────────────────────────────────────
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const noticeTimer = useRef(null);
  const barcodeBuffer = useRef("");
  const barcodeTimer = useRef(null);

  const showNotice = (msg) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  };

  const { fmt: money, denominations: currencyDenominations, symbol: currencySymbol } = useCurrency();

  const openingFloat = useMemo(
    () =>
      openingDenoms.reduce(
        (sum, row) => sum + row.denomination * Number(row.count || 0),
        0,
      ),
    [openingDenoms],
  );
  const canOpenShift = hasPerm("manage_orders");
  const canSwitchOutlet = hasPerm("all_access");
  const attendanceCode = attendanceStatus?.status || "not_clocked_in";
  const isReadyForCheckout = Boolean(
    selectedOutletId && activeShift && attendanceCode === "clocked_in",
  );

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api.get("/api/outlets"),
      api.get("/api/customers"),
    ])
      .then(([outData, custData]) => {
        const outList = outData.outlets || [];
        setOutlets(outList);
        setCustomers(custData.customers || []);
        // Auto-inherit outlet from global context if set
        const ctx = readContext();
        if (ctx?.active_outlet_id && !selectedOutletId) {
          const match = outList.find((o) => o.id === ctx.active_outlet_id);
          if (match) setSelectedOutletId(String(match.id));
        } else if (!selectedOutletId && outList.length === 1) {
          // For non-admin outlet-restricted users, auto-select the assigned branch.
          setSelectedOutletId(String(outList[0].id));
        }
      })
      .catch(() => setError("Failed to load POS setup data."));

    api.get("/api/receipt-templates/active")
      .then((d) => { if (d.template) setReceiptTemplate(d.template); })
      .catch(() => {}); // silently fall back to defaults if no template
  }, []);

  // ── Offline queue count init ────────────────────────────────────────────
  useEffect(() => {
    if (employee?.id) {
      setOfflineQueueCount(getQueue(employee.id).length);
    }
  }, [employee?.id]);

  useEffect(() => {
    if (selectedOutletId) {
      loadParked(selectedOutletId);
    } else {
      setParkedSales([]);
      setActiveShift(null);
      setAttendanceStatus(null);
    }
  }, [selectedOutletId]);

  const refreshGateStatus = async (outletId = selectedOutletId) => {
    if (!outletId || !employee?.id) {
      setActiveShift(null);
      setAttendanceStatus(null);
      return;
    }
    setGateLoading(true);
    try {
      const [shiftData, attendanceData] = await Promise.all([
        api.get("/api/shifts/active", { outlet_id: outletId }),
        api.get("/api/attendance/my-status", { outlet_id: outletId }),
      ]);
      setActiveShift(shiftData.shift || null);
      setAttendanceStatus(attendanceData || null);
    } catch (err) {
      setActiveShift(null);
      setAttendanceStatus(null);
      setError(err.message || "Failed to load POS opening status");
    } finally {
      setGateLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedOutletId || !employee?.id) return;
    refreshGateStatus(selectedOutletId);
  }, [selectedOutletId, employee?.id]);

  // ── Functions ─────────────────────────────────────────────────────────────
  const loadParked = async (outletId = selectedOutletId) => {
    try {
      const query = outletId ? { outlet_id: outletId } : undefined;
      const data = await api.get("/api/parked-sales", query);
      setParkedSales(data.parkedSales || []);
    } catch {
      setParkedSales([]);
    }
  };

  const loadRecentSales = async () => {
    if (!selectedOutletId) return;
    setRecentSalesLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const data = await api.get("/api/sales", { date_from: today, outlet_id: selectedOutletId, limit: 50 });
      setRecentSales(data.sales || []);
    } catch {
      setRecentSales([]);
    } finally {
      setRecentSalesLoading(false);
    }
  };

  const openReturnFromSale = (sale) => {
    setReturnSourceSale(sale);
    setReturnModalOpen(true);
    setRecentSalesOpen(false); // close panel when opening return
  };

  const triggerSearch = (query, field = "all") => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const params = { query };
        if (selectedOutletId) params.outlet_id = selectedOutletId;
        if (field !== "all") params.field = field;
        const data = await api.get("/api/products/search", params);
        setResults(data.products || []);
        setShowResults(true);
      } catch {
        setResults([]);
      }
    }, 250);
  };

  const handleSearchChange = (e, field = "all") => {
    const v = e.target.value;
    if (field === "all") {
      setSearch(v);
      setBarcodeSearch("");
      setSkuSearch("");
      setPriceSearch("");
    }
    if (field === "barcode") {
      setBarcodeSearch(v);
      setSearch("");
      setSkuSearch("");
      setPriceSearch("");
    }
    if (field === "sku") {
      setSkuSearch(v);
      setSearch("");
      setBarcodeSearch("");
      setPriceSearch("");
    }
    if (field === "price") {
      setPriceSearch(v);
      setSearch("");
      setBarcodeSearch("");
      setSkuSearch("");
    }
    triggerSearch(v, field);
  };

  const addToCart = (product) => {
    const stock = Number(product.local_stock ?? product.stock ?? 0);
    const isBundle = Boolean(product.is_bundle);
    setCart((prev) => {
      const found = prev.find((x) => x.id === product.id);
      if (found) {
        if (!isBundle && stock > 0 && found.quantity >= stock)
          showNotice(`Note: Selling past available stock (${stock} in stock).`);
        const nextQty = found.quantity + 1;
        return prev.map((x) => {
          if (x.id !== product.id) return x;
          const plMatch = resolvePriceListPrice(x.id, x.variant_id, nextQty);
          const resolvedPrice = plMatch ? Number(plMatch.price) : x.originalPrice;
          return { ...x, quantity: nextQty, price: resolvedPrice };
        });
      }
      if (!isBundle && stock <= 0)
        showNotice("Note: Item is out of stock — selling on override.");
      const basePrice = Number(product.price);
      const plMatch = resolvePriceListPrice(product.id, product.variant_id, 1);
      const resolvedPrice = plMatch ? Number(plMatch.price) : basePrice;
      return [{ ...product, quantity: 1, availableStock: isBundle ? 99999 : stock, originalPrice: basePrice, price: resolvedPrice }, ...prev];
    });
    setSearch("");
    setBarcodeSearch("");
    setSkuSearch("");
    setPriceSearch("");
    setResults([]);
    setShowResults(false);
    searchRef.current?.focus();
  };

  const handleBarcodeScanned = useCallback(async (barcode) => {
    try {
      const res = await api.raw(`/api/products/scan/${encodeURIComponent(barcode)}`, {
        headers: { "x-employee-id": String(employee?.id || "") },
      });
      if (!res.ok) return; // 404 = product not found — silently ignore
      const data = await res.json();
      const product = data.product;
      if (product) {
        addToCart(product);
      }
    } catch (err) {
      console.error("Barcode lookup failed:", err);
    }
  }, [employee?.id, addToCart]);

  // Refs for functions declared later — avoids TDZ in the keyboard useEffect
  const parkSaleRef = useRef(null);
  const openCheckoutRef = useRef(null);
  const removeFromCartRef = useRef(null);

  // Barcode scanner — rapid keystroke detection (scanners type ~50ms between chars)
  useEffect(() => {
    function handleKeyDown(e) {
      // F-key shortcuts — work even when focus is in an input
      const fkeys = {
        F1: () => { e.preventDefault(); setShowShortcutsOverlay((v) => !v); },
        F2: () => { e.preventDefault(); if (cart.length) setShowDiscountModal(true); },
        F3: () => { e.preventDefault(); if (cart.length) parkSaleRef.current?.(); },
        F4: () => { e.preventDefault(); const el = document.querySelector('[data-pos-customer-search]'); if (el) el.focus(); },
        F5: () => { e.preventDefault(); setShowParked(true); },
        F8: () => { e.preventDefault(); if (cart.length) removeFromCartRef.current?.(cart[cart.length - 1].id); },
        F9: () => { e.preventDefault(); if (cart.length) openCheckoutRef.current?.(); },
        F10: () => { e.preventDefault(); if (cart.length && window.confirm("Clear entire cart?")) setCart([]); },
        Escape: () => { setShowDiscountModal(false); setShowParked(false); setShowShortcutsOverlay(false); },
      };

      if (fkeys[e.key]) {
        fkeys[e.key]();
        return;
      }

      // Ignore keypresses when user is typing in an input, textarea, or select
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      // Barcode scanner logic (existing)
      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        barcodeBuffer.current = "";
        clearTimeout(barcodeTimer.current);
        if (code.length >= 3) {
          handleBarcodeScanned(code);
        }
        return;
      }

      if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => {
          barcodeBuffer.current = "";
        }, 100);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleBarcodeScanned, cart, setCart]);

  // Fetch wallet balance when a customer is selected at checkout
  useEffect(() => {
    if (!checkoutCustomerId) {
      setCheckoutWalletBalance(0);
      setRedeemPointsOn(false);
      setPayWithWalletOn(false);
      return;
    }
    setCheckoutWalletLoading(true);
    api.get(`/api/customers/${checkoutCustomerId}/wallet`)
      .then((d) => setCheckoutWalletBalance(Number(d.balance || 0)))
      .catch(() => setCheckoutWalletBalance(0))
      .finally(() => setCheckoutWalletLoading(false));
  }, [checkoutCustomerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Price list fetch on customer change ──────────────────────────────────
  useEffect(() => {
    const cust = customers.find((c) => String(c.id) === String(selectedCustomerId));
    if (!cust?.price_list_id) { setPriceListItems([]); return; }
    api.get(`/api/price-lists/${cust.price_list_id}/items`)
      .then((d) => setPriceListItems(d.items || []))
      .catch(() => setPriceListItems([]));
  }, [selectedCustomerId, customers]);

  // ── Outlet price list fetch (phase2_outlet_pricing) ───────────────────────
  useEffect(() => {
    if (!selectedOutletId) { setOutletPriceListItems([]); return; }
    api.get(`/price-list-assignments?scope_type=outlet&scope_id=${selectedOutletId}`)
      .then(async (d) => {
        const assignments = d.assignments || [];
        if (!assignments.length) { setOutletPriceListItems([]); return; }
        // Use highest priority assignment
        const topPl = assignments.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
        const items = await api.get(`/price-lists/${topPl.price_list_id}/items`);
        setOutletPriceListItems(items.items || []);
      })
      .catch(() => setOutletPriceListItems([]));
  }, [selectedOutletId]);

  // Re-resolve all cart prices when price list changes (customer selected/deselected)
  useEffect(() => {
    setCart((prev) => {
      if (!prev.length) return prev;
      return prev.map((item) => {
        const base = item.originalPrice ?? item.price;
        const plMatch = priceListItems
          .filter((i) => i.product_id === item.id &&
            (String(i.variant_id || "") === String(item.variant_id || "")) &&
            i.min_qty <= item.quantity)
          .sort((a, b) => b.min_qty - a.min_qty)[0];
        const resolvedPrice = plMatch ? Number(plMatch.price) : base;
        return { ...item, originalPrice: base, price: resolvedPrice };
      });
    });
  }, [priceListItems]);

  const resolvePriceListPrice = useCallback((productId, variantId, qty) => {
    // Customer price list takes priority over outlet price list
    const sources = priceListItems.length ? priceListItems : outletPriceListItems;
    if (!sources.length) return null;
    const matches = sources
      .filter((i) => i.product_id === productId &&
        (String(i.variant_id || "") === String(variantId || "")) &&
        i.min_qty <= qty)
      .sort((a, b) => b.min_qty - a.min_qty);
    return matches[0] || null;
  }, [priceListItems, outletPriceListItems]);

  const updateQty = (id, delta) => {
    setCart((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        const next = x.quantity + delta;
        if (next < 1) return x;
        if (delta > 0 && x.availableStock > 0 && next > x.availableStock)
          showNotice(
            `Note: Selling past available stock (${x.availableStock} in stock).`,
          );
        const plMatch = resolvePriceListPrice(x.id, x.variant_id, next);
        const resolvedPrice = plMatch ? Number(plMatch.price) : (x.originalPrice ?? x.price);
        return { ...x, quantity: next, price: resolvedPrice };
      }),
    );
  };

  const removeFromCart = (id) =>
    setCart((prev) => prev.filter((x) => x.id !== id));
  removeFromCartRef.current = removeFromCart;

  const grossTotal = useMemo(() => calcGrossTotal(cart), [cart]);

  const discountValue = useMemo(
    () => calcDiscountValue(grossTotal, discountType, discountInput),
    [discountInput, discountType, grossTotal],
  );

  const taxTotal = useMemo(() => calcTaxTotal(cart, taxInclusive), [cart, taxInclusive]);

  const total = calcTotal(grossTotal, discountValue, taxTotal, taxInclusive);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  // ── Loyalty computations ──────────────────────────────────────────────────
  const checkoutCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(checkoutCustomerId)) || null,
    [customers, checkoutCustomerId],
  );
  const checkoutCustomerPoints = checkoutCustomer?.loyalty_points || 0;
  const checkoutCustomerTier = checkoutCustomer
    ? { name: checkoutCustomer.tier_name, color: checkoutCustomer.tier_color, multiplier: Number(checkoutCustomer.tier_multiplier) || 1, discount: Number(checkoutCustomer.tier_discount) || 0 }
    : null;
  // Points earned on this sale — preview uses tier multiplier (backend is authoritative)
  const tierMultiplier = checkoutCustomerTier?.multiplier || 1;
  const pointsEarned = Math.floor((total / 100) * LOYALTY_EARN_RATE * tierMultiplier);
  // Points discount: floor(points / 100) * PKR 10
  const pointsDiscount = redeemPointsOn
    ? Math.floor(checkoutCustomerPoints / 100) * LOYALTY_REDEEM_RATE
    : 0;
  const pointsRedeemed = redeemPointsOn
    ? Math.floor(checkoutCustomerPoints / 100) * 100
    : 0;

  const remaining = Math.max(0, total - totalPaid - pointsDiscount);
  const change = Math.max(0, totalPaid - total + pointsDiscount);

  const effectiveCustomerId = checkoutOpen
    ? checkoutCustomerId
    : selectedCustomerId;
  const selectedCustomer = useMemo(
    () =>
      customers.find((c) => String(c.id) === String(effectiveCustomerId)) ||
      null,
    [customers, effectiveCustomerId],
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 15);
    return customers
      .filter(
        (c) =>
          String(c.name || "")
            .toLowerCase()
            .includes(q) || String(c.mobile || "").includes(q),
      )
      .slice(0, 15);
  }, [customers, customerSearch]);

  const filteredCheckoutCustomers = useMemo(() => {
    const q = checkoutCustSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 15);
    return customers
      .filter(
        (c) =>
          String(c.name || "")
            .toLowerCase()
            .includes(q) || String(c.mobile || "").includes(q),
      )
      .slice(0, 15);
  }, [customers, checkoutCustSearch]);

  const parkSale = async () => {
    if (!cart.length || !selectedOutletId) return;
    try {
      await api.post("/api/parked-sales", {
          employee_id: employee?.id || null,
          outlet_id: Number(selectedOutletId),
          customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
          notes: orderNote || null,
          items: cart.map((i) => ({
            product_id: i.id,
            variant_id: i.variant_id || null,
            product_name: i.name,
            quantity: i.quantity,
            price: i.price,
            effective_tax_rate: i.effectiveTaxRate || 0,
          })),
        });
      setCart([]);
      setDiscountInput("");
      setOrderNote("");
      setSelectedCustomerId("");
      await loadParked(selectedOutletId);
      showNotice("Sale parked successfully.");
    } catch (e) {
      setError(e.message || "Failed to park sale");
    }
  };
  parkSaleRef.current = parkSale;

  const restoreParked = async (row) => {
    try {
      const data = await api.get(`/api/parked-sales/${row.id}`);
      setCart(
        (data.items || []).map((i) => ({
          id: i.product_id,
          variant_id: i.variant_id || null,
          name: i.product_name,
          quantity: Number(i.quantity),
          price: Number(i.price),
          availableStock: 99999,
        })),
      );
      setOrderNote(data.parkedSale?.notes || "");
      if (data.parkedSale?.customer_id)
        setSelectedCustomerId(String(data.parkedSale.customer_id));
      await api.del(`/api/parked-sales/${row.id}`);
      await loadParked(selectedOutletId);
      setShowParked(false);
      showNotice("Parked sale restored.");
    } catch (e) {
      setError(e.message || "Failed to restore parked sale");
    }
  };

  const openCheckout = () => {
    if (!cart.length) return;
    if (!selectedOutletId) {
      setError("Select a branch before using POS.");
      return;
    }
    if (!activeShift) {
      setError("Open the shift before completing sales.");
      return;
    }
    if (attendanceCode !== "clocked_in") {
      setError(
        attendanceCode === "on_break"
          ? "Clock back in before using POS."
          : "Clock in at the kiosk before using POS.",
      );
      return;
    }
    setPayments([]);
    setPaymentMethod("Cash");
    setPaymentAmount(total.toFixed(2));
    setCheckoutCustomerId(selectedCustomerId);
    setCheckoutCustSearch(
      selectedCustomerId
        ? customers.find((c) => String(c.id) === String(selectedCustomerId))
            ?.name || ""
        : "",
    );
    setCustMode("search");
    setNewCustName("");
    setNewCustMobile("");
    setNewCustError("");
    setRedeemPointsOn(false);
    setPayWithWalletOn(false);
    setCheckoutOpen(true);
  };
  openCheckoutRef.current = openCheckout;

  const handleQuickCreateCustomer = async () => {
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
  };

  const openShiftFromPOS = async () => {
    if (!selectedOutletId || !canOpenShift || openingFloat <= 0) return;
    setOpeningShiftBusy(true);
    setError("");
    try {
      await api.post("/api/shifts/open", {
          outlet_id: Number(selectedOutletId),
          employee_id: employee?.id || null,
          opening_float: Number(openingFloat.toFixed(2)),
          denominations: openingDenoms
            .filter((row) => Number(row.count || 0) > 0)
            .map((row) => ({
              denomination: row.denomination,
              count: Number(row.count || 0),
            })),
        });
      showNotice("Shift opened successfully.");
      await refreshGateStatus(selectedOutletId);
    } catch (err) {
      setError(err.message || "Failed to open shift");
    } finally {
      setOpeningShiftBusy(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const addPayment = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return;
    setPayments((prev) => [...prev, { method: paymentMethod, amount }]);
    setPaymentAmount(
      remaining - amount > 0 ? (remaining - amount).toFixed(2) : "",
    );
  };

  const printSlip = async (s) => {
    const result = await printToHardware(s, receiptTemplate);
    if (result.fallback) {
      // Printer offline or not configured — fall back to browser popup
      buildReceiptHtml(s, receiptTemplate, currencySymbol);
    }
    // If result.ok: silent hardware print succeeded, no browser popup needed
  };

  const completeSale = async () => {
    if (!selectedOutletId || !cart.length || remaining > 0) return;
    if (!activeShift) {
      setError("Cannot checkout until a shift is open.");
      return;
    }
    if (attendanceCode !== "clocked_in") {
      setError(
        attendanceCode === "on_break"
          ? "Cannot checkout while on break."
          : "Cannot checkout until you are clocked in.",
      );
      return;
    }
    setSubmitting(true);
    setError("");
    const salePayload = {
      cartItems: cart,
      payments,
      outlet_id: Number(selectedOutletId),
      employee_id: employee?.id || null,
      customer_id: checkoutCustomerId ? Number(checkoutCustomerId) : null,
      discount_amount: Number(discountInput || 0),
      discount_type: discountType,
      notes: orderNote || null,
      points_earned: checkoutCustomerId ? pointsEarned : 0,
      points_redeemed: checkoutCustomerId ? pointsRedeemed : 0,
      idempotency_key: crypto.randomUUID(),
    };

    const queueSaleOffline = () => {
      try {
        const count = enqueue(employee.id, salePayload);
        setOfflineQueueCount(count);
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
          employee: employee,
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
        setCart([]);
        setDiscountInput("");
        setOrderNote("");
        setSelectedCustomerId("");
        setCheckoutOpen(false);
        setPayments([]);
        showNotice(`Sale queued offline (${count} pending). Will sync when online.`);
      } catch (queueErr) {
        setError(queueErr.message);
      }
    };

    // If offline, queue immediately without attempting fetch
    if (!navigator.onLine) {
      queueSaleOffline();
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
      setSlip({
        saleId: data.saleId,
        invoiceNumber: data.invoiceNumber || "-",
        cart: [...cart],
        payments: [...payments],
        total,
        change,
        customer: custObj || null,
        outlet: outlets.find((o) => String(o.id) === String(selectedOutletId)),
        employee: employee,
        discountAmount: discountValue,
        discountInput: Number(discountInput || 0),
        discountType,
        taxAmount: taxInclusive && taxTotal > 0 ? taxTotal : 0,
        taxInclusive,
        orderNote: orderNote || null,
        timestamp: new Date().toLocaleString(),
      });
      setSlipOpen(true);

      // Signal "paid" to customer-facing display before clearing cart
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

      setCart([]);
      setDiscountInput("");
      setOrderNote("");
      setSelectedCustomerId("");
      setCheckoutOpen(false);
      setPayments([]);
      showNotice(
        `Sale #${data.saleId} completed. Invoice: ${data.invoiceNumber || "-"}`,
      );
      await loadParked(selectedOutletId);
    } catch (e) {
      // Network error — queue offline
      if (e instanceof TypeError || !navigator.onLine) {
        queueSaleOffline();
      } else {
        setError(e.message || "Failed to complete sale");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const retryPendingSale = async () => {
    const payload = pendingSaleRef.current;
    if (!payload) return;
    pendingSaleRef.current = null;
    setSessionExpired(false);
    setSubmitting(true);
    setError("");
    try {
      const data = await api.post("/api/sales", payload);

      const custObj = payload.customer_id
        ? customers.find((c) => String(c.id) === String(payload.customer_id))
        : null;
      setSlip({
        saleId: data.saleId,
        invoiceNumber: data.invoiceNumber || "-",
        cart: [...cart],
        payments: payload.payments,
        total,
        change,
        customer: custObj || null,
        outlet: outlets.find((o) => String(o.id) === String(selectedOutletId)),
        employee: employee,
        discountAmount: discountValue,
        discountInput: payload.discount_amount,
        discountType: payload.discount_type,
        taxAmount: taxInclusive && taxTotal > 0 ? taxTotal : 0,
        taxInclusive,
        orderNote: payload.notes || null,
        timestamp: new Date().toLocaleString(),
      });
      setSlipOpen(true);
      setCart([]);
      setDiscountInput("");
      setOrderNote("");
      setSelectedCustomerId("");
      setCheckoutOpen(false);
      setPayments([]);
      showNotice(`Sale #${data.saleId} completed. Invoice: ${data.invoiceNumber || "-"}`);
      await loadParked(selectedOutletId);
    } catch (e) {
      setError(e.message || "Failed to complete sale");
    } finally {
      setSubmitting(false);
    }
  };

  const syncQueue = useCallback(async () => {
    if (!employee?.id) return;
    const queue = getQueue(employee.id);
    if (!queue.length) return;
    if (offlineSyncing) return;
    setOfflineSyncing(true);
    let synced = 0;
    for (const sale of queue) {
      try {
        const res = await api.raw("/api/sales", {
          method: "POST",
          body: JSON.stringify(sale),
        });
        if (res.ok) {
          dequeue(employee.id, sale.idempotency_key);
          synced++;
        } else {
          const data = await res.json().catch(() => ({}));
          if (data.duplicate) {
            dequeue(employee.id, sale.idempotency_key);
            synced++;
          } else {
            break;
          }
        }
      } catch {
        break;
      }
    }
    const remaining = getQueue(employee.id).length;
    setOfflineQueueCount(remaining);
    setOfflineSyncing(false);
    if (synced > 0) {
      setOfflineSyncResult({ synced });
      showNotice(`${synced} offline sale(s) synced successfully.`);
      setTimeout(() => setOfflineSyncResult(null), 5000);
    }
  }, [employee?.id, offlineSyncing]);

  useEffect(() => {
    const handleOnline = () => { syncQueue(); };
    const handleStorage = (e) => {
      if (e.key?.startsWith("pos_offline_queue_") && employee?.id) {
        setOfflineQueueCount(getQueue(employee.id).length);
      }
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("storage", handleStorage);
    };
  }, [syncQueue, employee?.id]);

  const handleLock = () => {
    sessionStorage.setItem("posLocked", "1");
    setIsLocked(true);
    setLockPin("");
    setLockError("");
  };

  const handleUnlock = async (e) => {
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
  };

  // ── Customer-facing display sync ─────────────────────────────────────────
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
        }).catch(() => {}); // silent fail — display is non-critical
    }, 500);
    return () => clearTimeout(customerDisplayTimerRef.current);
  }, [cart, grossTotal, taxTotal, total, activeShift]);

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
    outlets,
    customers,
    selectedOutletId,
    setSelectedOutletId,
    activeShift,
    attendanceStatus,
    attendanceCode,
    gateLoading,
    canOpenShift,
    canSwitchOutlet,
    isReadyForCheckout,
    openingDenoms,
    setOpeningDenoms,
    openingFloat,
    openingShiftBusy,
    openShiftFromPOS,
    closeShiftOpen,
    setCloseShiftOpen,
    refreshGateStatus,
    search,
    setSearch,
    barcodeSearch,
    setBarcodeSearch,
    skuSearch,
    setSkuSearch,
    priceSearch,
    setPriceSearch,
    results,
    setResults,
    showResults,
    setShowResults,
    searchRef,
    cart,
    setCart,
    taxInclusive,
    setTaxInclusive,
    discountType,
    setDiscountType,
    discountInput,
    setDiscountInput,
    orderNote,
    setOrderNote,
    showDiscountModal,
    setShowDiscountModal,
    showNoteModal,
    setShowNoteModal,
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
    payments,
    setPayments,
    paymentMethod,
    setPaymentMethod,
    paymentAmount,
    setPaymentAmount,
    checkoutCustomerId,
    setCheckoutCustomerId,
    checkoutCustSearch,
    setCheckoutCustSearch,
    showCheckoutCustDD,
    setShowCheckoutCustDD,
    submitting,
    setSubmitting,
    payAmountRef,
    custMode,
    setCustMode,
    newCustName,
    setNewCustName,
    newCustMobile,
    setNewCustMobile,
    newCustSaving,
    setNewCustSaving,
    newCustError,
    setNewCustError,
    slip,
    setSlip,
    slipOpen,
    setSlipOpen,
    receiptTemplate,
    notice,
    setNotice,
    error,
    setError,
    success,
    setSuccess,
    money,
    currencyDenominations,
    currencySymbol,
    showNotice,
    loadParked,
    triggerSearch,
    handleSearchChange,
    addToCart,
    updateQty,
    removeFromCart,
    grossTotal,
    discountValue,
    taxTotal,
    total,
    totalPaid,
    remaining,
    change,
    selectedCustomer,
    filteredCustomers,
    filteredCheckoutCustomers,
    parkSale,
    restoreParked,
    openCheckout,
    handleQuickCreateCustomer,
    addPayment,
    printSlip,
    completeSale,
    handleLock,
    handleUnlock,
    recentSalesOpen,
    setRecentSalesOpen,
    recentSales,
    recentSalesLoading,
    recentSalesSearch,
    setRecentSalesSearch,
    loadRecentSales,
    returnModalOpen,
    setReturnModalOpen,
    returnSourceSale,
    setReturnSourceSale,
    openReturnFromSale,
    // Loyalty & wallet
    checkoutWalletBalance,
    checkoutWalletLoading,
    redeemPointsOn,
    setRedeemPointsOn,
    payWithWalletOn,
    setPayWithWalletOn,
    checkoutCustomerPoints,
    checkoutCustomerTier,
    pointsEarned,
    pointsDiscount,
    pointsRedeemed,
    LOYALTY_EARN_RATE,
    LOYALTY_REDEEM_RATE,
    sessionExpired,
    setSessionExpired,
    retryPendingSale,
    // Offline queue
    offlineQueueCount,
    offlineSyncing,
    offlineSyncResult,
    syncQueue,
    showShortcutsOverlay,
    setShowShortcutsOverlay,
    // Endless aisle
    endlessAisleProduct,
    handleEndlessAisle,
    closeEndlessAisle,
    // Price lists
    priceListItems,
  };

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
};
