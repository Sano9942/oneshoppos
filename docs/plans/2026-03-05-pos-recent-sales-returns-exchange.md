# POS Recent Sales Panel + Return/Exchange Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Recent Sales" panel and a "Return/Exchange" modal directly inside the POS screen, with no page navigation required.

**Architecture:** Two new modal components (`POSRecentSalesPanel.jsx`, `POSReturnExchangeModal.jsx`) added to `pos/`, wired into `POSContext.jsx` for state and `POSHeader.jsx` for entry points. No backend changes needed — uses existing `/api/sales`, `/api/returns`, `/api/sales` (POST), and `/api/products/search` endpoints.

**Tech Stack:** React 19, Tailwind CSS v4 (`(--css-var)` syntax), lucide-react icons, existing `usePOS()` context hook.

---

## Task 1: Add Recent Sales state + fetch to POSContext

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

**Step 1: Add state variables** after the `slip`/`slipOpen` block (around line 97):

```jsx
// ── Recent Sales Panel ────────────────────────────────────────────────────
const [recentSalesOpen, setRecentSalesOpen] = useState(false);
const [recentSales, setRecentSales] = useState([]);
const [recentSalesLoading, setRecentSalesLoading] = useState(false);
const [recentSalesSearch, setRecentSalesSearch] = useState("");
```

**Step 2: Add fetch function** after `loadParked` (around line 215):

```jsx
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
```

**Step 3: Export all new values** — add to the `value` object (near the end of the file, around line 722):

```jsx
recentSalesOpen,
setRecentSalesOpen,
recentSales,
recentSalesLoading,
recentSalesSearch,
setRecentSalesSearch,
loadRecentSales,
```

**Step 4: Verify** — open POS in browser, no console errors.

**Step 5: Commit**
```bash
git add frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat(pos): add recent sales state and fetch to POSContext"
```

---

## Task 2: Add Return/Exchange state to POSContext

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

**Step 1: Add state variables** after the recent sales block:

```jsx
// ── Return / Exchange Modal ───────────────────────────────────────────────
const [returnModalOpen, setReturnModalOpen] = useState(false);
// Pre-loaded sale when opened from Recent Sales panel (null = no-bill mode)
const [returnSourceSale, setReturnSourceSale] = useState(null);
```

**Step 2: Add helper to open return modal from a sale row:**

```jsx
const openReturnFromSale = (sale) => {
  setReturnSourceSale(sale);
  setReturnModalOpen(true);
  setRecentSalesOpen(false); // close panel when opening return
};
```

**Step 3: Export:**

```jsx
returnModalOpen,
setReturnModalOpen,
returnSourceSale,
setReturnSourceSale,
openReturnFromSale,
```

**Step 4: Commit**
```bash
git add frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat(pos): add return/exchange modal state to POSContext"
```

---

## Task 3: Update POSHeader with two new buttons

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSHeader.jsx`

**Step 1: Update imports** — add `History`, `RotateCcw` from lucide-react:

```jsx
import { Store, ArrowLeft, FileText, Lock, LogOut, History, RotateCcw } from "lucide-react";
```

**Step 2: Pull new values from context:**

```jsx
const {
  // ...existing...
  recentSalesOpen,
  setRecentSalesOpen,
  loadRecentSales,
  setReturnModalOpen,
  setReturnSourceSale,
  selectedOutletId,
} = usePOS();
```

**Step 3: Add two buttons** after the "Last Receipt" button (after line 60) and before "Close Shift":

```jsx
{selectedOutletId && (
  <button
    onClick={() => { loadRecentSales(); setRecentSalesOpen(true); }}
    className="flex items-center gap-1 text-slate-500 hover:text-violet-700 font-medium transition text-sm"
  >
    <History size={14} /> Recent Sales
  </button>
)}
{selectedOutletId && (
  <button
    onClick={() => { setReturnSourceSale(null); setReturnModalOpen(true); }}
    className="flex items-center gap-1 text-slate-500 hover:text-rose-600 font-medium transition text-sm"
  >
    <RotateCcw size={14} /> Return
  </button>
)}
```

**Step 4: Verify** — two new buttons appear in POS header when a branch is selected.

**Step 5: Commit**
```bash
git add frontend/src/pages/redesign/pos/POSHeader.jsx
git commit -m "feat(pos): add Recent Sales and Return buttons to POS header"
```

---

## Task 4: Build POSRecentSalesPanel

**Files:**
- Create: `frontend/src/pages/redesign/pos/POSRecentSalesPanel.jsx`

**Full component:**

```jsx
import React, { useMemo } from "react";
import { X, Printer, RotateCcw, Search } from "lucide-react";
import { usePOS } from "./POSContext";

function money(n) {
  return `PKRs ${Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function POSRecentSalesPanel() {
  const {
    recentSalesOpen,
    setRecentSalesOpen,
    recentSales,
    recentSalesLoading,
    recentSalesSearch,
    setRecentSalesSearch,
    printSlip,
    openReturnFromSale,
    outlets,
    selectedOutletId,
    employee,
    authHeaders,
  } = usePOS();

  if (!recentSalesOpen) return null;

  const filtered = useMemo(() => {
    const q = recentSalesSearch.trim().toLowerCase();
    if (!q) return recentSales;
    return recentSales.filter(
      (s) =>
        String(s.invoice_number || "").toLowerCase().includes(q) ||
        String(s.customer_name || "").toLowerCase().includes(q),
    );
  }, [recentSales, recentSalesSearch]);

  const handleReprint = (sale) => {
    // Reconstruct slip shape expected by printSlip()
    const slip = {
      saleId: sale.id,
      invoiceNumber: sale.invoice_number || String(sale.id),
      cart: (sale.items || []).map((i) => ({
        name: i.product_name || i.name || "Item",
        quantity: i.quantity,
        price: i.price_at_sale,
      })),
      payments: (sale.payments || []).map((p) => ({
        method: p.payment_method,
        amount: p.amount,
      })),
      total: sale.total_amount,
      change: 0,
      customer: sale.customer_name ? { name: sale.customer_name, mobile: sale.customer_mobile || "" } : null,
      outlet: outlets.find((o) => String(o.id) === String(selectedOutletId)) || null,
      employee: sale.employee_name ? { name: sale.employee_name } : (employee || null),
      discountAmount: sale.discount_amount || 0,
      discountType: sale.discount_type || "fixed",
      timestamp: new Date(sale.created_at || sale.timestamp || Date.now()).toLocaleString(),
    };
    printSlip(slip);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => setRecentSalesOpen(false)}
      />
      {/* Panel */}
      <div className="relative flex flex-col bg-white w-full max-w-md shadow-2xl h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <h2 className="font-semibold text-slate-800 text-sm">Recent Sales — Today</h2>
          <button onClick={() => setRecentSalesOpen(false)} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-300"
              placeholder="Search invoice # or customer"
              value={recentSalesSearch}
              onChange={(e) => setRecentSalesSearch(e.target.value)}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {recentSalesLoading && (
            <p className="p-6 text-center text-sm text-slate-400">Loading...</p>
          )}
          {!recentSalesLoading && filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-400">No sales found for today.</p>
          )}
          {!recentSalesLoading && filtered.map((sale) => (
            <div
              key={sale.id}
              className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {sale.invoice_number || `#${sale.id}`}
                </p>
                <p className="text-xs text-slate-400">
                  {sale.customer_name || "Walk-in"} · {money(sale.total_amount)}
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(sale.created_at || Date.now()).toLocaleTimeString()}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => handleReprint(sale)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                >
                  <Printer size={12} /> Reprint
                </button>
                <button
                  onClick={() => openReturnFromSale(sale)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  <RotateCcw size={12} /> Return
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Note on reprint:** The panel uses `sale.items` and `sale.payments` sub-arrays. The existing `GET /api/sales` list endpoint does NOT return items/payments. For reprint to work fully, clicking Reprint should fetch `GET /api/sales/:id` first to get the full sale detail. Update `handleReprint` to do this:

```jsx
const handleReprint = async (sale) => {
  try {
    const res = await fetch(`${API_BASE}/api/sales/${sale.id}`, { headers: authHeaders() });
    const data = await res.json();
    const s = data.sale;
    const slip = {
      saleId: s.id,
      invoiceNumber: s.invoice_number || String(s.id),
      cart: (data.items || []).map((i) => ({
        name: i.product_name || "Item",
        quantity: i.quantity,
        price: i.price_at_sale,
      })),
      payments: (data.payments || []).map((p) => ({
        method: p.payment_method,
        amount: p.amount,
      })),
      total: s.total_amount,
      change: 0,
      customer: s.customer_name ? { name: s.customer_name, mobile: "" } : null,
      outlet: outlets.find((o) => String(o.id) === String(selectedOutletId)) || null,
      employee: s.employee_name ? { name: s.employee_name } : (employee || null),
      discountAmount: s.discount_amount || 0,
      discountType: s.discount_type || "fixed",
      timestamp: new Date(s.created_at || Date.now()).toLocaleString(),
    };
    printSlip(slip);
  } catch {
    // fallback: print with what we have from list
  }
};
```

Add `import { API_BASE as API } from "../../../config";` at top.

**Step 2: Mount in POSRedesign** — open `POSRedesign.jsx`, import and add `<POSRecentSalesPanel />` inside the POSContext provider alongside the other modals.

**Step 3: Verify** — click "Recent Sales" in header, panel slides in from right, shows today's sales, search filters work, Reprint opens print window.

**Step 4: Commit**
```bash
git add frontend/src/pages/redesign/pos/POSRecentSalesPanel.jsx frontend/src/pages/redesign/POSRedesign.jsx
git commit -m "feat(pos): add Recent Sales slide-in panel with reprint"
```

---

## Task 5: Build POSReturnExchangeModal — Step 1 (item selection)

**Files:**
- Create: `frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx`

This is the largest component. Build it in logical steps.

**Full component structure** (implement in one file, all steps below):

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { X, Search, Plus, Minus, RotateCcw, ShoppingCart } from "lucide-react";
import { API_BASE as API } from "../../../config";
import { usePOS } from "./POSContext";

function money(n) {
  return `PKRs ${Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Step 1: Item selection screen ───────────────────────────────────────────
// returnSourceSale = full sale object (with items array) OR null (no-bill mode)
// returnItems = [{product_id, name, quantity, price, maxQty}]
// returnQtys = {[product_id]: qty}

// ─── Step 2: Mode selection + exchange product search ────────────────────────
// mode = "refund" | "exchange"
// exchangeItems = [{id, name, quantity, price}]

// ─── Step 3: Settlement screen ───────────────────────────────────────────────
// refundTotal = sum(returnItem.price * returnQty)
// exchangeTotal = sum(exchangeItem.price * exchangeItem.quantity)
// balance = exchangeTotal - refundTotal
//   > 0 → customer owes PKRs balance (collect payment)
//   < 0 → refund PKRs |balance| to customer (pay out or store credit)
//   = 0 → even exchange

export default function POSReturnExchangeModal() {
  const {
    returnModalOpen,
    setReturnModalOpen,
    returnSourceSale,
    selectedOutletId,
    employee,
    authHeaders,
    customers,
    printSlip,
    outlets,
    showNotice,
    setError,
  } = usePOS();

  // ── Internal step state ────────────────────────────────────────────────────
  const [step, setStep] = useState(1); // 1=items, 2=mode+exchange, 3=settle
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [saleLoading, setSaleLoading] = useState(false);
  const [resolvedSale, setResolvedSale] = useState(null); // fetched sale detail
  const [returnItems, setReturnItems] = useState([]); // items available to return
  const [returnQtys, setReturnQtys] = useState({});   // selected return quantities
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("refund"); // "refund" | "exchange"

  // Exchange product search
  const [exSearch, setExSearch] = useState("");
  const [exResults, setExResults] = useState([]);
  const [exSearching, setExSearching] = useState(false);
  const [exchangeItems, setExchangeItems] = useState([]); // [{id, name, qty, price}]

  // Settlement
  const [settleMethod, setSettleMethod] = useState("Cash"); // Cash/Card/Wallet/StoreCredit
  const [customerId, setCustomerId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Reset when modal opens/closes ─────────────────────────────────────────
  useEffect(() => {
    if (!returnModalOpen) {
      setStep(1);
      setInvoiceSearch("");
      setResolvedSale(null);
      setReturnItems([]);
      setReturnQtys({});
      setReason("");
      setMode("refund");
      setExSearch("");
      setExResults([]);
      setExchangeItems([]);
      setSettleMethod("Cash");
      setCustomerId("");
    } else if (returnSourceSale) {
      // Pre-load from Recent Sales panel
      loadSaleDetail(returnSourceSale.id);
    }
  }, [returnModalOpen]);

  // ── Load sale detail by ID ─────────────────────────────────────────────────
  const loadSaleDetail = async (saleId) => {
    setSaleLoading(true);
    try {
      const res = await fetch(`${API}/api/sales/${saleId}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sale not found");
      setResolvedSale(data.sale);
      const items = (data.items || []).map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id || null,
        name: i.product_name || "Item",
        price: Number(i.price_at_sale || 0),
        maxQty: Number(i.quantity || 1),
      }));
      setReturnItems(items);
      // Default: select all at max qty
      const defaultQtys = {};
      items.forEach((i) => { defaultQtys[i.product_id] = i.maxQty; });
      setReturnQtys(defaultQtys);
    } catch (e) {
      setError(e.message || "Failed to load sale");
    } finally {
      setSaleLoading(false);
    }
  };

  // ── Search invoice by number ───────────────────────────────────────────────
  const searchInvoice = async () => {
    if (!invoiceSearch.trim()) return;
    setSaleLoading(true);
    try {
      const res = await fetch(
        `${API}/api/sales?search=${encodeURIComponent(invoiceSearch.trim())}&limit=5`,
        { headers: authHeaders() },
      );
      const data = await res.json();
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

  // ── Exchange product search ────────────────────────────────────────────────
  const searchExProducts = useCallback(async (q) => {
    if (!q.trim() || !selectedOutletId) return;
    setExSearching(true);
    try {
      const res = await fetch(
        `${API}/api/products/search?query=${encodeURIComponent(q)}&outlet_id=${selectedOutletId}`,
        { headers: authHeaders() },
      );
      const data = await res.json();
      setExResults(data.products || data.results || []);
    } catch { setExResults([]); } finally { setExSearching(false); }
  }, [selectedOutletId, authHeaders]);

  useEffect(() => {
    const t = setTimeout(() => { if (exSearch) searchExProducts(exSearch); }, 350);
    return () => clearTimeout(t);
  }, [exSearch, searchExProducts]);

  const addExchangeItem = (p) => {
    setExchangeItems((prev) => {
      const existing = prev.find((i) => i.id === p.id);
      if (existing) return prev.map((i) => i.id === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { id: p.id, name: p.name, qty: 1, price: Number(p.price || 0) }];
    });
    setExSearch("");
    setExResults([]);
  };

  // ── Computed totals ────────────────────────────────────────────────────────
  const refundTotal = returnItems.reduce(
    (s, i) => s + i.price * Number(returnQtys[i.product_id] || 0),
    0,
  );
  const exchangeTotal = exchangeItems.reduce((s, i) => s + i.price * i.qty, 0);
  const balance = exchangeTotal - refundTotal; // >0 = customer pays, <0 = refund owed

  // ── Submit ────────────────────────────────────────────────────────────────
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

    setSubmitting(true);
    try {
      // 1. Post return (if any items selected)
      if (selectedItems.length > 0) {
        const retRes = await fetch(`${API}/api/returns`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            original_sale_id: resolvedSale?.id || null,
            outlet_id: Number(selectedOutletId),
            employee_id: employee?.id || null,
            customer_id: customerId ? Number(customerId) : null,
            total_refund: refundTotal,
            refund_method: balance >= 0 ? "Return Credit" : settleMethod,
            reason: reason || null,
            items: selectedItems,
          }),
        });
        const retData = await retRes.json();
        if (!retRes.ok) throw new Error(retData.error || "Return failed");
      }

      // 2. Post exchange sale (if exchange items exist)
      if (mode === "exchange" && exchangeItems.length > 0) {
        // refundTotal acts as a "Return Credit" payment toward the new sale
        const salePayments = [];
        if (refundTotal > 0) {
          salePayments.push({ method: "Return Credit", amount: refundTotal });
        }
        // If customer owes more, add their payment
        if (balance > 0) {
          salePayments.push({ method: settleMethod, amount: balance });
        }

        const saleRes = await fetch(`${API}/api/sales`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            cartItems: exchangeItems.map((i) => ({
              id: i.id,
              quantity: i.qty,
              price: i.price,
            })),
            payments: salePayments,
            outlet_id: Number(selectedOutletId),
            employee_id: employee?.id || null,
            customer_id: customerId ? Number(customerId) : null,
            discount_amount: 0,
            discount_type: "fixed",
            notes: `Exchange for ${resolvedSale?.invoice_number || "return"}`,
          }),
        });
        const saleData = await saleRes.json();
        if (!saleRes.ok) throw new Error(saleData.error || "Exchange sale failed");

        // Print exchange receipt
        printSlip({
          saleId: saleData.saleId,
          invoiceNumber: saleData.invoiceNumber || "-",
          cart: exchangeItems.map((i) => ({ name: i.name, quantity: i.qty, price: i.price })),
          payments: salePayments,
          total: exchangeTotal,
          change: balance < 0 ? Math.abs(balance) : 0,
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

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <h2 className="font-semibold text-slate-800">Return / Exchange</h2>
          <button onClick={() => setReturnModalOpen(false)} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── STEP 1: Invoice lookup or no-bill ─────────────────────── */}
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

          {/* ── STEP 1b: Item selection (with bill) ───────────────────── */}
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

          {/* ── STEP 1c: Manual no-bill item search ───────────────────── */}
          {resolvedSale && resolvedSale.id === null && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400 mb-2">Add Items to Return</p>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                  placeholder="Search product to return"
                  value={exSearch}
                  onChange={(e) => setExSearch(e.target.value)}
                />
              </div>
              {exResults.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-2 max-h-40 overflow-y-auto">
                  {exResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setReturnItems((prev) => {
                          if (prev.find((i) => i.product_id === p.id)) return prev;
                          return [...prev, { product_id: p.id, variant_id: null, name: p.name, price: Number(p.price || 0), maxQty: 99 }];
                        });
                        setReturnQtys((q) => ({ ...q, [p.id]: 1 }));
                        setExSearch("");
                        setExResults([]);
                      }}
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

          {/* ── Reason ───────────────────────────────────────────────── */}
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

          {/* ── STEP 2: Mode selection ─────────────────────────────── */}
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

          {/* ── STEP 2b: Exchange product search ──────────────────── */}
          {resolvedSale && mode === "exchange" && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400 mb-2">Add Replacement Items</p>
              <div className="relative mb-2">
                <ShoppingCart size={13} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                  placeholder="Search product to exchange for"
                  value={exSearch}
                  onChange={(e) => setExSearch(e.target.value)}
                />
              </div>
              {exResults.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-2 max-h-40 overflow-y-auto">
                  {exResults.map((p) => (
                    <button
                      key={p.id}
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
                    <div key={item.id} className="flex items-center justify-between gap-3 p-2 border border-slate-100 rounded-lg">
                      <p className="text-sm flex-1 text-slate-800">{item.name}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setExchangeItems((p) => p.map((i) => i.id === item.id ? { ...i, qty: Math.max(1, i.qty - 1) } : i))} className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500"><Minus size={12} /></button>
                        <span className="w-6 text-center text-sm">{item.qty}</span>
                        <button onClick={() => setExchangeItems((p) => p.map((i) => i.id === item.id ? { ...i, qty: i.qty + 1 } : i))} className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500"><Plus size={12} /></button>
                        <button onClick={() => setExchangeItems((p) => p.filter((i) => i.id !== item.id))} className="text-rose-400 hover:text-rose-600 ml-1"><X size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Balance + Settlement ─────────────────────── */}
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
                  {balance === 0 ? "PKRs 0.00" : money(Math.abs(balance))}
                </span>
              </div>

              {/* Settlement method — only show when a refund is owed */}
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

              {/* Payment method — only when customer owes more */}
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

        {/* Footer */}
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
```

**Step 2: Mount in POSRedesign** — import `POSReturnExchangeModal` and add `<POSReturnExchangeModal />` alongside the other modals.

**Step 3: Verify** — clicking "Return" in header opens modal, invoice search works, no-bill path works, item quantities can be adjusted, mode toggle shows exchange search, balance updates live.

**Step 4: Commit**
```bash
git add frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx frontend/src/pages/redesign/POSRedesign.jsx
git commit -m "feat(pos): add Return/Exchange modal with refund and exchange flow"
```

---

## Task 6: Mount both new components in POSRedesign

**Files:**
- Modify: `frontend/src/pages/redesign/POSRedesign.jsx`

**Step 1: Read the current file** to see where other modals are imported and rendered.

**Step 2: Add imports:**
```jsx
import POSRecentSalesPanel from "./pos/POSRecentSalesPanel";
import POSReturnExchangeModal from "./pos/POSReturnExchangeModal";
```

**Step 3: Add components** inside the `POSProvider` tree, alongside other modals:
```jsx
<POSRecentSalesPanel />
<POSReturnExchangeModal />
```

**Step 4: Full smoke test:**
- Open POS → select branch → "Recent Sales" button shows today's sales
- Click "Reprint" → print window opens with correct receipt
- Click "Return" on a sale row → Return modal pre-loads items
- Click standalone "Return" in header → invoice search screen appears
- Enter invoice number → items load → adjust qty → pick Exchange → search product → see balance → complete
- No-bill return → search product manually → process refund

**Step 5: Commit**
```bash
git add frontend/src/pages/redesign/POSRedesign.jsx
git commit -m "feat(pos): mount POSRecentSalesPanel and POSReturnExchangeModal"
```

---

## Summary

| Task | Files | Backend? |
|---|---|---|
| 1 | POSContext.jsx — recent sales state | No |
| 2 | POSContext.jsx — return modal state | No |
| 3 | POSHeader.jsx — two new buttons | No |
| 4 | POSRecentSalesPanel.jsx (new) | No (uses GET /api/sales) |
| 5 | POSReturnExchangeModal.jsx (new) | No (uses POST /api/returns + POST /api/sales) |
| 6 | POSRedesign.jsx — mount components | No |
