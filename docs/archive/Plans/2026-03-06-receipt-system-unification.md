# Receipt System Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the two disconnected receipt renderers (print popup + modal) with a single `receipt.js` utility that both consume, and connect the existing Receipt Templates system so `header_text`, `footer_text`, and `show_barcode` are actually used when printing.

**Architecture:** Create `frontend/src/utils/receipt.js` with `buildReceiptSections(slip, template)` and `buildReceiptHtml(slip, template)`. POSContext fetches the active template on mount and passes it into `printSlip`. POSReceiptModal imports `buildReceiptSections` for its header/footer. All receipt logic lives in one file.

**Tech Stack:** React 19, plain JS (no new dependencies)

---

### Task 1: Create `frontend/src/utils/receipt.js`

**Files:**
- Create: `frontend/src/utils/receipt.js`

**Step 1: Create the file with `buildReceiptSections`**

This function is the single source of truth for all receipt data. It takes a slip object and a template object, and returns a plain JS object with every computed value the receipt needs.

```js
/**
 * Single source of truth for receipt data.
 * Both printSlip (popup) and POSReceiptModal (screen) consume this.
 *
 * @param {object} slip   - The sale slip object built at checkout/reprint/exchange
 * @param {object|null} template - Active receipt template from /api/receipt-templates/active
 * @returns {object} All receipt sections as plain values
 */
export function buildReceiptSections(slip, template) {
  const subtotal = (slip.cart || []).reduce(
    (s, i) => s + Number(i.price || 0) * Number(i.quantity || 0),
    0,
  );

  const isExchange = (slip.returnedItems?.length || 0) > 0;
  const totalLabel = isExchange ? "Balance Due" : "Total";
  const totalValue = slip.balanceDue != null
    ? Math.max(0, slip.balanceDue)
    : (slip.total || 0);

  const payments = (slip.payments || []).filter(
    (p) => p.method !== "Return Credit",
  );

  return {
    // Branding — from template with fallbacks
    storeName: template?.header_text || slip.outlet?.name || "OneShopPOS",
    footerText: template?.footer_text || "Thank you for your purchase!",
    showBarcode: Boolean(template?.show_barcode),

    // Header info
    timestamp: slip.timestamp || "",
    invoiceNumber: slip.invoiceNumber || "-",
    returnedFrom: slip.returnedFrom || null,
    employee: slip.employee || null,
    customer: slip.customer || null,

    // Items
    isExchange,
    returnedItems: slip.returnedItems || [],
    cartItems: slip.cart || [],
    subtotal,

    // Adjustments
    taxAmount: Number(slip.taxAmount || 0),
    exchangeCredit: Number(slip.exchangeCredit || 0),
    discountAmount: Number(slip.discountAmount || 0),
    discountType: slip.discountType || "fixed",

    // Totals
    totalLabel,
    totalValue,
    payments,
    refundToCustomer: slip.refundNote ? Math.abs(slip.balanceDue || 0) : null,
    change: Number(slip.change || 0),

    // Footer
    orderNote: slip.orderNote || null,
  };
}
```

**Step 2: Add `buildReceiptHtml` below it in the same file**

This function calls `buildReceiptSections`, then builds a complete HTML document and opens/prints it in a popup. Uses a `money()` helper internally since it can't use the React context version.

```js
function fmt(n) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: 0,
  }).format(n || 0);
}

/**
 * Opens a browser print popup with the receipt rendered as HTML.
 * Uses buildReceiptSections internally — no logic duplication.
 *
 * @param {object} slip     - The sale slip object
 * @param {object|null} template - Active receipt template (null = use defaults)
 */
export function buildReceiptHtml(slip, template) {
  const s = buildReceiptSections(slip, template);

  const w = window.open("", "_blank", "width=360,height=620");
  const d = w.document;

  const style = d.createElement("style");
  style.textContent = [
    "body{font-family:monospace;font-size:13px;width:300px;margin:0 auto;padding:12px}",
    ".row{display:flex;justify-content:space-between}",
    ".c{text-align:center}",
    "hr{border:none;border-top:1px dashed #999;margin:6px 0}",
    ".label{font-size:11px;font-weight:bold;text-transform:uppercase;color:#666;margin:4px 0 2px}",
    ".ret{color:#c0392b}",
  ].join(" ");
  d.head.appendChild(style);
  d.title = `Receipt ${s.invoiceNumber}`;

  const b = d.body;

  const txt = (tag, text, cls = "") => {
    const e = d.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const row = (l, r, cls = "") => {
    const e = d.createElement("div");
    e.className = cls ? `row ${cls}` : "row";
    e.appendChild(txt("span", l));
    e.appendChild(txt("span", r));
    return e;
  };
  const hr = () => d.createElement("hr");

  // Header
  b.appendChild(txt("div", s.storeName, "c"));
  b.appendChild(txt("div", s.timestamp, "c"));
  b.appendChild(txt("div", `Invoice: ${s.invoiceNumber}`, "c"));
  if (s.returnedFrom)
    b.appendChild(txt("div", `Exchange for: ${s.returnedFrom}`, "c"));
  if (s.employee)
    b.appendChild(txt("div", `Staff: ${s.employee.name}`, "c"));
  if (s.customer)
    b.appendChild(txt("div", `Customer: ${s.customer.name}${s.customer.mobile ? " · " + s.customer.mobile : ""}`, "c"));
  b.appendChild(hr());

  // Returned items (exchange receipts only)
  if (s.returnedItems.length > 0) {
    b.appendChild(txt("div", "Returned", "label"));
    s.returnedItems.forEach((item) =>
      b.appendChild(row(`${item.name} x${item.quantity}`, `- ${fmt(item.price * item.quantity)}`, "ret")),
    );
    b.appendChild(hr());
    b.appendChild(txt("div", "New Items", "label"));
  }

  // Cart items
  s.cartItems.forEach((item) =>
    b.appendChild(row(`${item.name} x${item.quantity}`, fmt(item.price * item.quantity))),
  );
  b.appendChild(hr());

  // Totals block
  b.appendChild(row("Subtotal", fmt(s.subtotal)));

  if (s.taxAmount > 0)
    b.appendChild(row("GST (incl.)", fmt(s.taxAmount)));

  if (s.exchangeCredit > 0) {
    b.appendChild(row("Return Credit", `- ${fmt(s.exchangeCredit)}`, "ret"));
  } else if (s.discountAmount > 0) {
    const label = s.discountType === "percentage"
      ? `Discount (${s.discountAmount}%)`
      : "Discount";
    b.appendChild(row(label, `- ${fmt(s.discountAmount)}`));
  }

  const totalEl = row(s.totalLabel, fmt(s.totalValue));
  totalEl.style.fontWeight = "bold";
  b.appendChild(totalEl);

  s.payments.forEach((p) => b.appendChild(row(p.method, fmt(p.amount))));

  if (s.refundToCustomer != null)
    b.appendChild(row("Refund to Customer", fmt(s.refundToCustomer), "ret"));

  if (s.change > 0)
    b.appendChild(row("Change", fmt(s.change)));

  // Order note
  if (s.orderNote) {
    b.appendChild(hr());
    b.appendChild(txt("div", `Note: ${s.orderNote}`, "c"));
  }

  // Barcode (invoice number as text barcode if template has show_barcode)
  if (s.showBarcode) {
    b.appendChild(hr());
    const bc = d.createElement("div");
    bc.style.cssText = "text-align:center;font-size:10px;letter-spacing:3px;color:#555";
    bc.textContent = s.invoiceNumber;
    b.appendChild(bc);
  }

  // Footer
  b.appendChild(hr());
  b.appendChild(txt("div", s.footerText, "c"));

  w.print();
}
```

**Step 3: Verify the file has no syntax errors**

```bash
cd d:/newprojects/oneshoppos/frontend
node --input-type=module < src/utils/receipt.js
```
Expected: No output (file is valid). If errors: fix syntax before continuing.

**Step 4: Commit**

```bash
cd d:/newprojects/oneshoppos
git add frontend/src/utils/receipt.js
git commit -m "feat: add receipt.js utility — single source of truth for receipt rendering"
```

---

### Task 2: Update `POSContext.jsx` — fetch template + use `buildReceiptHtml`

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

**Step 1: Add the import at the top of the file**

After the existing imports (around line 13), add:
```js
import { buildReceiptHtml } from "../../../utils/receipt";
```

**Step 2: Add `receiptTemplate` state**

In the `// ── Receipt slip` section (around line 95–97), add one line:
```js
const [receiptTemplate, setReceiptTemplate] = useState(null);
```

**Step 3: Fetch the active template on mount**

Find the existing `useEffect` that fetches bootstrap data (outlets, customers, shifts, etc.). Add a fetch for the active template alongside the others:

```js
fetch(`${API}/api/receipt-templates/active`, { headers: authHeaders() })
  .then((r) => r.json())
  .then((d) => { if (d.template) setReceiptTemplate(d.template); })
  .catch(() => {}); // silently fall back to defaults if no template
```

Important: add this as an additional fetch inside the existing bootstrap `useEffect`, not a new separate `useEffect`. This keeps all startup fetches together.

**Step 4: Replace the entire `printSlip` function body**

Find the `printSlip` function (currently lines ~599–659). Replace the entire function body with a single call:

```js
const printSlip = (s) => {
  buildReceiptHtml(s, receiptTemplate);
};
```

Delete all the old inline HTML generation code inside `printSlip` — the `w`, `d`, `style`, `txt`, `row` variables, all the `b.appendChild` calls, and `w.print()`. Everything is now in `receipt.js`.

**Step 5: Export `receiptTemplate` in the context value**

Find the large context value object returned at the bottom (around line 860–910). Add:
```js
receiptTemplate,
```

**Step 6: Verify the dev server starts without errors**

```bash
cd d:/newprojects/oneshoppos/frontend
npm run dev
```
Expected: Vite starts on port 5173, no compile errors in terminal.

**Step 7: Commit**

```bash
cd d:/newprojects/oneshoppos
git add frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat: POSContext fetches active receipt template and delegates printSlip to receipt.js"
```

---

### Task 3: Update `POSReceiptModal.jsx` — use template for header/footer

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSReceiptModal.jsx`

**Step 1: Add imports**

```js
import { buildReceiptSections } from "../../../utils/receipt";
```

**Step 2: Pull `receiptTemplate` from context**

Change the destructure at the top:
```js
const { slipOpen, setSlipOpen, slip, money, printSlip, receiptTemplate } = usePOS();
```

**Step 3: Compute sections before the early return**

Add this line immediately after the destructure and before `if (!slipOpen || !slip) return null;`:
```js
const sections = slip ? buildReceiptSections(slip, receiptTemplate) : null;
```

**Step 4: Replace hardcoded store name with `sections.storeName`**

Find:
```jsx
{slip.outlet?.name || "OneShopPOS"}
```
Replace with:
```jsx
{sections.storeName}
```

**Step 5: Replace hardcoded footer with `sections.footerText`**

Find:
```jsx
<p className="text-center text-xs text-slate-400">
  Thank you for your purchase!
</p>
```
Replace with:
```jsx
<p className="text-center text-xs text-slate-400">
  {sections.footerText}
</p>
```

**Step 6: Add barcode section before the footer**

After the order note block and before the footer `<hr>`, add:
```jsx
{sections.showBarcode && (
  <>
    <div className="border-t border-dashed border-slate-300" />
    <p className="text-center text-xs tracking-widest text-slate-400 font-mono">
      {sections.invoiceNumber}
    </p>
  </>
)}
```

**Step 7: Verify the modal renders correctly**

Open POS in the browser, complete a test sale, verify the receipt modal shows. If a receipt template with custom header/footer is active in the DB, verify it shows that text. If no template is set, verify it falls back to the outlet name and "Thank you for your purchase!".

**Step 8: Commit**

```bash
cd d:/newprojects/oneshoppos
git add frontend/src/pages/redesign/pos/POSReceiptModal.jsx
git commit -m "feat: POSReceiptModal uses receipt.js buildReceiptSections for header/footer/barcode"
```

---

### Task 4: End-to-end verification

**Step 1: Test normal sale receipt**

1. Open POS, add a product to cart, complete checkout with Cash
2. Verify modal shows: store name, timestamp, invoice #, product name + qty + price, subtotal, total, Cash payment line
3. Click Print Receipt — verify popup opens and prints same layout
4. Verify "Thank you for your purchase!" appears in footer of both

**Step 2: Test exchange receipt**

1. Open Recent Sales panel, click Return on any sale
2. Select Exchange mode, add a replacement product, complete exchange
3. Verify receipt shows: "Exchange for: INV-XXXX" in header, RETURNED section in red, NEW ITEMS section, Return Credit line, Balance Due

**Step 3: Test template customization is live**

1. Go to Receipt Templates page, edit the Default template
2. Set `header_text` to your store name (e.g. "Branch Store — Main")
3. Set `footer_text` to "Come again soon!"
4. Mark as active, save
5. Restart POS page (F5), complete a sale
6. Verify modal and print popup show the custom header and footer

**Step 4: Test GST receipt**

1. Enable GST toggle in POS, add a product with a tax rate set
2. Complete sale, verify "GST (incl.)" line appears on receipt

**Step 5: Test discount receipt**

1. Apply a fixed discount, complete sale — verify "Discount" line on receipt
2. Apply a percentage discount, complete sale — verify "Discount (15%)" style label

**Step 6: Final commit if any fixes were made**

```bash
cd d:/newprojects/oneshoppos
git add -p
git commit -m "fix: receipt system unification — post-verification fixes"
```

---

## Summary of Changes

| File | Action |
|---|---|
| `frontend/src/utils/receipt.js` | **Created** — single source of truth |
| `frontend/src/pages/redesign/pos/POSContext.jsx` | **Modified** — fetch template, delegate `printSlip` to `receipt.js` |
| `frontend/src/pages/redesign/pos/POSReceiptModal.jsx` | **Modified** — use `buildReceiptSections` for header/footer/barcode |
| All other files | **No changes** |

## Future Receipt Features

Any new field: add to slip object at call site → add to `buildReceiptSections` return value → it automatically appears in both modal and print popup. No more patching 3 files.
