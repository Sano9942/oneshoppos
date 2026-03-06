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
import { API_BASE as API } from "../../../config";
import { useAuth } from "../../../auth/AuthProvider";
import { readContext } from "../../../auth/authStore";
import { buildReceiptHtml, buildReceiptSections, printToHardware } from "../../../utils/receipt";

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
  const [discountType, setDiscountType] = useState("fixed");
  const [discountInput, setDiscountInput] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);

  // ── Customer (sidebar) ────────────────────────────────────────────────────
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDD, setShowCustomerDD] = useState(false);

  // ── Parked sales ──────────────────────────────────────────────────────────
  const [parkedSales, setParkedSales] = useState([]);
  const [showParked, setShowParked] = useState(false);

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

  // ── Return / Exchange Modal ───────────────────────────────────────────────
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  // Pre-loaded sale when opened from Recent Sales panel (null = no-bill mode)
  const [returnSourceSale, setReturnSourceSale] = useState(null);

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

  const money = (v) =>
    new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency: "PKR",
      minimumFractionDigits: 0,
    }).format(v || 0);

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
      fetch(`${API}/api/outlets`, { headers: authHeaders() }).then((r) =>
        r.json(),
      ),
      fetch(`${API}/api/customers`, { headers: authHeaders() }).then((r) =>
        r.json(),
      ),
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

    fetch(`${API}/api/receipt-templates/active`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d.template) setReceiptTemplate(d.template); })
      .catch(() => {}); // silently fall back to defaults if no template
  }, []);

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
      const [shiftRes, attendanceRes] = await Promise.all([
        fetch(`${API}/api/shifts/active?outlet_id=${outletId}`, {
          headers: authHeaders(),
        }),
        fetch(`${API}/api/attendance/my-status?outlet_id=${outletId}`, {
          headers: authHeaders(),
        }),
      ]);
      const [shiftData, attendanceData] = await Promise.all([
        shiftRes.json(),
        attendanceRes.json(),
      ]);
      if (!shiftRes.ok) throw new Error(shiftData.error || "Failed to load active shift");
      if (!attendanceRes.ok) {
        throw new Error(attendanceData.error || "Failed to load attendance status");
      }
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
      const qs = outletId ? `?outlet_id=${outletId}` : "";
      const res = await fetch(`${API}/api/parked-sales${qs}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
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
      const res = await fetch(
        `${API}/api/sales?date_from=${today}&outlet_id=${selectedOutletId}&limit=50`,
        { headers: authHeaders() },
      );
      const data = await res.json();
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
        const outletParam = selectedOutletId
          ? `&outlet_id=${selectedOutletId}`
          : "";
        const fieldParam = field !== "all" ? `&field=${field}` : "";
        const res = await fetch(
          `${API}/api/products/search?query=${encodeURIComponent(query)}${outletParam}${fieldParam}`,
        );
        const data = await res.json();
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
    setCart((prev) => {
      const found = prev.find((x) => x.id === product.id);
      if (found) {
        if (stock > 0 && found.quantity >= stock)
          showNotice(`Note: Selling past available stock (${stock} in stock).`);
        return prev.map((x) =>
          x.id === product.id ? { ...x, quantity: x.quantity + 1 } : x,
        );
      }
      if (stock <= 0)
        showNotice("Note: Item is out of stock — selling on override.");
      return [{ ...product, quantity: 1, availableStock: stock }, ...prev];
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
      const res = await fetch(`${API}/api/products?barcode=${encodeURIComponent(barcode)}`, {
        headers: { "x-employee-id": String(employee?.id || "") },
      });
      const data = await res.json();
      // API returns { products: [...] } or an array directly — handle both
      const product = Array.isArray(data) ? data[0] : (data?.products || [])[0];
      if (product) {
        addToCart(product);
      }
      // No toast on miss — silently ignore unknown barcodes to avoid noise
    } catch (err) {
      console.error("Barcode lookup failed:", err);
    }
  }, [employee?.id, addToCart]);

  // Barcode scanner — rapid keystroke detection (scanners type ~50ms between chars)
  useEffect(() => {
    function handleKeyDown(e) {
      // Ignore keypresses when user is typing in an input, textarea, or select
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

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
        // Reset buffer if no new char within 100ms — not a scanner, just keyboard
        barcodeTimer.current = setTimeout(() => {
          barcodeBuffer.current = "";
        }, 100);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleBarcodeScanned]);

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
        return { ...x, quantity: next };
      }),
    );
  };

  const removeFromCart = (id) =>
    setCart((prev) => prev.filter((x) => x.id !== id));

  const grossTotal = useMemo(
    () => cart.reduce((s, i) => s + Number(i.price || 0) * i.quantity, 0),
    [cart],
  );

  const discountValue = useMemo(() => {
    const raw = Number(discountInput || 0);
    if (discountType === "percent") return (grossTotal * raw) / 100;
    return raw;
  }, [discountInput, discountType, grossTotal]);

  const taxTotal = useMemo(() => {
    if (!taxInclusive) return 0;
    return cart.reduce((s, i) => {
      const rate = i.effectiveTaxRate || 0;
      const itemTotal = i.price * i.quantity;
      return s + (itemTotal - itemTotal / (1 + rate / 100));
    }, 0);
  }, [cart, taxInclusive]);

  const total = Math.max(
    0,
    grossTotal - discountValue + (taxInclusive ? 0 : taxTotal),
  );
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remaining = Math.max(0, total - totalPaid);
  const change = Math.max(0, totalPaid - total);

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
      const res = await fetch(`${API}/api/parked-sales`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
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
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
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

  const restoreParked = async (row) => {
    try {
      const res = await fetch(`${API}/api/parked-sales/${row.id}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
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
      await fetch(`${API}/api/parked-sales/${row.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
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
    setCheckoutOpen(true);
  };

  const handleQuickCreateCustomer = async () => {
    if (!newCustName.trim()) {
      setNewCustError("Name is required");
      return;
    }
    setNewCustSaving(true);
    setNewCustError("");
    try {
      const res = await fetch(`${API}/api/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCustName.trim(),
          mobile: newCustMobile.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNewCustError(data.error || "Failed to create customer");
        return;
      }
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
      const res = await fetch(`${API}/api/shifts/open`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          outlet_id: Number(selectedOutletId),
          employee_id: employee?.id || null,
          opening_float: Number(openingFloat.toFixed(2)),
          denominations: openingDenoms
            .filter((row) => Number(row.count || 0) > 0)
            .map((row) => ({
              denomination: row.denomination,
              count: Number(row.count || 0),
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to open shift");
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
      buildReceiptHtml(s, receiptTemplate);
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
    try {
      const res = await fetch(`${API}/api/sales`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          cartItems: cart,
          payments,
          outlet_id: Number(selectedOutletId),
          employee_id: employee?.id || null,
          customer_id: checkoutCustomerId ? Number(checkoutCustomerId) : null,
          discount_amount: Number(discountInput || 0),
          discount_type: discountType,
          notes: orderNote || null,
        }),
      });
      const data = await res.json();
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
        discountAmount: Number(discountInput || 0),
        discountType,
        taxAmount: taxInclusive && taxTotal > 0 ? taxTotal : 0,
        taxInclusive,
        orderNote: orderNote || null,
        timestamp: new Date().toLocaleString(),
      });
      setSlipOpen(true);

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
      setError(e.message || "Failed to complete sale");
    } finally {
      setSubmitting(false);
    }
  };

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
      const res = await fetch(`${API}/api/employees/validate-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin_code: lockPin }),
      });
      const data = await res.json();
      if (!res.ok || !data.employee) {
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
  };

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
};
