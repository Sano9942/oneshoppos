import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import {
  Search, ShoppingCart, Trash2, Plus, Minus, Pause, Play,
  CreditCard, ArrowLeft, Lock, X, CheckCircle2, Banknote,
  Wallet, User, Tag, FileText, Calendar, Store,
} from "lucide-react";

function money(v) {
  return `PKRs ${Number(v || 0).toFixed(2)}`;
}

export default function POSRedesign() {
  const navigate = useNavigate();
  const { employee, authHeaders, logout } = useAuth();

  // ── Lock state ────────────────────────────────────────────────────────────
  const [isLocked, setIsLocked] = useState(() => sessionStorage.getItem("posLocked") === "1");
  const [lockPin, setLockPin] = useState("");
  const [lockError, setLockError] = useState("");

  // ── Bootstrap data ────────────────────────────────────────────────────────
  const [outlets, setOutlets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");

  // ── Product search ────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");           // unified
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
  const [custMode, setCustMode] = useState("search"); // "search" | "create"
  const [newCustName, setNewCustName] = useState("");
  const [newCustMobile, setNewCustMobile] = useState("");
  const [newCustSaving, setNewCustSaving] = useState(false);
  const [newCustError, setNewCustError] = useState("");

  // ── Receipt slip ──────────────────────────────────────────────────────────
  const [slip, setSlip] = useState(null); // { saleId, invoiceNumber, cart, payments, total, change, customer }
  const [slipOpen, setSlipOpen] = useState(false);

  // ── Notices ───────────────────────────────────────────────────────────────
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const noticeTimer = useRef(null);

  const showNotice = (msg) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  };

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/outlets`, { headers: authHeaders() }).then((r) => r.json()),
      fetch(`${API}/api/customers`, { headers: authHeaders() }).then((r) => r.json()),
    ])
      .then(([outData, custData]) => {
        const outList = outData.outlets || [];
        setOutlets(outList);
        setCustomers(custData.customers || []);
        if (outList.length > 0) setSelectedOutletId(String(outList[0].id));
      })
      .catch(() => setError("Failed to load POS setup data."));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedOutletId) loadParked(selectedOutletId);
  }, [selectedOutletId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus payment amount when checkout opens
  useEffect(() => {
    if (checkoutOpen && payAmountRef.current) {
      setTimeout(() => payAmountRef.current?.focus(), 120);
    }
  }, [checkoutOpen]);

  // ── Parked sales ──────────────────────────────────────────────────────────
  const loadParked = async (outletId = selectedOutletId) => {
    try {
      const qs = outletId ? `?outlet_id=${outletId}` : "";
      const res = await fetch(`${API}/api/parked-sales${qs}`, { headers: authHeaders() });
      const data = await res.json();
      setParkedSales(data.parkedSales || []);
    } catch {
      setParkedSales([]);
    }
  };

  // ── Product search (debounced) ────────────────────────────────────────────
  const triggerSearch = (query, field = "all") => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) { setResults([]); setShowResults(false); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const outletParam = selectedOutletId ? `&outlet_id=${selectedOutletId}` : "";
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
    if (field === "all") { setSearch(v); setBarcodeSearch(""); setSkuSearch(""); setPriceSearch(""); }
    if (field === "barcode") { setBarcodeSearch(v); setSearch(""); setSkuSearch(""); setPriceSearch(""); }
    if (field === "sku") { setSkuSearch(v); setSearch(""); setBarcodeSearch(""); setPriceSearch(""); }
    if (field === "price") { setPriceSearch(v); setSearch(""); setBarcodeSearch(""); setSkuSearch(""); }
    triggerSearch(v, field);
  };

  // ── Add to cart ───────────────────────────────────────────────────────────
  const addToCart = (product) => {
    const stock = Number(product.local_stock ?? product.stock ?? 0);
    setCart((prev) => {
      const found = prev.find((x) => x.id === product.id);
      if (found) {
        if (stock > 0 && found.quantity >= stock)
          showNotice(`Note: Selling past available stock (${stock} in stock).`);
        return prev.map((x) => x.id === product.id ? { ...x, quantity: x.quantity + 1 } : x);
      }
      if (stock <= 0) showNotice("Note: Item is out of stock — selling on override.");
      return [{ ...product, quantity: 1, availableStock: stock }, ...prev];
    });
    setSearch(""); setBarcodeSearch(""); setSkuSearch(""); setPriceSearch("");
    setResults([]); setShowResults(false);
    searchRef.current?.focus();
  };

  const updateQty = (id, delta) => {
    setCart((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        const next = x.quantity + delta;
        if (next < 1) return x;
        if (delta > 0 && x.availableStock > 0 && next > x.availableStock)
          showNotice(`Note: Selling past available stock (${x.availableStock} in stock).`);
        return { ...x, quantity: next };
      }),
    );
  };

  const removeFromCart = (id) => setCart((prev) => prev.filter((x) => x.id !== id));

  // ── Totals ────────────────────────────────────────────────────────────────
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

  const total = Math.max(0, grossTotal - discountValue + (taxInclusive ? 0 : taxTotal));
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remaining = Math.max(0, total - totalPaid);
  const change = Math.max(0, totalPaid - total);

  // ── Active customer (sidebar or checkout) ─────────────────────────────────
  const effectiveCustomerId = checkoutOpen ? checkoutCustomerId : selectedCustomerId;
  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(effectiveCustomerId)) || null,
    [customers, effectiveCustomerId],
  );
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 15);
    return customers.filter((c) =>
      String(c.name || "").toLowerCase().includes(q) ||
      String(c.mobile || "").includes(q),
    ).slice(0, 15);
  }, [customers, customerSearch]);

  const filteredCheckoutCustomers = useMemo(() => {
    const q = checkoutCustSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 15);
    return customers.filter((c) =>
      String(c.name || "").toLowerCase().includes(q) ||
      String(c.mobile || "").includes(q),
    ).slice(0, 15);
  }, [customers, checkoutCustSearch]);

  // ── Park / Restore ────────────────────────────────────────────────────────
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
      setCart([]); setDiscountInput(""); setOrderNote(""); setSelectedCustomerId("");
      await loadParked(selectedOutletId);
      showNotice("Sale parked successfully.");
    } catch (e) {
      setError(e.message || "Failed to park sale");
    }
  };

  const restoreParked = async (row) => {
    try {
      const res = await fetch(`${API}/api/parked-sales/${row.id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCart((data.items || []).map((i) => ({
        id: i.product_id,
        variant_id: i.variant_id || null,
        name: i.product_name,
        quantity: Number(i.quantity),
        price: Number(i.price),
        availableStock: 99999,
      })));
      setOrderNote(data.parkedSale?.notes || "");
      if (data.parkedSale?.customer_id) setSelectedCustomerId(String(data.parkedSale.customer_id));
      await fetch(`${API}/api/parked-sales/${row.id}`, { method: "DELETE", headers: authHeaders() });
      await loadParked(selectedOutletId);
      setShowParked(false);
      showNotice("Parked sale restored.");
    } catch (e) {
      setError(e.message || "Failed to restore parked sale");
    }
  };

  // ── Checkout ──────────────────────────────────────────────────────────────
  const openCheckout = () => {
    if (!cart.length) return;
    setPayments([]);
    setPaymentMethod("Cash");
    setPaymentAmount(total.toFixed(2));
    setCheckoutCustomerId(selectedCustomerId);
    setCheckoutCustSearch(
      selectedCustomerId
        ? customers.find((c) => String(c.id) === String(selectedCustomerId))?.name || ""
        : "",
    );
    setCustMode("search");
    setNewCustName(""); setNewCustMobile(""); setNewCustError("");
    setCheckoutOpen(true);
  };

  const handleQuickCreateCustomer = async () => {
    if (!newCustName.trim()) { setNewCustError("Name is required"); return; }
    setNewCustSaving(true); setNewCustError("");
    try {
      const res = await fetch(`${API}/api/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCustName.trim(), mobile: newCustMobile.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setNewCustError(data.error || "Failed to create customer"); return; }
      setCustomers((prev) => [...prev, data]);
      setCheckoutCustomerId(String(data.id));
      setCheckoutCustSearch(data.name);
      setCustMode("search");
      setNewCustName(""); setNewCustMobile("");
    } catch { setNewCustError("Network error"); }
    finally { setNewCustSaving(false); }
  };

  const addPayment = (e) => {
    e.preventDefault();
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return;
    setPayments((prev) => [...prev, { method: paymentMethod, amount }]);
    setPaymentAmount(remaining - amount > 0 ? (remaining - amount).toFixed(2) : "");
  };

  const printSlip = (s) => {
    const w = window.open("", "_blank", "width=360,height=620");
    const d = w.document;
    const style = d.createElement("style");
    style.textContent = "body{font-family:monospace;font-size:13px;width:300px;margin:0 auto;padding:12px} .row{display:flex;justify-content:space-between} .c{text-align:center} hr{border:none;border-top:1px dashed #999;margin:6px 0}";
    d.head.appendChild(style);
    d.title = `Receipt ${s.invoiceNumber}`;
    const b = d.body;
    const txt = (tag, text, cls = "") => { const e = d.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
    const row = (l, r) => { const e = d.createElement("div"); e.className = "row"; e.appendChild(txt("span", l)); e.appendChild(txt("span", r)); return e; };
    b.appendChild(txt("div", s.outlet?.name || "OneShopPOS", "c"));
    b.appendChild(txt("div", s.timestamp, "c"));
    b.appendChild(txt("div", `Invoice: ${s.invoiceNumber}`, "c"));
    if (s.employee) b.appendChild(txt("div", `Staff: ${s.employee.name}`, "c"));
    if (s.customer) b.appendChild(txt("div", `Customer: ${s.customer.name}${s.customer.mobile ? " · " + s.customer.mobile : ""}`, "c"));
    b.appendChild(d.createElement("hr"));
    s.cart.forEach((item) => b.appendChild(row(`${item.name} x${item.quantity}`, money(item.price * item.quantity))));
    b.appendChild(d.createElement("hr"));
    if (s.discountAmount > 0) b.appendChild(row("Discount", `-${money(s.discountAmount)}`));
    const totalRow = row("TOTAL", money(s.total));
    totalRow.style.fontWeight = "bold";
    b.appendChild(totalRow);
    s.payments.forEach((p) => b.appendChild(row(p.method, money(p.amount))));
    if (s.change > 0) b.appendChild(row("Change", money(s.change)));
    b.appendChild(d.createElement("hr"));
    b.appendChild(txt("div", "Thank you for your purchase!", "c"));
    w.print();
  };

  const completeSale = async () => {
    if (!selectedOutletId || !cart.length || remaining > 0) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      // Capture slip data before clearing cart
      const custObj = checkoutCustomerId ? customers.find((c) => String(c.id) === String(checkoutCustomerId)) : null;
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
        timestamp: new Date().toLocaleString(),
      });
      setSlipOpen(true);

      setCart([]); setDiscountInput(""); setOrderNote(""); setSelectedCustomerId("");
      setCheckoutOpen(false); setPayments([]);
      showNotice(`Sale #${data.saleId} completed. Invoice: ${data.invoiceNumber || "-"}`);
      await loadParked(selectedOutletId);
    } catch (e) {
      setError(e.message || "Failed to complete sale");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Lock ──────────────────────────────────────────────────────────────────
  const handleLock = () => {
    sessionStorage.setItem("posLocked", "1");
    setIsLocked(true); setLockPin(""); setLockError("");
  };

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!lockPin) return;
    try {
      const res = await fetch(`${API}/api/employees/validate-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin_code: lockPin }),
      });
      const data = await res.json();
      if (!res.ok || !data.employee) { setLockError("Invalid PIN"); setLockPin(""); return; }
      if (employee?.id && data.employee.id !== employee.id) {
        setLockError("PIN does not match the logged-in user"); setLockPin(""); return;
      }
      sessionStorage.removeItem("posLocked");
      setIsLocked(false); setLockPin(""); setLockError("");
    } catch {
      setLockError("Failed to connect to server");
    }
  };

  // ── Lock screen ───────────────────────────────────────────────────────────
  if (isLocked) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
            <Lock size={32} />
          </div>
          <h1 className="mb-1 text-2xl font-bold text-slate-800">POS Terminal</h1>
          <p className="mb-6 text-center text-sm text-slate-500">Enter your PIN to unlock</p>
          <form onSubmit={handleUnlock} className="flex w-full flex-col gap-4">
            <input
              type="password" autoFocus maxLength="10" value={lockPin}
              onChange={(e) => { setLockPin(e.target.value); setLockError(""); }}
              className="w-full rounded-xl border border-slate-300 py-3 px-4 text-center font-mono text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="••••"
            />
            {lockError && <p className="text-center text-sm font-medium text-red-500">{lockError}</p>}
            <button type="submit" disabled={!lockPin}
              className="w-full rounded-xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
              Unlock Register
            </button>
            <button type="button"
              onClick={async () => { await logout(); navigate("/login", { replace: true }); }}
              className="text-center text-sm text-slate-400 hover:text-slate-700">
              Sign out completely
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Main POS ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-slate-100 font-sans">

      {/* ── Top nav bar ── */}
      <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex items-center justify-between shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-2.5">
          <Store size={18} className="text-[#8066FF]" />
          <span className="text-base font-bold text-slate-800">Point Of Sale</span>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <span className="font-medium text-slate-600 hidden sm:block">{employee?.name || "Employee"}</span>
          {outlets.length > 0 && (
            <select
              value={selectedOutletId}
              onChange={(e) => setSelectedOutletId(e.target.value)}
              className="text-sm font-bold text-slate-700 bg-transparent focus:outline-none cursor-pointer border-none"
            >
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <Link to="/dashboard" className="flex items-center gap-1 text-slate-500 hover:text-slate-800 font-medium transition">
            <ArrowLeft size={14} /> Dashboard
          </Link>
          {slip && (
            <button onClick={() => setSlipOpen(true)}
              className="flex items-center gap-1 text-violet-500 hover:text-violet-700 font-medium transition text-sm">
              <FileText size={14} /> Last Receipt
            </button>
          )}
          <button onClick={handleLock}
            className="flex items-center gap-1 text-slate-500 hover:text-red-600 font-medium transition">
            <Lock size={14} /> Lock
          </button>
        </div>
      </div>

      {/* ── Notices ── */}
      {(notice || error) && (
        <div className={`shrink-0 px-5 py-2 text-sm flex items-center justify-between ${
          error ? "bg-rose-50 text-rose-700 border-b border-rose-200"
                : notice.startsWith("Note:") ? "bg-amber-50 text-amber-700 border-b border-amber-200"
                : "bg-emerald-50 text-emerald-700 border-b border-emerald-200"
        }`}>
          <span>{error || notice}</span>
          <button onClick={() => { setError(""); setNotice(""); }} className="font-semibold ml-4 hover:opacity-70">Dismiss</button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ════════════ LEFT PANEL ════════════ */}
        <div className="flex-1 flex flex-col p-5 overflow-y-auto bg-slate-50">

          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">Sell</h2>
              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400 font-medium">
                <Calendar size={12} />
                {new Date().toLocaleDateString("en-GB")}
                <button
                  onClick={() => setTaxInclusive((v) => !v)}
                  className={`ml-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs font-semibold transition ${
                    taxInclusive ? "bg-[#8066FF]/10 border-[#8066FF] text-[#8066FF]" : "bg-white border-slate-200 text-slate-500"
                  }`}
                >
                  <span className={`w-7 h-3.5 rounded-full relative transition-colors ${taxInclusive ? "bg-[#8066FF]" : "bg-slate-200"}`}>
                    <span className={`w-3 h-3 bg-white rounded-full absolute top-0.5 shadow transition-all ${taxInclusive ? "left-3.5" : "left-0.5"}`} />
                  </span>
                  Tax Inclusive
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={parkSale} disabled={!cart.length || !selectedOutletId}
                className="flex items-center gap-1.5 text-[#8066FF] border border-indigo-100 bg-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-50 transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                <Pause size={13} /> Park Sale
              </button>
              <button onClick={() => { loadParked(selectedOutletId); setShowParked(true); }}
                className="flex items-center gap-1.5 text-[#8066FF] border border-indigo-100 bg-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-50 transition shadow-sm relative">
                <Play size={13} /> Parked
                {parkedSales.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-[#8066FF] text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">
                    {parkedSales.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* ── Search bars ── */}
          <div className="mb-3 space-y-2">
            {/* Specific field search row */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { field: "barcode", val: barcodeSearch, placeholder: "Search by Barcode" },
                { field: "sku",     val: skuSearch,     placeholder: "Search by SKU" },
                { field: "price",   val: priceSearch,   placeholder: "Search by Price" },
              ].map(({ field, val, placeholder }) => (
                <input key={field} type="text" value={val} placeholder={placeholder}
                  onChange={(e) => handleSearchChange(e, field)}
                  className="block w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-medium placeholder-slate-300 focus:outline-none focus:border-[#8066FF] focus:ring-1 focus:ring-[#8066FF] transition shadow-sm"
                />
              ))}
            </div>

            {/* Unified search */}
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                autoFocus
                autoComplete="off"
                value={search}
                onChange={handleSearchChange}
                onFocus={() => { if (results.length > 0) setShowResults(true); }}
                onKeyDown={(e) => { if (e.key === "Enter" && results.length > 0) { e.preventDefault(); addToCart(results[0]); }}}
                placeholder="Search by Name, Barcode, SKU… (F2)"
                className="block w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl bg-white font-medium text-sm placeholder-slate-300 focus:outline-none focus:border-[#8066FF] focus:ring-1 focus:ring-[#8066FF] transition shadow-sm"
              />
              {showResults && results.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-100 rounded-xl shadow-xl max-h-64 overflow-y-auto">
                  {results.map((p) => {
                    const stock = Number(p.local_stock ?? p.stock ?? 0);
                    return (
                      <div key={p.id} onClick={() => addToCart(p)}
                        className="flex justify-between items-center px-4 py-2.5 hover:bg-[#8066FF]/5 cursor-pointer border-b border-slate-50 last:border-0 transition">
                        <div>
                          <div className="font-bold text-slate-800 text-sm">{p.name}</div>
                          <div className="text-[10px] text-slate-400">{p.barcode || p.sku || "—"}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-[#8066FF] text-sm">{money(p.price)}</div>
                          <div className={`text-[10px] font-bold uppercase ${stock > 0 ? "text-emerald-500" : "text-red-400"}`}>
                            {stock > 0 ? `${stock} in stock` : "out of stock"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Cart table ── */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              <span className="text-sm font-bold text-slate-800">Products List</span>
              {cart.length > 0 && (
                <span className="bg-[#8066FF] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {cart.length} item{cart.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-16">
                <ShoppingCart size={36} className="mb-3 text-[#8066FF] opacity-30" />
                <p className="font-bold text-slate-600">Cart is empty</p>
                <p className="text-xs text-slate-400 mt-1">Search items above to start a new sale.</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase text-slate-400 tracking-wider border-b border-slate-100 bg-slate-50">
                      <th className="px-4 py-2.5 text-left font-bold">Product</th>
                      <th className="px-3 py-2.5 text-center font-bold">Qty</th>
                      <th className="px-3 py-2.5 text-right font-bold">Unit</th>
                      <th className="px-3 py-2.5 text-right font-bold">Total</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => (
                      <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition">
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-800">{item.name}</div>
                          {item.availableStock > 0 && item.quantity >= item.availableStock && (
                            <div className="text-[10px] text-rose-500 font-bold mt-0.5">⚠ Max stock reached</div>
                          )}
                          {item.availableStock <= 0 && (
                            <div className="text-[10px] text-amber-500 font-bold mt-0.5">⚠ Override: out of stock</div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="inline-flex items-center gap-1">
                            <button onClick={() => updateQty(item.id, -1)}
                              className="w-7 h-7 flex items-center justify-center text-[#8066FF] hover:bg-[#8066FF]/10 rounded-full font-bold transition">
                              <Minus size={12} />
                            </button>
                            <span className="w-8 text-center font-bold text-slate-800">{item.quantity}</span>
                            <button onClick={() => updateQty(item.id, 1)}
                              className="w-7 h-7 flex items-center justify-center text-[#8066FF] hover:bg-[#8066FF]/10 rounded-full font-bold transition">
                              <Plus size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-slate-500 font-bold">{money(item.price)}</td>
                        <td className="px-3 py-3 text-right font-black text-slate-900">{money(item.price * item.quantity)}</td>
                        <td className="px-3 py-3 text-right">
                          <button onClick={() => removeFromCart(item.id)}
                            className="text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 p-1.5 rounded-lg transition">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ════════════ RIGHT PANEL (dark) ════════════ */}
        <div className="w-80 shrink-0 bg-[#0A0A0A] text-white flex flex-col p-4 shadow-2xl z-10">

          {/* Customer search */}
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text" placeholder="Search customer…"
              value={customerSearch}
              onFocus={() => setShowCustomerDD(true)}
              onBlur={() => setTimeout(() => setShowCustomerDD(false), 180)}
              onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDD(true); }}
              className="w-full bg-white text-slate-900 rounded-xl pl-9 pr-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#8066FF] placeholder-slate-400"
            />
            {showCustomerDD && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-40">
                <div
                  onMouseDown={() => { setSelectedCustomerId(""); setCustomerSearch(""); setShowCustomerDD(false); }}
                  className="px-3 py-2 border-b border-slate-100 text-slate-500 text-sm cursor-pointer hover:bg-slate-50"
                >
                  Walk-in Customer
                </div>
                {filteredCustomers.map((c) => (
                  <div key={c.id}
                    onMouseDown={() => { setSelectedCustomerId(String(c.id)); setCustomerSearch(c.name || ""); setShowCustomerDD(false); }}
                    className="px-3 py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50">
                    <div className="font-bold text-sm text-slate-800">{c.name}</div>
                    {c.mobile && <div className="text-xs text-slate-500">{c.mobile}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Customer card */}
          <div className="rounded-2xl border border-[#1A1A1A] bg-[#111] p-4 text-center mb-4">
            {selectedCustomer ? (
              <>
                <div className="w-10 h-10 rounded-full bg-[#8066FF]/20 text-[#8066FF] flex items-center justify-center mx-auto mb-2">
                  <User size={18} />
                </div>
                <p className="font-bold text-sm text-white">{selectedCustomer.name}</p>
                {selectedCustomer.mobile && <p className="text-xs text-slate-400 mt-0.5">{selectedCustomer.mobile}</p>}
                <div className="flex justify-center gap-2 mt-2 text-xs">
                  <span className="rounded-full bg-[#8066FF]/20 text-[#8066FF] px-2 py-0.5 font-semibold">
                    {selectedCustomer.loyalty_points || 0} pts
                  </span>
                </div>
                <button onClick={() => { setSelectedCustomerId(""); setCustomerSearch(""); }}
                  className="mt-2 text-[10px] text-red-400 hover:text-red-300">Remove</button>
              </>
            ) : (
              <div className="opacity-40 flex flex-col items-center">
                <ShoppingCart size={28} className="mb-2" />
                <span className="text-sm font-bold">Walk-in Customer</span>
              </div>
            )}
          </div>

          {/* Discount / Note buttons */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button onClick={() => setShowDiscountModal(true)}
              className="flex items-center justify-center gap-1.5 border border-[#333] hover:bg-[#1A1A1A] rounded-xl py-2.5 text-xs font-bold transition">
              <Tag size={12} className="text-[#8066FF]" />
              {discountInput ? `Disc. (${discountType === "percent" ? discountInput + "%" : "PKR " + discountInput})` : "Add Discount"}
            </button>
            <button onClick={() => setShowNoteModal(true)}
              className="flex items-center justify-center gap-1.5 border border-[#333] hover:bg-[#1A1A1A] rounded-xl py-2.5 text-xs font-bold transition">
              <FileText size={12} className={orderNote ? "text-emerald-400" : "text-[#8066FF]"} />
              {orderNote ? "Edit Note" : "Add Note"}
            </button>
          </div>

          {/* Totals */}
          <div className="space-y-3 text-sm font-medium text-slate-400 border-t border-[#222] pt-4 mb-4 flex-1">
            <div className="flex justify-between"><span>Subtotal</span><span className="text-white">{money(grossTotal)}</span></div>
            {discountValue > 0 && (
              <div className="flex justify-between text-amber-400">
                <span>Discount {discountType === "percent" ? `(${discountInput}%)` : ""}</span>
                <span>- {money(discountValue)}</span>
              </div>
            )}
            {taxInclusive && taxTotal > 0 && (
              <div className="flex justify-between"><span>GST (incl.)</span><span className="text-white">{money(taxTotal)}</span></div>
            )}
            <div className="flex justify-between text-base font-black text-white border-t border-[#222] pt-3">
              <span>Total</span><span>{money(total)}</span>
            </div>
          </div>

          {/* Pay button */}
          <button onClick={openCheckout} disabled={!cart.length}
            className={`w-full py-4 rounded-xl font-black text-lg flex items-center justify-between px-5 transition-all ${
              cart.length
                ? "bg-[#8066FF] hover:bg-[#7055E6] hover:scale-[1.01] shadow-[0_10px_20px_-10px_rgba(128,102,255,0.6)]"
                : "bg-[#8066FF]/30 cursor-not-allowed text-white/40"
            }`}>
            <span className="border-r border-white/20 pr-4 text-base tracking-wide">Pay</span>
            <span className="pl-2 flex-1 text-right tracking-tight">{money(total)}</span>
          </button>

          <button onClick={() => { setCart([]); setDiscountInput(""); setOrderNote(""); setSelectedCustomerId(""); setCustomerSearch(""); }}
            className="mt-3 w-full text-center text-slate-500 text-xs font-semibold hover:text-white transition">
            Clear Order
          </button>
        </div>
      </div>

      {/* ══════════════ MODALS ══════════════ */}

      {/* Discount modal */}
      {showDiscountModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-800">Add Discount</h3>
              <button onClick={() => setShowDiscountModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
                {["percent", "fixed"].map((t) => (
                  <button key={t} onClick={() => setDiscountType(t)}
                    className={`flex-1 py-1.5 rounded-md text-sm font-bold transition ${discountType === t ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:bg-slate-200"}`}>
                    {t === "percent" ? "Percentage (%)" : "Fixed Amount"}
                  </button>
                ))}
              </div>
              <input type="number" min="0" step="0.01" value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)} autoFocus
                className="w-full border-2 border-slate-200 rounded-lg px-4 py-2.5 focus:border-[#8066FF] outline-none font-bold text-slate-800"
                placeholder={discountType === "percent" ? "10" : "50.00"}
              />
              <button onClick={() => setShowDiscountModal(false)}
                className="w-full bg-[#8066FF] hover:bg-[#7055E6] text-white font-bold py-2.5 rounded-lg transition">
                Apply Discount
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note modal */}
      {showNoteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-800">Order Note</h3>
              <button onClick={() => setShowNoteModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5">
              <textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value)} autoFocus
                className="w-full border-2 border-slate-200 rounded-lg px-4 py-3 focus:border-[#8066FF] outline-none min-h-[100px] resize-none text-slate-800"
                placeholder="Add instructions or comments for this order…"
              />
              <button onClick={() => setShowNoteModal(false)}
                className="mt-3 w-full bg-[#8066FF] hover:bg-[#7055E6] text-white font-bold py-2.5 rounded-lg transition">
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Parked sales modal */}
      {showParked && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Play size={16} className="text-[#8066FF]" /> Parked Sales</h3>
              <button onClick={() => setShowParked(false)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200"><X size={18} /></button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              {parkedSales.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <ShoppingCart size={36} className="mx-auto mb-3 opacity-20" />
                  <p className="font-medium">No parked sales.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {parkedSales.map((p) => (
                    <div key={p.id} className="border border-slate-200 rounded-xl p-4 flex items-center justify-between hover:border-[#8066FF] transition">
                      <div>
                        <div className="font-bold text-slate-800">Parked Sale #{p.id}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {new Date(p.parked_at).toLocaleString()} · {p.item_count} item(s) · {p.customer_name || "Walk-in"}
                        </div>
                        {p.notes && <div className="text-xs text-slate-400 mt-0.5 italic">"{p.notes}"</div>}
                      </div>
                      <div className="flex gap-2 ml-4 shrink-0">
                        <button onClick={async () => {
                          await fetch(`${API}/api/parked-sales/${p.id}`, { method: "DELETE", headers: authHeaders() });
                          await loadParked(selectedOutletId);
                          showNotice("Parked sale deleted.");
                        }} className="px-3 py-1.5 text-red-500 bg-red-50 hover:bg-red-100 rounded-lg text-xs font-bold transition">
                          Delete
                        </button>
                        <button onClick={() => restoreParked(p)}
                          className="px-4 py-1.5 bg-[#8066FF] hover:bg-[#7055E6] text-white rounded-lg text-xs font-bold shadow-sm transition">
                          Restore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {checkoutOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col border border-slate-100/20 max-h-[92vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-3xl shrink-0">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Banknote className="text-[#8066FF]" size={20} /> Complete Payment
              </h2>
              <button onClick={() => setCheckoutOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200"><X size={18} /></button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              {/* Total due */}
              <div className="text-center bg-slate-50 border border-slate-100 rounded-2xl py-5">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Total Due</p>
                <p className="text-4xl font-black text-slate-900">{money(remaining)}</p>
              </div>

              {/* Customer at checkout — quick search + create */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Customer (optional)</label>

                {checkoutCustomerId ? (
                  /* ── Attached customer chip ── */
                  <div className="flex items-center justify-between px-3 py-2.5 bg-violet-50 border border-violet-200 rounded-xl">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-violet-500 shrink-0" />
                      <div>
                        <span className="text-sm font-bold text-violet-800">{checkoutCustSearch}</span>
                        {customers.find((c) => String(c.id) === String(checkoutCustomerId))?.mobile && (
                          <span className="text-xs text-violet-500 ml-2">
                            · {customers.find((c) => String(c.id) === String(checkoutCustomerId))?.mobile}
                          </span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => { setCheckoutCustomerId(""); setCheckoutCustSearch(""); }}
                      className="text-violet-400 hover:text-violet-700 p-1 rounded-lg hover:bg-violet-100 transition">
                      <X size={14} />
                    </button>
                  </div>
                ) : custMode === "search" ? (
                  /* ── Search mode ── */
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="relative">
                      <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="text" autoFocus placeholder="Search name or phone…"
                        value={checkoutCustSearch}
                        onFocus={() => setShowCheckoutCustDD(true)}
                        onBlur={() => setTimeout(() => setShowCheckoutCustDD(false), 180)}
                        onChange={(e) => { setCheckoutCustSearch(e.target.value); setShowCheckoutCustDD(true); }}
                        className="w-full pl-8 pr-3 py-2.5 text-sm font-medium focus:outline-none border-b border-slate-100"
                      />
                    </div>
                    <div className="max-h-36 overflow-y-auto">
                      <div onMouseDown={() => { setCheckoutCustomerId(""); setCheckoutCustSearch(""); setShowCheckoutCustDD(false); }}
                        className="px-3 py-2 text-slate-400 text-xs font-semibold cursor-pointer hover:bg-slate-50 border-b border-slate-50">
                        Walk-in (no customer)
                      </div>
                      {filteredCheckoutCustomers.map((c) => (
                        <div key={c.id}
                          onMouseDown={() => { setCheckoutCustomerId(String(c.id)); setCheckoutCustSearch(c.name || ""); setShowCheckoutCustDD(false); }}
                          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-violet-50 border-b border-slate-50 last:border-0">
                          <span className="font-bold text-sm text-slate-800">{c.name}</span>
                          <span className="text-xs text-slate-400">{c.mobile || ""}</span>
                        </div>
                      ))}
                      {filteredCheckoutCustomers.length === 0 && checkoutCustSearch && (
                        <p className="text-xs text-slate-400 text-center py-2">No match found</p>
                      )}
                    </div>
                    <button type="button" onClick={() => { setCustMode("create"); setNewCustName(checkoutCustSearch); setNewCustMobile(""); setNewCustError(""); }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-violet-600 hover:bg-violet-50 border-t border-slate-100 transition">
                      <Plus size={13} /> New Customer
                    </button>
                  </div>
                ) : (
                  /* ── Create mode ── */
                  <div className="border-2 border-violet-300 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 bg-violet-600 flex items-center justify-between">
                      <span className="text-xs font-bold text-white uppercase tracking-wide">New Customer</span>
                      <button type="button" onClick={() => { setCustMode("search"); setNewCustError(""); }}
                        className="text-violet-200 hover:text-white transition"><X size={14} /></button>
                    </div>
                    <div className="p-3 space-y-2 bg-white">
                      <input type="text" autoFocus value={newCustName}
                        onChange={(e) => setNewCustName(e.target.value)}
                        placeholder="Full name *"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-violet-400 focus:outline-none"
                      />
                      <input type="tel" value={newCustMobile}
                        onChange={(e) => setNewCustMobile(e.target.value)}
                        placeholder="Phone (optional)"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-violet-400 focus:outline-none"
                      />
                      {newCustError && <p className="text-xs text-red-500 font-semibold">{newCustError}</p>}
                      <button type="button" onClick={handleQuickCreateCustomer} disabled={newCustSaving}
                        className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-lg transition disabled:opacity-50">
                        {newCustSaving ? "Saving…" : "Create & Attach to Sale"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Payment method */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "Cash", icon: <Banknote size={16} /> },
                    { id: "Card", icon: <CreditCard size={16} /> },
                    { id: "Wallet", icon: <Wallet size={16} /> },
                  ].map(({ id, icon }) => (
                    <button key={id} type="button" onClick={() => setPaymentMethod(id)}
                      className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 font-bold text-sm transition border-2 ${
                        paymentMethod === id
                          ? "border-[#8066FF] bg-[#8066FF]/5 text-[#8066FF]"
                          : "border-slate-100 bg-white hover:border-slate-200 text-slate-600"
                      }`}>
                      {icon} {id}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <form onSubmit={addPayment}>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Amount</label>
                <div className="flex gap-2">
                  <input ref={payAmountRef} type="number" step="0.01" min="0.01"
                    value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}
                    className="flex-1 px-4 py-3 bg-white border-2 border-slate-200 rounded-xl focus:border-[#8066FF] focus:ring-0 outline-none text-lg font-bold shadow-sm"
                    placeholder="0.00"
                  />
                  <button type="submit" disabled={!paymentAmount || Number(paymentAmount) <= 0}
                    className="bg-slate-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-md">
                    Add
                  </button>
                </div>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <button type="button" onClick={() => setPaymentAmount(remaining.toFixed(2))}
                    className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition">Exact</button>
                  {[50, 100, 500, 1000].map((amt) => (
                    <button key={amt} type="button"
                      onClick={() => setPaymentAmount((Math.ceil(remaining / amt) * amt).toFixed(2))}
                      className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-xs font-bold transition">+{amt}</button>
                  ))}
                </div>
              </form>

              {/* Tenders */}
              {payments.length > 0 && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Tenders</p>
                  <div className="space-y-2">
                    {payments.map((p, i) => (
                      <div key={i} className="flex items-center justify-between py-2 px-3 bg-slate-50 border border-slate-100 rounded-xl">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                          {p.method === "Cash" ? <Banknote size={14} className="text-[#8066FF]" /> : p.method === "Wallet" ? <Wallet size={14} className="text-[#8066FF]" /> : <CreditCard size={14} className="text-[#8066FF]" />}
                          {p.method}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-black text-slate-900 text-sm">{money(p.amount)}</span>
                          <button onClick={() => setPayments((prev) => prev.filter((_, j) => j !== i))}
                            className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1 rounded-lg transition">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {change > 0 && (
                    <div className="mt-3 flex justify-between items-center text-sm font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                      <span>Change Due</span><span>{money(change)}</span>
                    </div>
                  )}
                </div>
              )}

              <button onClick={completeSale} disabled={remaining > 0 || submitting}
                className={`w-full py-4 rounded-xl font-black text-lg flex items-center justify-center gap-2 transition-all ${
                  remaining > 0 || submitting
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                    : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-[0_10px_20px_-10px_rgba(16,185,129,0.5)] hover:scale-[1.01]"
                }`}>
                <CheckCircle2 size={22} className={remaining > 0 ? "opacity-40" : ""} />
                {submitting ? "Processing…" : remaining > 0 ? "Add Remaining Tender" : "Complete Sale"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Receipt slip modal ── */}
      {slipOpen && slip && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm flex flex-col border border-slate-100/20 max-h-[92vh]">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-3xl shrink-0">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-500" />
                <h2 className="text-base font-bold text-slate-800">Sale Complete</h2>
              </div>
              <button onClick={() => setSlipOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200 transition">
                <X size={17} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 font-mono text-sm space-y-3">
              <div className="text-center space-y-0.5">
                <p className="font-bold text-base">{slip.outlet?.name || "OneShopPOS"}</p>
                <p className="text-xs text-slate-500">{slip.timestamp}</p>
                <p className="text-xs text-slate-500">Invoice: <span className="font-bold text-slate-700">{slip.invoiceNumber}</span></p>
                {slip.employee && <p className="text-xs text-slate-500">Staff: {slip.employee.name}</p>}
                {slip.customer && (
                  <p className="text-xs text-emerald-700 font-semibold">
                    Customer: {slip.customer.name}{slip.customer.mobile ? ` · ${slip.customer.mobile}` : ""}
                  </p>
                )}
              </div>
              <div className="border-t border-dashed border-slate-300" />
              <div className="space-y-1">
                {slip.cart.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="flex-1 truncate">{item.name} x{item.quantity}</span>
                    <span className="ml-2 font-semibold">{money(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-slate-300" />
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{money(slip.cart.reduce((s, i) => s + i.price * i.quantity, 0))}</span>
                </div>
                {slip.discountAmount > 0 && (
                  <div className="flex justify-between text-red-500">
                    <span>Discount</span><span>- {money(slip.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-sm pt-1 border-t border-slate-200">
                  <span>Total</span><span>{money(slip.total)}</span>
                </div>
                {slip.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-slate-600">
                    <span>{p.method}</span><span>{money(p.amount)}</span>
                  </div>
                ))}
                {slip.change > 0 && (
                  <div className="flex justify-between font-bold text-emerald-600">
                    <span>Change</span><span>{money(slip.change)}</span>
                  </div>
                )}
              </div>
              <div className="border-t border-dashed border-slate-300" />
              <p className="text-center text-xs text-slate-400">Thank you for your purchase!</p>
            </div>

            <div className="p-4 border-t border-slate-100 flex gap-3 shrink-0">
              <button onClick={() => setSlipOpen(false)}
                className="flex-1 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition">
                Close
              </button>
              <button onClick={() => printSlip(slip)}
                className="flex-1 py-2.5 bg-[#8066FF] hover:bg-[#7055E6] text-white rounded-xl text-sm font-bold shadow transition">
                Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
