import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { Search, ShoppingCart, Trash2, Plus, Minus, Pause, Play, CreditCard } from "lucide-react";

function money(v) {
  return `PKRs ${Number(v || 0).toFixed(2)}`;
}

export default function POSRedesign() {
  const { employee, authHeaders } = useAuth();
  const [outlets, setOutlets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState("");
  const searchTimer = useRef(null);

  const [cart, setCart] = useState([]);
  const [discountType, setDiscountType] = useState("fixed");
  const [discountInput, setDiscountInput] = useState("");
  const [orderNote, setOrderNote] = useState("");

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

  const loadParked = async (outletId = selectedOutletId) => {
    if (!outletId) return;
    try {
      const res = await fetch(`${API}/api/parked-sales?outlet_id=${outletId}`, { headers: authHeaders() });
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

  const openCheckout = () => {
    if (cart.length === 0) return;
    setPayments([]);
    setPaymentMethod("Cash");
    setPaymentAmount(total.toFixed(2));
    setCheckoutOpen(true);
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
    try {
      const res = await fetch(`${API}/api/parked-sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      await loadParked();
    } catch (e) {
      setError(e.message || "Failed to park sale");
    }
  };

  const restoreParked = async (row) => {
    try {
      const res = await fetch(`${API}/api/parked-sales/${row.id}`);
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
      if (data.parkedSale?.customer_id) {
        setSelectedCustomerId(String(data.parkedSale.customer_id));
      }
      await fetch(`${API}/api/parked-sales/${row.id}`, { method: "DELETE" });
      await loadParked();
      setShowParked(false);
    } catch (e) {
      setError(e.message || "Failed to restore parked sale");
    }
  };

  return (
    <PageShell
      title="POS"
      subtitle="Shopify-style register workspace with parked carts and split tenders."
      right={
        <div className="flex gap-2">
          <Button onClick={() => setShowParked((v) => !v)}>
            <Pause size={14} className="mr-1 inline" />
            Parked
          </Button>
          <Link to="/sales-history">
            <Button>
              <Play size={14} className="mr-1 inline" />
              Sales History
            </Button>
          </Link>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <SectionCard className="xl:col-span-7">
          <TableToolbar
            left={
              <>
                <Select value={selectedOutletId} onChange={(e) => setSelectedOutletId(e.target.value)}>
                  <option value="">Select outlet</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </Select>
                <Select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}>
                  <option value="">Walk-in customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </>
            }
            right={
              <div className="relative min-w-[260px]">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--ui-text-muted)]" />
                <Input
                  className="pl-8"
                  placeholder="Search or scan product"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {showResults && results.length > 0 ? (
                  <div className="absolute left-0 right-0 top-9 z-10 max-h-64 overflow-auto rounded border border-[var(--ui-border)] bg-white shadow">
                    {results.map((p) => (
                      <button
                        key={p.id}
                        className="block w-full border-b border-[var(--ui-border)] px-3 py-2 text-left text-sm hover:bg-[var(--ui-muted-surface)]"
                        onClick={() => addToCart(p)}
                      >
                        <div className="font-medium text-[var(--ui-text)]">{p.name}</div>
                        <div className="text-xs text-[var(--ui-text-muted)]">
                          {p.barcode || p.sku || "-"} | {money(p.price)} | Stock {Number(p.local_stock || 0)}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            }
          />

          <div className="overflow-auto">
            <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
              <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-center">Qty</th>
                  <th className="px-3 py-2 text-right">Unit</th>
                  <th className="px-3 py-2 text-right">Line</th>
                  <th className="px-3 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {cart.map((i) => (
                  <tr key={i.id} className="border-t border-[var(--ui-border)]">
                    <td className="px-3 py-2">
                      <p className="font-medium text-[var(--ui-text)]">{i.name}</p>
                      <p className="text-xs text-[var(--ui-text-muted)]">{i.barcode || i.sku || "-"}</p>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button size="sm" onClick={() => updateQty(i.id, -1)}><Minus size={12} /></Button>
                        <span className="w-8 text-center text-[var(--ui-text)]">{i.quantity}</span>
                        <Button size="sm" onClick={() => updateQty(i.id, 1)}><Plus size={12} /></Button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--ui-text)]">{money(i.price)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[var(--ui-text)]">{money(Number(i.price || 0) * i.quantity)}</td>
                    <td className="px-3 py-2 text-center">
                      <Button size="sm" tone="danger" onClick={() => setCart((prev) => prev.filter((x) => x.id !== i.id))}>
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

        <SectionCard className="xl:col-span-5 p-3">
          <h3 className="text-sm font-semibold uppercase text-[var(--ui-text-muted)]">Sale Summary</h3>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between"><span>Items</span><span>{cart.reduce((s, i) => s + i.quantity, 0)}</span></div>
            <div className="flex items-center justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="grid grid-cols-2 gap-2">
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
            <div className="flex items-center justify-between"><span>Discount</span><span>-{money(discountAmount)}</span></div>
            <div className="flex items-center justify-between border-t border-[var(--ui-border)] pt-2 text-base font-semibold">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <Input placeholder="Order note (optional)" value={orderNote} onChange={(e) => setOrderNote(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={parkSale} disabled={cart.length === 0 || !selectedOutletId}>
                <Pause size={14} className="mr-1 inline" />
                Park Sale
              </Button>
              <Button tone="primary" onClick={openCheckout} disabled={cart.length === 0 || !selectedOutletId}>
                <CreditCard size={14} className="mr-1 inline" />
                Checkout
              </Button>
            </div>
          </div>

          {showParked ? (
            <SectionCard className="mt-4 p-2">
              <p className="mb-2 text-xs font-semibold uppercase text-[var(--ui-text-muted)]">Parked Sales</p>
              <div className="max-h-56 space-y-2 overflow-auto">
                {parkedSales.length === 0 ? (
                  <p className="text-xs text-[var(--ui-text-muted)]">No parked sales for this outlet.</p>
                ) : (
                  parkedSales.map((p) => (
                    <div key={p.id} className="rounded border border-[var(--ui-border)] p-2 text-xs">
                      <p className="font-medium text-[var(--ui-text)]">#{p.id} {p.customer_name || "Walk-in"}</p>
                      <p className="text-[var(--ui-text-muted)]">{p.item_count} items</p>
                      <div className="mt-1 flex gap-1">
                        <Button size="sm" onClick={() => restoreParked(p)}>Restore</Button>
                        <Button
                          size="sm"
                          tone="danger"
                          onClick={async () => {
                            await fetch(`${API}/api/parked-sales/${p.id}`, { method: "DELETE" });
                            loadParked();
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
          ) : null}
        </SectionCard>
      </div>

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
    </PageShell>
  );
}
