import React, { useState, useEffect, useCallback } from "react";
import { X, Search, Plus, Minus, RotateCcw, ShoppingCart } from "lucide-react";
import { api } from "../../../api";
import { usePOS } from "./POSContext";
import { useCurrency } from "../../../contexts/CurrencyContext";

export default function POSReturnExchangeModal() {
  const { fmt: money } = useCurrency();
  const {
    returnModalOpen,
    setReturnModalOpen,
    returnSourceSale,
    selectedOutletId,
    employee,
    authHeaders,
    printSlip,
    outlets,
    showNotice,
    setError,
  } = usePOS();

  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [saleLoading, setSaleLoading] = useState(false);
  const [resolvedSale, setResolvedSale] = useState(null);
  const [returnItems, setReturnItems] = useState([]);
  const [returnQtys, setReturnQtys] = useState({});
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("refund");

  // Separate search state for no-bill return items vs exchange replacement items
  const [returnSearch, setReturnSearch] = useState("");
  const [returnSearchResults, setReturnSearchResults] = useState([]);
  const [returnSearching, setReturnSearching] = useState(false);
  const [exSearch, setExSearch] = useState("");
  const [exResults, setExResults] = useState([]);
  const [exSearching, setExSearching] = useState(false);
  const [exchangeItems, setExchangeItems] = useState([]);

  const [settleMethod, setSettleMethod] = useState("Cash");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!returnModalOpen) {
      setInvoiceSearch("");
      setResolvedSale(null);
      setReturnItems([]);
      setReturnQtys({});
      setReason("");
      setMode("refund");
      setReturnSearch("");
      setReturnSearchResults([]);
      setExSearch("");
      setExResults([]);
      setExchangeItems([]);
      setSettleMethod("Cash");
    } else if (returnSourceSale) {
      loadSaleDetail(returnSourceSale.id);
    }
  }, [returnModalOpen, returnSourceSale]);

  const loadSaleDetail = async (saleId) => {
    setSaleLoading(true);
    try {
      const data = await api.get(`/api/sales/${saleId}`);
      setResolvedSale(data.sale);
      const items = (data.items || []).map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id || null,
        name: i.product_name || "Item",
        price: Number(i.price_at_sale || 0),
        maxQty: Number(i.quantity || 1),
      }));
      setReturnItems(items);
      const defaultQtys = {};
      items.forEach((i) => { defaultQtys[i.product_id] = i.maxQty; });
      setReturnQtys(defaultQtys);
    } catch (e) {
      setError(e.message || "Failed to load sale");
    } finally {
      setSaleLoading(false);
    }
  };

  const searchInvoice = async () => {
    if (!invoiceSearch.trim()) return;
    setSaleLoading(true);
    try {
      const data = await api.get("/api/sales", { search: invoiceSearch.trim(), limit: 5 });
      const match = (data.sales || []).find(
        (s) => String(s.invoice_number || "").toLowerCase() === invoiceSearch.trim().toLowerCase(),
      ) || data.sales?.[0];
      if (!match) throw new Error("Invoice not found");
      await loadSaleDetail(match.id);
    } catch (e) {
      setError(e.message || "Invoice not found");
      setSaleLoading(false);
    }
  };

  // Separate product search functions with their own loading state
  const searchReturnProducts = useCallback(async (q) => {
    if (!q.trim() || !selectedOutletId) return;
    setReturnSearching(true);
    try {
      const data = await api.get("/api/products/search", { query: q, outlet_id: selectedOutletId });
      setReturnSearchResults(data.products || data.results || []);
    } catch { setReturnSearchResults([]); } finally { setReturnSearching(false); }
  }, [selectedOutletId]);

  const searchExchangeProducts = useCallback(async (q) => {
    if (!q.trim() || !selectedOutletId) return;
    setExSearching(true);
    try {
      const data = await api.get("/api/products/search", { query: q, outlet_id: selectedOutletId });
      setExResults(data.products || data.results || []);
    } catch { setExResults([]); } finally { setExSearching(false); }
  }, [selectedOutletId]);

  // Debounce for no-bill return item search
  useEffect(() => {
    const t = setTimeout(() => {
      if (returnSearch) searchReturnProducts(returnSearch);
      else setReturnSearchResults([]);
    }, 350);
    return () => clearTimeout(t);
  }, [returnSearch, searchReturnProducts]);

  // Debounce for exchange replacement product search
  useEffect(() => {
    const t = setTimeout(() => {
      if (exSearch) searchExchangeProducts(exSearch);
      else setExResults([]);
    }, 350);
    return () => clearTimeout(t);
  }, [exSearch, searchExchangeProducts]);

  // Store variant_id on exchange items so backend can decrement variant stock correctly
  const addExchangeItem = (p) => {
    setExchangeItems((prev) => {
      const key = p.variant_id || p.id;
      const existing = prev.find((i) => (i.variant_id || i.id) === key);
      if (existing) return prev.map((i) => (i.variant_id || i.id) === key ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, {
        id: p.id,
        variant_id: p.variant_id || null,
        name: p.name,
        qty: 1,
        price: Number(p.price || 0),
      }];
    });
    setExSearch(""); setExResults([]);
  };

  const addReturnItem = (p) => {
    setReturnItems((prev) => {
      if (prev.find((i) => i.product_id === p.id)) return prev;
      return [...prev, { product_id: p.id, variant_id: p.variant_id || null, name: p.name, price: Number(p.price || 0), maxQty: 99 }];
    });
    setReturnQtys((q) => ({ ...q, [p.id]: 1 }));
    setReturnSearch(""); setReturnSearchResults([]);
  };

  const refundTotal = returnItems.reduce(
    (s, i) => s + i.price * Number(returnQtys[i.product_id] || 0),
    0,
  );
  const exchangeTotal = exchangeItems.reduce((s, i) => s + i.price * i.qty, 0);
  const balance = exchangeTotal - refundTotal;

  const handleComplete = async () => {
    const selectedItems = returnItems
      .filter((i) => Number(returnQtys[i.product_id] || 0) > 0)
      .map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id || null,
        quantity: Number(returnQtys[i.product_id]),
        refund_price: i.price,
      }));

    if (selectedItems.length === 0 && mode === "refund") {
      setError("Select at least one item to return.");
      return;
    }
    if (mode === "exchange" && selectedItems.length === 0) {
      setError("Select at least one item to return before exchanging.");
      return;
    }
    if (mode === "exchange" && exchangeItems.length === 0) {
      setError("Add at least one replacement item for the exchange.");
      return;
    }

    setSubmitting(true);
    try {
      let salePayments = [];
      let saleData = null;

      // For exchange: POST sale FIRST — if shift is closed this fails before return is posted,
      // preventing the inconsistent state of restocked inventory without a recorded sale.
      if (mode === "exchange" && exchangeItems.length > 0) {
        // Build payments: Return Credit covers the refund value; customer pays the remainder.
        // For even exchange (balance === 0), total will be 0 so no payment needed.
        if (balance < 0) {
          // Customer is owed money back — Return Credit covers entire exchange total
          salePayments = [{ method: "Return Credit", amount: exchangeTotal }];
        } else if (balance > 0) {
          // Customer pays the difference
          if (refundTotal > 0) salePayments.push({ method: "Return Credit", amount: refundTotal });
          salePayments.push({ method: settleMethod, amount: balance });
        }
        // balance === 0: even exchange — Return Credit covers exactly exchangeTotal
        // Total = exchangeTotal - refundTotal = 0, so no payment entry needed at all

        saleData = await api.post("/api/sales", {
            cartItems: exchangeItems.map((i) => ({
              id: i.id,
              variant_id: i.variant_id || null,
              quantity: i.qty,
              price: i.price,
            })),
            payments: salePayments,
            outlet_id: Number(selectedOutletId),
            employee_id: employee?.id || null,
            customer_id: null,
            discount_amount: refundTotal,
            discount_type: "fixed",
            notes: `Exchange for ${resolvedSale?.invoice_number || "return"}`,
          });
      }

      // POST return only after exchange sale succeeds (or if refund-only mode)
      if (selectedItems.length > 0) {
        await api.post("/api/returns", {
            original_sale_id: resolvedSale?.id || null,
            outlet_id: Number(selectedOutletId),
            employee_id: employee?.id || null,
            customer_id: null,
            total_refund: refundTotal,
            refund_method: mode === "exchange" ? "Return Credit" : settleMethod,
            reason: reason || null,
            items: selectedItems,
          });
      }

      if (saleData) {
        printSlip({
          saleId: saleData.saleId,
          invoiceNumber: saleData.invoiceNumber || "-",
          cart: exchangeItems.map((i) => ({ name: i.name, quantity: i.qty, price: i.price })),
          returnedItems: returnItems
            .filter((i) => Number(returnQtys[i.product_id] || 0) > 0)
            .map((i) => ({ name: i.name, quantity: Number(returnQtys[i.product_id]), price: i.price })),
          returnedFrom: resolvedSale?.invoice_number || null,
          payments: salePayments,
          total: exchangeTotal,
          exchangeCredit: refundTotal,
          balanceDue: balance,
          refundNote: balance < 0 ? `Refund ${money(Math.abs(balance))} via ${settleMethod}` : null,
          change: 0,
          customer: null,
          outlet: outlets.find((o) => String(o.id) === String(selectedOutletId)) || null,
          employee: employee || null,
          discountAmount: 0,
          discountType: "fixed",
          timestamp: new Date().toLocaleString(),
        });
      }

      showNotice(
        mode === "exchange"
          ? "Exchange completed successfully."
          : "Return processed successfully.",
      );
      setReturnModalOpen(false);
    } catch (e) {
      setError(e.message || "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!returnModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <h2 className="font-semibold text-slate-800">Return / Exchange</h2>
          <button onClick={() => setReturnModalOpen(false)} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {!resolvedSale && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Do you have the original bill?</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                  placeholder="Enter invoice number (e.g. INV-2026-00042)"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchInvoice()}
                />
                <button
                  onClick={searchInvoice}
                  disabled={saleLoading}
                  className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50"
                >
                  {saleLoading ? "..." : "Find Bill"}
                </button>
              </div>
              <p className="text-xs text-slate-400">— or —</p>
              <button
                onClick={() => {
                  setResolvedSale({ id: null, invoice_number: "No Bill" });
                  setReturnItems([]);
                  setReturnQtys({});
                }}
                className="text-sm text-rose-600 underline hover:text-rose-700"
              >
                Continue without a bill (manual return)
              </button>
            </div>
          )}

          {resolvedSale && returnItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400 mb-2">
                Return Items from {resolvedSale.invoice_number}
              </p>
              <div className="space-y-2">
                {returnItems.map((item) => (
                  <div key={item.product_id} className="flex items-center justify-between gap-3 p-2 border border-slate-100 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                      <p className="text-xs text-slate-400">{money(item.price)} each</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setReturnQtys((q) => ({ ...q, [item.product_id]: Math.max(0, (q[item.product_id] || 0) - 1) }))}
                        className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{returnQtys[item.product_id] || 0}</span>
                      <button
                        onClick={() => setReturnQtys((q) => ({ ...q, [item.product_id]: Math.min(item.maxQty, (q[item.product_id] || 0) + 1) }))}
                        className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"
                      >
                        <Plus size={12} />
                      </button>
                      <span className="text-xs text-slate-400 w-12 text-right">of {item.maxQty}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resolvedSale && resolvedSale.id === null && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400 mb-2">Add Items to Return</p>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                  placeholder={returnSearching ? "Searching..." : "Search product to return"}
                  value={returnSearch}
                  onChange={(e) => setReturnSearch(e.target.value)}
                />
              </div>
              {returnSearchResults.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-2 max-h-40 overflow-y-auto">
                  {returnSearchResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addReturnItem(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                    >
                      {p.name} — {money(p.price)}
                    </button>
                  ))}
                </div>
              )}
              {returnItems.length > 0 && (
                <div className="space-y-1">
                  {returnItems.map((item) => (
                    <div key={item.product_id} className="flex items-center justify-between gap-3 p-2 border border-slate-100 rounded-lg">
                      <p className="text-sm flex-1 text-slate-800">{item.name}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setReturnQtys((q) => ({ ...q, [item.product_id]: Math.max(1, (q[item.product_id] || 1) - 1) }))} className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"><Minus size={12} /></button>
                        <span className="w-6 text-center text-sm">{returnQtys[item.product_id] || 1}</span>
                        <button onClick={() => setReturnQtys((q) => ({ ...q, [item.product_id]: (q[item.product_id] || 1) + 1 }))} className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"><Plus size={12} /></button>
                        <button onClick={() => { setReturnItems((p) => p.filter((i) => i.product_id !== item.product_id)); }} className="text-rose-400 hover:text-rose-600 ml-1"><X size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {resolvedSale && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Reason (optional)</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                placeholder="Damaged, wrong item, etc."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          {resolvedSale && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400 mb-2">What does the customer want?</p>
              <div className="flex gap-2">
                {["refund", "exchange"].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition ${
                      mode === m
                        ? "border-violet-500 bg-violet-50 text-violet-700"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {m === "refund" ? "Full Refund" : "Exchange for Other Items"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {resolvedSale && mode === "exchange" && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400 mb-2">Add Replacement Items</p>
              <div className="relative mb-2">
                <ShoppingCart size={13} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                  placeholder={exSearching ? "Searching..." : "Search product to exchange for"}
                  value={exSearch}
                  onChange={(e) => setExSearch(e.target.value)}
                />
              </div>
              {exResults.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-2 max-h-40 overflow-y-auto">
                  {exResults.map((p) => (
                    <button
                      key={p.variant_id || p.id}
                      onClick={() => addExchangeItem(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                    >
                      {p.name} — {money(p.price)}
                    </button>
                  ))}
                </div>
              )}
              {exchangeItems.length > 0 && (
                <div className="space-y-1 mt-2">
                  {exchangeItems.map((item) => (
                    <div key={item.variant_id || item.id} className="flex items-center justify-between gap-3 p-2 border border-slate-100 rounded-lg">
                      <p className="text-sm flex-1 text-slate-800">{item.name}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setExchangeItems((p) => p.map((i) => (i.variant_id || i.id) === (item.variant_id || item.id) ? { ...i, qty: Math.max(1, i.qty - 1) } : i))} className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500"><Minus size={12} /></button>
                        <span className="w-6 text-center text-sm">{item.qty}</span>
                        <button onClick={() => setExchangeItems((p) => p.map((i) => (i.variant_id || i.id) === (item.variant_id || item.id) ? { ...i, qty: i.qty + 1 } : i))} className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500"><Plus size={12} /></button>
                        <button onClick={() => setExchangeItems((p) => p.filter((i) => (i.variant_id || i.id) !== (item.variant_id || item.id)))} className="text-rose-400 hover:text-rose-600 ml-1"><X size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {resolvedSale && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Return value</span>
                <span className="font-medium text-rose-600">− {money(refundTotal)}</span>
              </div>
              {mode === "exchange" && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Exchange items</span>
                  <span className="font-medium text-slate-800">{money(exchangeTotal)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold border-t border-slate-100 pt-2">
                <span>
                  {balance > 0 ? "Customer pays" : balance < 0 ? "Refund to customer" : "Even exchange"}
                </span>
                <span className={balance > 0 ? "text-emerald-600" : balance < 0 ? "text-rose-600" : "text-slate-400"}>
                  {balance === 0 ? money(0) : money(Math.abs(balance))}
                </span>
              </div>

              {(mode === "refund" || (mode === "exchange" && balance < 0)) && (
                <div>
                  <p className="text-xs text-slate-400 mb-1">Refund method</p>
                  <div className="flex gap-2 flex-wrap">
                    {["Cash", "Card", "Wallet", "Store Credit"].map((m) => (
                      <button
                        key={m}
                        onClick={() => setSettleMethod(m)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                          settleMethod === m
                            ? "border-violet-500 bg-violet-50 text-violet-700"
                            : "border-slate-200 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {mode === "exchange" && balance > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-1">Customer pays via</p>
                  <div className="flex gap-2">
                    {["Cash", "Card", "Wallet"].map((m) => (
                      <button
                        key={m}
                        onClick={() => setSettleMethod(m)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                          settleMethod === m
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {resolvedSale && (
          <div className="flex gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
            <button
              onClick={() => setReturnModalOpen(false)}
              className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleComplete}
              disabled={submitting}
              className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              {submitting ? "Processing..." : mode === "exchange" ? "Complete Exchange" : "Process Refund"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
