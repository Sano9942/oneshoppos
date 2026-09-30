import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, Search, Plus, Minus, RotateCcw, ShoppingCart, AlertTriangle } from "lucide-react";
import { api } from "../../../api";
import { usePOS } from "./POSContext";
import { useCurrency } from "../../../contexts/CurrencyContext";
import POSRefundThresholdModal from "./POSRefundThresholdModal";
import { useAuth } from "../../../auth/AuthProvider";
import { exchangeSettlement } from "./exchangeMath";

export default function POSReturnExchangeModal() {
  const { fmt: money } = useCurrency();
  const { hasPerm } = useAuth();
  // F1 / D48: a discount on the exchange balance needs the same permission as
  // a till discount (the server checks it too).
  const canDiscount = !!hasPerm?.("pos_discount");
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
    posFlags,
    setCollisionModal,
    enqueueReturn,
  } = usePOS();

  // 2-G.7: gate per-line restock controls on the tenant flag. When off, the
  // modal renders its legacy UI and backend ignores any restock_flag /
  // reason_code_id values we might send.
  const perLineRestockOn = !!posFlags?.phase2g_per_line_restock;
  // Bucket F: tenant opts into offline refund queueing separately from
  // offline sales (some retailers want offline sales but require refund
  // audit trail to be live).
  const offlineReturnsOn = !!posFlags?.offline_returns;

  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [saleLoading, setSaleLoading] = useState(false);
  const [resolvedSale, setResolvedSale] = useState(null);
  const [returnItems, setReturnItems] = useState([]);
  const [returnQtys, setReturnQtys] = useState({});
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("refund");

  // Phase 2: Return policy fields
  const [returnReasons, setReturnReasons] = useState([]);
  const [selectedReasonId, setSelectedReasonId] = useState("");
  const [policyQuote, setPolicyQuote] = useState(null);
  const [showApproval, setShowApproval] = useState(false);
  const [approvalEventId, setApprovalEventId] = useState(null);

  // 2-G.7: per-line restock + per-line reason override, keyed by product_id.
  // Defaults populated when items load. When the flag is off these states
  // remain empty and are ignored at submit time.
  const [lineRestock, setLineRestock] = useState({});
  const [lineReasonId, setLineReasonId] = useState({});

  // 2-G.7 fold-in: serial picker state. `saleSerials` is the full list of
  // serials tied to the original sale (fetched once on load). `lineSerialIds`
  // stores the chosen serial ids per product_id.
  const [saleSerials, setSaleSerials] = useState([]);
  const [lineSerialIds, setLineSerialIds] = useState({});

  useEffect(() => {
    api.get("/api/return-reasons").then(r => setReturnReasons(r.reasons || [])).catch(() => {});
  }, []);

  // Separate search state for no-bill return items vs exchange replacement items
  const [returnSearch, setReturnSearch] = useState("");
  const [returnSearchResults, setReturnSearchResults] = useState([]);
  const [returnSearching, setReturnSearching] = useState(false);
  const [exSearch, setExSearch] = useState("");
  const [exResults, setExResults] = useState([]);
  const [exSearching, setExSearching] = useState(false);
  const [exchangeItems, setExchangeItems] = useState([]);

  const [settleMethod, setSettleMethod] = useState("Cash");
  const [exDiscountInput, setExDiscountInput] = useState("");
  const [exDiscountType, setExDiscountType] = useState("fixed");
  const [submitting, setSubmitting] = useState(false);

  // 2-G.17: refund threshold manager-PIN prompt state. Triggered when
  // /api/returns responds with { code: "manager_pin_required", threshold }.
  const [thresholdPrompt, setThresholdPrompt] = useState(null); // { threshold, refundAmount, retry: (pin) => Promise }
  const [thresholdError, setThresholdError] = useState("");
  const [thresholdSubmitting, setThresholdSubmitting] = useState(false);

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
      setExDiscountInput("");
      setExDiscountType("fixed");
      setLineRestock({});
      setLineReasonId({});
      setSaleSerials([]);
      setLineSerialIds({});
    } else if (returnSourceSale) {
      loadSaleDetail(returnSourceSale.id);
    }
  }, [returnModalOpen, returnSourceSale]);

  const loadSaleDetail = async (saleId) => {
    setSaleLoading(true);
    try {
      const data = await api.get(`/api/sales/${saleId}`);
      setResolvedSale(data.sale);
      // F3 (Apr 28 2026): cap maxQty by sold − already-refunded so the
      // stepper, "of N" badge, and Process Refund button all reflect what's
      // actually still refundable on this sale. Items already fully refunded
      // (remaining = 0) are filtered out — there's nothing to do with them
      // here. Backend (F1) also rejects over-refund as a defence-in-depth.
      const items = (data.items || [])
        .map((i) => ({
          product_id: i.product_id,
          variant_id: i.variant_id || null,
          name: i.product_name || "Item",
          price: Number(i.price_at_sale || 0),
          maxQty: Math.max(
            0,
            Number(i.quantity || 1) - Number(i.refunded_qty || 0),
          ),
        }))
        .filter((i) => i.maxQty > 0);
      setReturnItems(items);
      const defaultQtys = {};
      const defaultRestock = {};
      items.forEach((i) => {
        defaultQtys[i.product_id] = i.maxQty;
        defaultRestock[i.product_id] = true; // 2-G.7: default ON
      });
      setReturnQtys(defaultQtys);
      setLineRestock(defaultRestock);
      setLineReasonId({});
      setLineSerialIds({});

      // 2-G.7 fold-in: fetch serials sold on this invoice so the cashier can
      // pick the specific unit(s) being returned. Silent-fail on 404/500
      // (older sales may not have any serials, or the serials endpoint may
      // return empty on tenants without serialized inventory enabled).
      try {
        const serialData = await api.get(`/api/sales/${saleId}/serials`);
        setSaleSerials(serialData.serials || []);
      } catch {
        setSaleSerials([]);
      }
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

  // 2-G.11: exact-match by-barcode lookup. Used by the scanner listener when
  // the cashier scans a printed receipt CODE128.
  const loadSaleByBarcode = useCallback(async (code) => {
    if (!code) return;
    setInvoiceSearch(code);
    setSaleLoading(true);
    try {
      const data = await api.get(`/api/sales/by-barcode/${encodeURIComponent(code)}`);
      const saleId = data.sale?.id;
      if (!saleId) throw new Error("Invoice not found");
      await loadSaleDetail(saleId);
    } catch (e) {
      setError(e.message || "Invoice not found");
      setSaleLoading(false);
    }
  }, []);

  // 2-G.11: scanner listener — 100ms inter-key buffer, fires on Enter when
  // the modal is open and no sale is resolved yet. Ignores keystrokes while
  // focus is already in an input/textarea so manual typing still works.
  const scanBufferRef = useRef("");
  const scanLastKeyRef = useRef(0);
  useEffect(() => {
    if (!returnModalOpen || resolvedSale) return;
    const handler = (ev) => {
      const target = ev.target;
      const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const now = Date.now();
      if (now - scanLastKeyRef.current > 100) scanBufferRef.current = "";
      scanLastKeyRef.current = now;
      if (ev.key === "Enter") {
        const code = scanBufferRef.current;
        scanBufferRef.current = "";
        if (!isTyping && code.length >= 3) {
          ev.preventDefault();
          loadSaleByBarcode(code);
        }
        return;
      }
      if (ev.key.length === 1) scanBufferRef.current += ev.key;
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [returnModalOpen, resolvedSale, loadSaleByBarcode]);

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
  const settlement = exchangeSettlement({
    refundTotal,
    exchangeTotal,
    discountInput: canDiscount ? exDiscountInput : "",
    discountType: exDiscountType,
    settleMethod,
  });
  const { balance, discount: exDiscount, due: exDue } = settlement;

  const handleComplete = async () => {
    const selectedItems = returnItems
      .filter((i) => Number(returnQtys[i.product_id] || 0) > 0)
      .map((i) => {
        const base = {
          product_id: i.product_id,
          variant_id: i.variant_id || null,
          quantity: Number(returnQtys[i.product_id]),
          refund_price: i.price,
        };
        // 2-G.7: only attach per-line restock + reason when the feature is on.
        // Backend ignores these fields when the flag is off, but not sending
        // them avoids misleading payloads in request logs.
        if (perLineRestockOn) {
          const restock = lineRestock[i.product_id] !== false;
          base.restock_flag = restock;
          const reasonId = lineReasonId[i.product_id]
            || (selectedReasonId ? Number(selectedReasonId) : null);
          if (reasonId) base.reason_code_id = Number(reasonId);
        }
        // 2-G.7 fold-in: attach chosen serial ids so backend flips their
        // status from sold → returned.
        const serials = lineSerialIds[i.product_id];
        if (Array.isArray(serials) && serials.length > 0) {
          base.serials = serials;
        }
        return base;
      });

    // 2-G.7: client-side guard matching the backend — scrapped lines require
    // a reason. Surface the error before we hit the API round-trip.
    if (perLineRestockOn) {
      for (const it of selectedItems) {
        if (it.restock_flag === false && !it.reason_code_id) {
          setError("Every scrapped item needs a reason code. Pick one per line (or set the header reason).");
          return;
        }
      }
    }

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
        // Return Credit covers the refund value; the customer pays the rest of
        // the balance after any discount (exchangeMath.js).
        salePayments = settlement.payments;

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
            discount_amount: settlement.saleDiscountAmount,
            discount_type: "fixed",
            notes: `Exchange for ${resolvedSale?.invoice_number || "return"}`
              + (exDiscount > 0 ? `; discount Rs ${exDiscount}` : ""),
          });
      }

      // POST return only after exchange sale succeeds (or if refund-only mode)
      if (selectedItems.length > 0) {
        // 2-G.15 Day 3: client-generated UUID prevents double-submit. Survives
        // manager-PIN retry via the same payload object; survives network
        // retry because the backend rejects the second POST with 409.
        const idempotencyKey =
          crypto?.randomUUID?.() || `ret-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const returnPayload = {
          original_sale_id: resolvedSale?.id || null,
          outlet_id: Number(selectedOutletId),
          employee_id: employee?.id || null,
          customer_id: null,
          total_refund: refundTotal,
          refund_method: mode === "exchange" ? "Return Credit" : settleMethod,
          reason: reason || null,
          items: selectedItems,
          // Phase 2 fields
          policy_id: policyQuote?.policy_id || null,
          return_reason_id: selectedReasonId ? Number(selectedReasonId) : null,
          processed_by_employee_id: employee?.id || null,
          approval_event_id: approvalEventId || null,
          // 2-G.15 Day 3 refund idempotency
          idempotency_key: idempotencyKey,
        };

        // Bucket F: offline refund queue. Only intercepts pure refund mode —
        // exchanges mutate stock on a new sale that requires the network to
        // validate inventory, so we keep those online-only. Gated by feature
        // flag so tenants without offline refund trust can stay online-only.
        if (
          mode !== "exchange" &&
          offlineReturnsOn &&
          typeof navigator !== "undefined" &&
          navigator.onLine === false &&
          typeof enqueueReturn === "function"
        ) {
          try {
            await enqueueReturn(returnPayload);
            showNotice?.("Refund queued offline — will sync when you're back online.");
            setReturnModalOpen(false);
            return;
          } catch (queueErr) {
            // Fall through to the online path — if the queue is full or IndexedDB
            // throws, the online POST will surface its own error.
            setError?.(queueErr.message || "Failed to queue refund");
            return;
          }
        }

        try {
          await api.post("/api/returns", returnPayload);
        } catch (err) {
          // 2-G.15 Day 3: duplicate return detected server-side. Show the
          // collision modal with the existing return ref and abort this
          // transaction — the caller already has a refund recorded.
          if (err.status === 409 && err.body?.code === "duplicate_return") {
            if (typeof setCollisionModal === "function") {
              setCollisionModal({ existing: err.body.existing });
            }
            setReturnModalOpen(false);
            return;
          }
          // 2-G.17: if the server requires a manager PIN, surface the prompt
          // and wait for the user to submit one. The resolve/reject of this
          // promise controls whether the surrounding try block continues.
          if (err.body?.code === "manager_pin_required") {
            await new Promise((resolve, reject) => {
              setThresholdError("");
              setThresholdPrompt({
                threshold: err.body?.threshold,
                refundAmount: refundTotal,
                retry: async (pin) => {
                  setThresholdSubmitting(true);
                  setThresholdError("");
                  try {
                    await api.post("/api/returns", { ...returnPayload, manager_pin: pin });
                    setThresholdPrompt(null);
                    setThresholdSubmitting(false);
                    resolve();
                  } catch (retryErr) {
                    setThresholdSubmitting(false);
                    // Only re-prompt for PIN-related errors — other errors
                    // abort the whole flow.
                    if (retryErr.body?.code === "manager_pin_required") {
                      setThresholdError("Invalid manager PIN");
                      return; // stay in the modal
                    }
                    setThresholdPrompt(null);
                    reject(retryErr);
                  }
                },
                cancel: () => {
                  setThresholdPrompt(null);
                  setThresholdSubmitting(false);
                  reject(new Error("Refund cancelled"));
                },
              });
            });
          } else {
            throw err;
          }
        }
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
          balanceDue: balance > 0 ? exDue : balance,
          exchangeDiscount: exDiscount,
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
      <div className="bg-(--ui-surface) rounded-xl shadow-(--ui-shadow-lg) w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-(--ui-border-strong) shrink-0">
          <h2 className="font-semibold text-(--ui-text)">Return / Exchange</h2>
          <button onClick={() => setReturnModalOpen(false)} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {!resolvedSale && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-(--ui-text)">Do you have the original bill?</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
                  placeholder="Enter invoice number (e.g. INV-2026-00042)"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchInvoice()}
                />
                <button
                  onClick={searchInvoice}
                  disabled={saleLoading}
                  className="px-4 py-2 bg-(--ui-primary) text-white text-sm rounded-lg hover:bg-(--ui-primary-strong) disabled:opacity-50"
                >
                  {saleLoading ? "..." : "Find Bill"}
                </button>
              </div>
              <p className="text-xs text-(--ui-text-muted)">— or —</p>
              <button
                onClick={() => {
                  setResolvedSale({ id: null, invoice_number: "No Bill" });
                  setReturnItems([]);
                  setReturnQtys({});
                }}
                className="text-sm text-(--ui-danger-fg) underline hover:text-(--ui-danger-fg)"
              >
                Continue without a bill (manual return)
              </button>
            </div>
          )}

          {resolvedSale && returnItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase text-(--ui-text-muted)">
                  Return Items from {resolvedSale.invoice_number}
                </p>
                {perLineRestockOn && (
                  <div className="flex gap-1 text-xs">
                    <button
                      onClick={() => setLineRestock(Object.fromEntries(returnItems.map((i) => [i.product_id, true])))}
                      className="px-2 py-1 rounded border border-(--ui-border-strong) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                    >
                      All Restock ON
                    </button>
                    <button
                      onClick={() => setLineRestock(Object.fromEntries(returnItems.map((i) => [i.product_id, false])))}
                      className="px-2 py-1 rounded border border-(--ui-warning-fg)/30 text-(--ui-warning-fg) hover:bg-(--ui-warning-bg)"
                    >
                      All Restock OFF
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {returnItems.map((item) => {
                  const restock = lineRestock[item.product_id] !== false;
                  const itemSerials = saleSerials.filter((s) => s.product_id === item.product_id);
                  const chosenSerials = lineSerialIds[item.product_id] || [];
                  return (
                    <div
                      key={item.product_id}
                      className={`p-2 border rounded-lg ${perLineRestockOn && !restock ? "border-(--ui-warning-fg)/30 bg-(--ui-warning-bg)" : "border-(--ui-border)"}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-(--ui-text) truncate">{item.name}</p>
                          <p className="text-xs text-(--ui-text-muted)">{money(item.price)} each</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setReturnQtys((q) => ({ ...q, [item.product_id]: Math.max(0, (q[item.product_id] || 0) - 1) }))}
                            className="w-6 h-6 rounded border border-(--ui-border-strong) flex items-center justify-center text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="w-6 text-center text-sm font-medium">{returnQtys[item.product_id] || 0}</span>
                          <button
                            onClick={() => setReturnQtys((q) => ({ ...q, [item.product_id]: Math.min(item.maxQty, (q[item.product_id] || 0) + 1) }))}
                            className="w-6 h-6 rounded border border-(--ui-border-strong) flex items-center justify-center text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                          >
                            <Plus size={12} />
                          </button>
                          <span className="text-xs text-(--ui-text-muted) w-12 text-right">of {item.maxQty}</span>
                        </div>
                      </div>

                      {perLineRestockOn && (
                        <div className="mt-2 flex items-center gap-3 flex-wrap">
                          <label className="flex items-center gap-1.5 text-xs text-(--ui-text-muted) cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={restock}
                              onChange={(e) => setLineRestock((m) => ({ ...m, [item.product_id]: e.target.checked }))}
                              className="accent-(--ui-primary)"
                            />
                            Restock
                          </label>
                          <select
                            value={lineReasonId[item.product_id] || ""}
                            onChange={(e) => setLineReasonId((m) => ({ ...m, [item.product_id]: e.target.value ? Number(e.target.value) : null }))}
                            className="flex-1 min-w-35 text-xs border border-(--ui-border-strong) rounded px-2 py-1 bg-(--ui-surface) focus:outline-none focus:ring-1 focus:ring-(--ui-focus)"
                          >
                            <option value="">Reason (defaults to header)</option>
                            {returnReasons.map((r) => (
                              <option key={r.id} value={r.id}>{r.label}</option>
                            ))}
                          </select>
                          {!restock && (
                            <span
                              title="This item will be scrapped (logged for shrinkage)"
                              className="flex items-center gap-1 text-xs text-(--ui-warning-fg)"
                            >
                              <AlertTriangle size={12} /> Scrap
                            </span>
                          )}
                        </div>
                      )}

                      {itemSerials.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-(--ui-text-muted) mb-1">Serial numbers on this invoice:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {itemSerials.map((s) => {
                              const active = chosenSerials.includes(s.id);
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => setLineSerialIds((m) => {
                                    const current = m[item.product_id] || [];
                                    return {
                                      ...m,
                                      [item.product_id]: active
                                        ? current.filter((id) => id !== s.id)
                                        : [...current, s.id],
                                    };
                                  })}
                                  className={`px-2 py-0.5 rounded text-xs border transition ${
                                    active
                                      ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                                      : "border-(--ui-border-strong) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                                  }`}
                                >
                                  {s.serial_number}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {resolvedSale && resolvedSale.id === null && (
            <div>
              <p className="text-xs font-semibold uppercase text-(--ui-text-muted) mb-2">Add Items to Return</p>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-2.5 text-(--ui-text-muted) pointer-events-none" />
                <input
                  className="w-full pl-8 pr-3 py-2 text-sm border border-(--ui-border-strong) rounded-lg focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
                  placeholder={returnSearching ? "Searching..." : "Search product to return"}
                  value={returnSearch}
                  onChange={(e) => setReturnSearch(e.target.value)}
                />
              </div>
              {returnSearchResults.length > 0 && (
                <div className="border border-(--ui-border-strong) rounded-lg overflow-hidden mb-2 max-h-40 overflow-y-auto">
                  {returnSearchResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addReturnItem(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-(--ui-muted-surface) border-b border-(--ui-border) last:border-0"
                    >
                      {p.name} — {money(p.price)}
                    </button>
                  ))}
                </div>
              )}
              {returnItems.length > 0 && (
                <div className="space-y-1">
                  {returnItems.map((item) => (
                    <div key={item.product_id} className="flex items-center justify-between gap-3 p-2 border border-(--ui-border) rounded-lg">
                      <p className="text-sm flex-1 text-(--ui-text)">{item.name}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setReturnQtys((q) => ({ ...q, [item.product_id]: Math.max(1, (q[item.product_id] || 1) - 1) }))} className="w-6 h-6 rounded border border-(--ui-border-strong) flex items-center justify-center text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"><Minus size={12} /></button>
                        <span className="w-6 text-center text-sm">{returnQtys[item.product_id] || 1}</span>
                        <button onClick={() => setReturnQtys((q) => ({ ...q, [item.product_id]: (q[item.product_id] || 1) + 1 }))} className="w-6 h-6 rounded border border-(--ui-border-strong) flex items-center justify-center text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"><Plus size={12} /></button>
                        <button onClick={() => { setReturnItems((p) => p.filter((i) => i.product_id !== item.product_id)); }} className="text-(--ui-text-muted) hover:text-(--ui-danger-fg) ml-1"><X size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {resolvedSale && (
            <div>
              <label className="text-xs text-(--ui-text-muted) mb-1 block">Reason (optional)</label>
              <input
                className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
                placeholder="Damaged, wrong item, etc."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          {resolvedSale && (
            <div>
              <p className="text-xs font-semibold uppercase text-(--ui-text-muted) mb-2">What does the customer want?</p>
              <div className="flex gap-2">
                {["refund", "exchange"].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition ${
                      mode === m
                        ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                        : "border-(--ui-border-strong) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
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
              <p className="text-xs font-semibold uppercase text-(--ui-text-muted) mb-2">Add Replacement Items</p>
              <div className="relative mb-2">
                <ShoppingCart size={13} className="absolute left-2.5 top-2.5 text-(--ui-text-muted) pointer-events-none" />
                <input
                  className="w-full pl-8 pr-3 py-2 text-sm border border-(--ui-border-strong) rounded-lg focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
                  placeholder={exSearching ? "Searching..." : "Search product to exchange for"}
                  value={exSearch}
                  onChange={(e) => setExSearch(e.target.value)}
                />
              </div>
              {exResults.length > 0 && (
                <div className="border border-(--ui-border-strong) rounded-lg overflow-hidden mb-2 max-h-40 overflow-y-auto">
                  {exResults.map((p) => (
                    <button
                      key={p.variant_id || p.id}
                      onClick={() => addExchangeItem(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-(--ui-muted-surface) border-b border-(--ui-border) last:border-0"
                    >
                      {p.name} — {money(p.price)}
                    </button>
                  ))}
                </div>
              )}
              {exchangeItems.length > 0 && (
                <div className="space-y-1 mt-2">
                  {exchangeItems.map((item) => (
                    <div key={item.variant_id || item.id} className="flex items-center justify-between gap-3 p-2 border border-(--ui-border) rounded-lg">
                      <p className="text-sm flex-1 text-(--ui-text)">{item.name}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setExchangeItems((p) => p.map((i) => (i.variant_id || i.id) === (item.variant_id || item.id) ? { ...i, qty: Math.max(1, i.qty - 1) } : i))} className="w-6 h-6 rounded border border-(--ui-border-strong) flex items-center justify-center text-(--ui-text-muted)"><Minus size={12} /></button>
                        <span className="w-6 text-center text-sm">{item.qty}</span>
                        <button onClick={() => setExchangeItems((p) => p.map((i) => (i.variant_id || i.id) === (item.variant_id || item.id) ? { ...i, qty: i.qty + 1 } : i))} className="w-6 h-6 rounded border border-(--ui-border-strong) flex items-center justify-center text-(--ui-text-muted)"><Plus size={12} /></button>
                        <button onClick={() => setExchangeItems((p) => p.filter((i) => (i.variant_id || i.id) !== (item.variant_id || item.id)))} className="text-(--ui-text-muted) hover:text-(--ui-danger-fg) ml-1"><X size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {resolvedSale && (
            <div className="border-t border-(--ui-border) pt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-(--ui-text-muted)">Return value</span>
                <span className="font-medium text-(--ui-danger-fg)">− {money(refundTotal)}</span>
              </div>
              {mode === "exchange" && (
                <div className="flex justify-between text-sm">
                  <span className="text-(--ui-text-muted)">Exchange items</span>
                  <span className="font-medium text-(--ui-text)">{money(exchangeTotal)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold border-t border-(--ui-border) pt-2">
                <span>
                  {balance > 0 ? "Customer pays" : balance < 0 ? "Refund to customer" : "Even exchange"}
                </span>
                <span
                  data-testid="exchange-due"
                  className={balance > 0 ? "text-(--ui-success-fg)" : balance < 0 ? "text-(--ui-danger-fg)" : "text-(--ui-text-muted)"}
                >
                  {balance > 0 ? money(exDue) : balance === 0 ? money(0) : money(Math.abs(balance))}
                </span>
              </div>

              {mode === "exchange" && balance > 0 && canDiscount && (
                <div>
                  <label htmlFor="exchange-discount" className="text-xs text-(--ui-text-muted) mb-1 block">
                    Discount on balance ({money(balance)})
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      id="exchange-discount"
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={exDiscountInput}
                      onChange={(e) => setExDiscountInput(e.target.value)}
                      placeholder="0"
                      className="w-28 px-3 py-1.5 text-sm border border-(--ui-border-strong) rounded-lg focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
                    />
                    {[["fixed", "Rs"], ["percent", "%"]].map(([t, label]) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setExDiscountType(t)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                          exDiscountType === t
                            ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                            : "border-(--ui-border-strong) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    {exDiscount > 0 && (
                      <span className="text-xs text-(--ui-text-muted)">− {money(exDiscount)}</span>
                    )}
                  </div>
                </div>
              )}

              {(mode === "refund" || (mode === "exchange" && balance < 0)) && (
                <div>
                  <p className="text-xs text-(--ui-text-muted) mb-1">Refund method</p>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      "Cash",
                      "Card",
                      "Wallet",
                      "Store Credit",
                      // Tier 0.1 wholesale — only valid when the original sale
                      // was a Credit-tender sale (sales.customer_invoice_id
                      // set by v88). Reduces the linked A/R invoice's
                      // balance_due instead of paying the buyer back.
                      ...(resolvedSale?.customer_invoice_id ? ["credit_reversal"] : []),
                    ].map((m) => (
                      <button
                        key={m}
                        onClick={() => setSettleMethod(m)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                          settleMethod === m
                            ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                            : "border-(--ui-border-strong) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                        }`}
                      >
                        {m === "credit_reversal" ? "Reduce A/R" : m}
                      </button>
                    ))}
                  </div>
                  {settleMethod === "credit_reversal" && (
                    <p className="mt-1.5 text-[11px] text-(--ui-text-muted)">
                      Refund will reduce the buyer's outstanding A/R balance
                      on the original on-account invoice — no cash leaves the
                      drawer.
                    </p>
                  )}
                </div>
              )}

              {mode === "exchange" && balance > 0 && exDue > 0 && (
                <div>
                  <p className="text-xs text-(--ui-text-muted) mb-1">Customer pays via</p>
                  <div className="flex gap-2">
                    {["Cash", "Card", "Wallet"].map((m) => (
                      <button
                        key={m}
                        onClick={() => setSettleMethod(m)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                          settleMethod === m
                            ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                            : "border-(--ui-border-strong) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
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
          <div className="flex gap-2 px-5 py-3 border-t border-(--ui-border-strong) shrink-0">
            <button
              onClick={() => setReturnModalOpen(false)}
              className="flex-1 py-2 rounded-lg border border-(--ui-border-strong) text-sm text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
            >
              Cancel
            </button>
            <button
              onClick={handleComplete}
              disabled={submitting}
              className="flex-1 py-2 rounded-lg bg-(--ui-primary) text-white text-sm font-medium hover:bg-(--ui-primary-strong) disabled:opacity-50"
            >
              {submitting ? "Processing..." : mode === "exchange" ? "Complete Exchange" : "Process Refund"}
            </button>
          </div>
        )}
      </div>

      <POSRefundThresholdModal
        open={!!thresholdPrompt}
        threshold={thresholdPrompt?.threshold}
        refundAmount={thresholdPrompt?.refundAmount || 0}
        error={thresholdError}
        loading={thresholdSubmitting}
        onSubmit={(pin) => thresholdPrompt?.retry?.(pin)}
        onClose={() => thresholdPrompt?.cancel?.()}
      />
    </div>
  );
}
