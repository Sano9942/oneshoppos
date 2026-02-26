import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  SectionCard,
  Select,
} from "../../ui/primitives";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { Search, ShoppingCart, Trash2, Plus, Minus, Pause, Play, CreditCard, ArrowLeft, LogOut } from "lucide-react";

function money(v) {
  return `PKRs ${Number(v || 0).toFixed(2)}`;
}

export default function POSRedesign() {
  const navigate = useNavigate();
  const { employee, authHeaders, logout } = useAuth();
  const [outlets, setOutlets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const searchTimer = useRef(null);

  const [cart, setCart] = useState([]);
  const [discountType, setDiscountType] = useState("fixed");
  const [discountInput, setDiscountInput] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [showDiscountEditor, setShowDiscountEditor] = useState(false);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [taxInclusive, setTaxInclusive] = useState(false);

  const [parkedSales, setParkedSales] = useState([]);
  const [showParked, setShowParked] = useState(false);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payments, setPayments] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadBootstrap = async () => {
    try {
      const [outRes, custRes] = await Promise.all([
        fetch(`${API}/api/outlets`, { headers: authHeaders() }),
        fetch(`${API}/api/customers`, { headers: authHeaders() }),
      ]);
      const outData = await outRes.json();
      const custData = await custRes.json();
      const outList = outData.outlets || [];
      setOutlets(outList);
      setCustomers(custData.customers || []);
      if (!selectedOutletId && outList.length > 0) {
        setSelectedOutletId(String(outList[0].id));
      }
    } catch {
      setError("Failed to load POS setup data.");
    }
  };

  const loadParked = async (outletId = selectedOutletId, allOutlets = false) => {
    if (!outletId && !allOutlets) return;
    try {
      const qs = !allOutlets && outletId ? `?outlet_id=${outletId}` : "";
      const res = await fetch(`${API}/api/parked-sales${qs}`, { headers: authHeaders() });
      const data = await res.json();
      setParkedSales(data.parkedSales || []);
    } catch {
      setParkedSales([]);
    }
  };

  useEffect(() => {
    loadBootstrap();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedOutletId) loadParked(selectedOutletId);
  }, [selectedOutletId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const outletParam = selectedOutletId ? `&outlet_id=${selectedOutletId}` : "";
        const res = await fetch(
          `${API}/api/products/search?query=${encodeURIComponent(search)}${outletParam}`,
        );
        const data = await res.json();
        setResults(data.products || []);
        setShowResults(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [search, selectedOutletId]);

  const addToCart = (product) => {
    setError("");
    const stock = Number(product.local_stock ?? product.stock ?? 0);
    setCart((prev) => {
      const found = prev.find((x) => x.id === product.id);
      if (found) {
        if (found.quantity >= stock) {
          setError(`Only ${stock} available in this outlet.`);
          return prev;
        }
        return prev.map((x) =>
          x.id === product.id ? { ...x, quantity: x.quantity + 1 } : x,
        );
      }
      if (stock <= 0) {
        setError("This product is out of stock.");
        return prev;
      }
      return [{ ...product, quantity: 1, availableStock: stock }, ...prev];
    });
    setSearch("");
    setResults([]);
    setShowResults(false);
  };

  const updateQty = (id, delta) => {
    setCart((prev) =>
      prev
        .map((x) => {
          if (x.id !== id) return x;
          const nextQty = x.quantity + delta;
          if (nextQty > x.availableStock) {
            setError(`Only ${x.availableStock} available.`);
            return x;
          }
          return { ...x, quantity: Math.max(0, nextQty) };
        })
        .filter((x) => x.quantity > 0),
    );
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, i) => sum + Number(i.price || 0) * i.quantity, 0),
    [cart],
  );

  const discountAmount = useMemo(() => {
    const raw = Number(discountInput || 0);
    if (discountType === "percent") return (subtotal * raw) / 100;
    return raw;
  }, [discountInput, discountType, subtotal]);

  const total = Math.max(0, subtotal - discountAmount);
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const remaining = Math.max(0, total - totalPaid);
  const change = Math.max(0, totalPaid - total);
  const gstAmount = 0;

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 20);
    return customers
      .filter((c) => {
        const name = String(c.name || "").toLowerCase();
        const mobile = String(c.mobile || "").toLowerCase();
        return name.includes(q) || mobile.includes(q);
      })
      .slice(0, 20);
  }, [customers, customerSearch]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerSearch("");
      return;
    }
    const found = customers.find((c) => String(c.id) === String(selectedCustomerId));
    if (found) setCustomerSearch(found.name || "");
  }, [selectedCustomerId, customers]);

  const openCheckout = () => {
    if (cart.length === 0) return;
    setPayments([]);
    setPaymentMethod("Cash");
    setPaymentAmount(total.toFixed(2));
    setCheckoutOpen(true);
  };

  const openParkedSales = async () => {
    await loadParked(selectedOutletId, true);
    setShowParked(true);
  };

  const addPayment = (e) => {
    e.preventDefault();
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return;
    setPayments((prev) => [...prev, { method: paymentMethod, amount }]);
    setPaymentAmount(remaining > 0 ? remaining.toFixed(2) : "");
  };

  const completeSale = async () => {
    if (!selectedOutletId || cart.length === 0 || remaining > 0) return;
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
          customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
          discount_amount: Number(discountInput || 0),
          discount_type: discountType,
          notes: orderNote || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to complete sale");
      setCart([]);
      setDiscountInput("");
      setOrderNote("");
      setSelectedCustomerId("");
      setCheckoutOpen(false);
      setPayments([]);
      await loadParked();
    } catch (e) {
      setError(e.message || "Failed to complete sale");
    } finally {
      setSubmitting(false);
    }
  };

  const parkSale = async () => {
    if (!cart.length) return;
    if (!selectedOutletId) {
      setError("Select an outlet before parking a sale.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/parked-sales`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          employee_id: employee?.id || null,
          outlet_id: selectedOutletId ? Number(selectedOutletId) : null,
          customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
          notes: orderNote || null,
          items: cart.map((item) => ({
            product_id: item.id,
            variant_id: item.variant_id || null,
            product_name: item.name,
            quantity: item.quantity,
            price: item.price,
            effective_tax_rate: item.effective_tax_rate || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to park sale");
      setCart([]);
      setDiscountInput("");
      setOrderNote("");
      setSelectedCustomerId("");
      await loadParked(selectedOutletId, true);
      setNotice("Sale parked successfully.");
    } catch (e) {
      setError(e.message || "Failed to park sale");
    }
  };

  const restoreParked = async (row) => {
    try {
      const res = await fetch(`${API}/api/parked-sales/${row.id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load parked sale");
      const restored = (data.items || []).map((item) => ({
        id: item.product_id,
        variant_id: item.variant_id || null,
        name: item.product_name,
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
        availableStock: 99999,
      }));
      setCart(restored);
      setOrderNote(data.parkedSale?.notes || "");
      if (data.parkedSale?.outlet_id) {
        setSelectedOutletId(String(data.parkedSale.outlet_id));
      }
      if (data.parkedSale?.customer_id) {
        setSelectedCustomerId(String(data.parkedSale.customer_id));
      }
      await fetch(`${API}/api/parked-sales/${row.id}`, { method: "DELETE", headers: authHeaders() });
      await loadParked(selectedOutletId, true);
      setShowParked(false);
      setNotice("Parked sale restored.");
    } catch (e) {
      setError(e.message || "Failed to restore parked sale");
    }
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-3xl font-black text-slate-900">Point Of Sale</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-medium text-slate-700">{employee?.name || "Employee"}</span>
          <span className="font-semibold text-slate-900">
            {outlets.find((o) => String(o.id) === String(selectedOutletId))?.name || "Outlet"}
          </span>
          <Link to="/dashboard" className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft size={14} />
            Dashboard
          </Link>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut size={14} />
            Lock
          </button>
        </div>
      </div>

      {notice ? (
        <SectionCard className="mb-3 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" className="font-semibold" onClick={() => setNotice("")}>Dismiss</button>
          </div>
        </SectionCard>
      ) : null}

      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <div className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" className="font-semibold" onClick={() => setError("")}>Dismiss</button>
          </div>
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-3 xl:col-span-9">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-5xl font-black tracking-tight text-slate-900">Sell</h1>
            </div>
            <div className="flex gap-2">
              <Button onClick={parkSale} disabled={cart.length === 0 || !selectedOutletId}>
                <Pause size={14} className="mr-1 inline" />
                Park Sale
              </Button>
              <Button onClick={openParkedSales}>
                <Play size={14} className="mr-1 inline" />
                Parked Sales
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2">
              <span className="font-medium text-slate-600">
                {new Date().toLocaleDateString("en-GB")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setTaxInclusive((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 font-medium ${
                taxInclusive
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              <span
                className={`h-5 w-10 rounded-full transition ${
                  taxInclusive ? "bg-emerald-500" : "bg-slate-300"
                }`}
              >
                <span
                  className={`mt-[2px] block h-4 w-4 rounded-full bg-white transition ${
                    taxInclusive ? "ml-5" : "ml-1"
                  }`}
                />
              </span>
              Tax Inclusive
            </button>
            <Select
              value={selectedOutletId}
              onChange={(e) => setSelectedOutletId(e.target.value)}
              className="w-56"
            >
              <option value="">Select outlet</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-base font-semibold text-slate-900">Search Product</label>
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
              <Input
                className="h-12 rounded-xl border-slate-200 pl-10 text-base"
                placeholder="Search for Product"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {showResults && results.length > 0 ? (
                <div className="absolute left-0 right-0 top-12 z-20 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => addToCart(p)}
                    >
                      <div className="font-medium text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        {p.barcode || p.sku || "-"} | {money(p.price)} | Stock {Number(p.local_stock || 0)}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <SectionCard className="overflow-hidden border-slate-200 p-0">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <p className="text-lg font-semibold text-slate-900">Products List</p>
              <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-xs font-semibold text-white">
                {cart.length} item{cart.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-3 py-2 text-center">Qty</th>
                  <th className="px-3 py-2 text-right">Unit</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {cart.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{i.name}</p>
                      <p className="text-xs text-slate-500">{i.barcode || i.sku || "-"}</p>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="h-7 w-7 rounded-md text-indigo-600 hover:bg-indigo-50"
                          onClick={() => updateQty(i.id, -1)}
                        >
                          <Minus size={12} className="mx-auto" />
                        </button>
                        <span className="w-8 text-center font-semibold text-slate-900">{i.quantity}</span>
                        <button
                          type="button"
                          className="h-7 w-7 rounded-md text-indigo-600 hover:bg-indigo-50"
                          onClick={() => updateQty(i.id, 1)}
                        >
                          <Plus size={12} className="mx-auto" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">{money(i.price)}</td>
                    <td className="px-3 py-2 text-right text-xl font-bold text-slate-900">
                      {money(Number(i.price || 0) * i.quantity)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Button
                        size="sm"
                        tone="danger"
                        onClick={() => setCart((prev) => prev.filter((x) => x.id !== i.id))}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cart.length === 0 ? (
              <EmptyState title="Cart is empty" body="Search items to start a new sale." />
            ) : null}
            </div>
          </SectionCard>
        </div>

        <div className="xl:col-span-3">
          <div className="rounded-3xl bg-[#06080d] p-4 text-white shadow-2xl">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
              <input
                className="h-12 w-full rounded-2xl border border-slate-700 bg-white pl-10 pr-3 text-base font-medium text-slate-900 outline-none"
                placeholder="Search customer"
                value={customerSearch}
                onFocus={() => setShowCustomerResults(true)}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setShowCustomerResults(true);
                }}
              />
              {showCustomerResults ? (
                <div className="absolute left-0 right-0 top-12 z-20 max-h-52 overflow-auto rounded-2xl border border-slate-700 bg-[#0e1118] shadow">
                  <button
                    type="button"
                    className="block w-full border-b border-slate-700 px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                    onClick={() => {
                      setSelectedCustomerId("");
                      setCustomerSearch("Walk-in Customer");
                      setShowCustomerResults(false);
                    }}
                  >
                    Walk-in Customer
                  </button>
                  {filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="block w-full border-b border-slate-700 px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                      onClick={() => {
                        setSelectedCustomerId(String(c.id));
                        setCustomerSearch(c.name || "");
                        setShowCustomerResults(false);
                      }}
                    >
                      <p>{c.name}</p>
                      <p className="text-xs text-slate-400">{c.mobile || "-"}</p>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-[#0a0d14] p-5 text-center">
              <ShoppingCart size={30} className="mx-auto text-slate-500" />
              <p className="mt-3 text-xl font-semibold">
                {selectedCustomerId ? customers.find((c) => String(c.id) === String(selectedCustomerId))?.name || "Customer" : "Walk-in Customer"}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="rounded-2xl border border-slate-700 px-3 py-3 text-left font-semibold text-indigo-300 hover:bg-slate-900"
                onClick={() => setShowDiscountEditor((v) => !v)}
              >
                Add Discount
              </button>
              <button
                type="button"
                className="rounded-2xl border border-slate-700 px-3 py-3 text-left font-semibold text-emerald-300 hover:bg-slate-900"
                onClick={() => setShowNoteEditor((v) => !v)}
              >
                Edit Note
              </button>
            </div>

            {showDiscountEditor ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Select value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
                  <option value="fixed">Fixed</option>
                  <option value="percent">Percent</option>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  placeholder={discountType === "percent" ? "10" : "0.00"}
                />
              </div>
            ) : null}

            {showNoteEditor ? (
              <div className="mt-3">
                <Input
                  placeholder="Order note (optional)"
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                />
              </div>
            ) : null}

            <div className="mt-5 space-y-3 border-t border-slate-800 pt-4 text-lg">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">SubTotal</span>
                <span className="font-semibold">{money(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Discount Amount</span>
                <span className="font-semibold">{money(discountAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">GST</span>
                <span className="font-semibold">{money(gstAmount)}</span>
              </div>
              <div className="flex items-center justify-between text-2xl font-black">
                <span>Total</span>
                <span>{money(total)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={openCheckout}
              disabled={cart.length === 0 || !selectedOutletId}
              className="mt-5 flex h-14 w-full items-center justify-between rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 px-6 text-2xl font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>Pay</span>
              <span>{money(total)}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCart([]);
                setDiscountInput("");
                setOrderNote("");
              }}
              className="mt-3 w-full text-center text-lg font-medium text-slate-400 hover:text-white"
            >
              Clear Order
            </button>
          </div>
        </div>
      </div>

      {showParked ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-2xl p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--ui-text)]">Parked Sales</h3>
              <Button onClick={() => setShowParked(false)}>Close</Button>
            </div>
            <p className="mt-1 text-xs text-[var(--ui-text-muted)]">Showing all outlets</p>
            <div className="mt-3 max-h-96 space-y-2 overflow-auto">
              {parkedSales.length === 0 ? (
                <p className="text-xs text-[var(--ui-text-muted)]">No parked sales found.</p>
              ) : (
                parkedSales.map((p) => (
                  <div key={p.id} className="rounded border border-[var(--ui-border)] p-2 text-xs">
                    <p className="font-medium text-[var(--ui-text)]">
                      #{p.id} {p.customer_name || "Walk-in"}
                    </p>
                    <p className="text-[var(--ui-text-muted)]">
                      {p.item_count} items {p.outlet_name ? `| Outlet: ${p.outlet_name}` : ""}
                    </p>
                    <div className="mt-1 flex gap-1">
                      <Button size="sm" onClick={() => restoreParked(p)}>
                        Restore
                      </Button>
                      <Button
                        size="sm"
                        tone="danger"
                        onClick={async () => {
                          await fetch(`${API}/api/parked-sales/${p.id}`, { method: "DELETE", headers: authHeaders() });
                          await loadParked(selectedOutletId, true);
                          setNotice("Parked sale deleted.");
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>
      ) : null}

      {checkoutOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-lg p-4">
            <h3 className="text-lg font-semibold text-[var(--ui-text)]">Checkout</h3>
            <p className="text-xs text-[var(--ui-text-muted)]">Total {money(total)} | Remaining {money(remaining)} | Change {money(change)}</p>

            <form onSubmit={addPayment} className="mt-3 grid grid-cols-3 gap-2">
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="Wallet">Wallet</option>
              </Select>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.00"
              />
              <Button type="submit">Add Payment</Button>
            </form>

            <div className="mt-3 max-h-40 space-y-2 overflow-auto">
              {payments.map((p, idx) => (
                <div key={`${p.method}-${idx}`} className="flex items-center justify-between rounded border border-[var(--ui-border)] p-2 text-sm">
                  <span>{p.method}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{money(p.amount)}</span>
                    <Button size="sm" tone="danger" onClick={() => setPayments((prev) => prev.filter((_, i) => i !== idx))}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <Badge tone={remaining > 0 ? "warning" : "success"}>
                {remaining > 0 ? "Awaiting full payment" : "Ready to complete"}
              </Badge>
              <div className="flex gap-2">
                <Button onClick={() => setCheckoutOpen(false)}>Cancel</Button>
                <Button tone="primary" disabled={remaining > 0 || submitting} onClick={completeSale}>
                  {submitting ? "Submitting..." : "Complete Sale"}
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
}
