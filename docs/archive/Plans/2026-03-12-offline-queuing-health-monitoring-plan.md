# Offline Sale Queuing + Tenant Health Monitoring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add offline sale queuing at POS (localStorage + auto-sync) and tenant health monitoring in the super-admin dashboard.

**Architecture:** Feature 1 uses localStorage keyed by employee ID, `navigator.onLine` detection, and automatic sync via `online` event listener. Idempotency keys ensure safe replay. Feature 2 expands the existing admin stats endpoint with operational + capacity metrics, adds a bulk "needs attention" endpoint, and rewrites the admin frontend with health-aware UI.

**Tech Stack:** React (frontend), Node/Express + PostgreSQL (backend), localStorage (offline queue), pg_tables catalog (schema size)

---

## Feature 1: Offline Sale Queuing

### Task 1: Offline queue utility + state in POSContext

**Files:**
- Create: `frontend/src/utils/offlineQueue.js`
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

**Step 1: Create the offline queue utility**

Create `frontend/src/utils/offlineQueue.js`:

```js
const QUEUE_PREFIX = "pos_offline_queue_";
const MAX_QUEUED = 50;
const WARN_THRESHOLD = 40;

export function getQueueKey(employeeId) {
  return `${QUEUE_PREFIX}${employeeId}`;
}

export function getQueue(employeeId) {
  try {
    const raw = localStorage.getItem(getQueueKey(employeeId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function enqueue(employeeId, salePayload) {
  const queue = getQueue(employeeId);
  if (queue.length >= MAX_QUEUED) {
    throw new Error(`Offline queue full (${MAX_QUEUED} sales). Please sync before adding more.`);
  }
  queue.push({ ...salePayload, queued_at: new Date().toISOString() });
  localStorage.setItem(getQueueKey(employeeId), JSON.stringify(queue));
  return queue.length;
}

export function dequeue(employeeId, idempotencyKey) {
  const queue = getQueue(employeeId).filter(s => s.idempotency_key !== idempotencyKey);
  localStorage.setItem(getQueueKey(employeeId), JSON.stringify(queue));
  return queue.length;
}

export function clearQueue(employeeId) {
  localStorage.removeItem(getQueueKey(employeeId));
}

export { MAX_QUEUED, WARN_THRESHOLD };
```

**Step 2: Add offline queue state to POSContext**

In `POSContext.jsx`, add state and refs near line 125 (after `pendingSaleRef`):

```js
const [offlineQueueCount, setOfflineQueueCount] = useState(0);
const [offlineSyncing, setOfflineSyncing] = useState(false);
const [offlineSyncResult, setOfflineSyncResult] = useState(null); // { synced: N } or null
```

Add import at top:

```js
import { getQueue, enqueue, dequeue, WARN_THRESHOLD } from "../../../utils/offlineQueue";
```

Initialize queue count on mount — add a `useEffect` that reads `getQueue(employee?.id).length` when `employee?.id` changes and sets `offlineQueueCount`.

**Step 3: Commit**

```bash
git add frontend/src/utils/offlineQueue.js frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat: offline queue utility + state in POSContext"
```

---

### Task 2: Modify completeSale to queue when offline

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx:712-810`

**Step 1: Add offline detection to completeSale**

Replace the `try { ... } catch (e) { ... }` block in `completeSale` (lines 741-809). The new logic:

1. Check `navigator.onLine` before fetch. If offline, go straight to queue path.
2. In the catch block, detect network errors (TypeError from failed fetch) and queue instead of showing error.
3. Queue path: call `enqueue(employee.id, salePayload)`, update `offlineQueueCount`, show provisional receipt, clear cart.

The modified function should look like:

```js
// Inside completeSale, after salePayload is built (after line 740):

const queueSaleOffline = () => {
  try {
    const count = enqueue(employee.id, salePayload);
    setOfflineQueueCount(count);
    // Provisional receipt
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

// Check offline before fetch
if (!navigator.onLine) {
  queueSaleOffline();
  setSubmitting(false);
  return;
}

try {
  const res = await fetch(`${API}/api/sales`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(salePayload),
  });
  // ... existing 401 + success handling (lines 747-804 unchanged) ...
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
```

**Step 2: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat: completeSale queues offline on network failure"
```

---

### Task 3: Add syncQueue function + online listener

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

**Step 1: Add syncQueue function**

Add after the `retryPendingSale` function (after ~line 863):

```js
const syncQueue = useCallback(async () => {
  if (!employee?.id) return;
  const queue = getQueue(employee.id);
  if (!queue.length) return;
  if (offlineSyncing) return;
  setOfflineSyncing(true);
  let synced = 0;
  for (const sale of queue) {
    try {
      const res = await fetch(`${API}/api/sales`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(sale),
      });
      if (res.ok || (await res.json().catch(() => ({}))).duplicate) {
        dequeue(employee.id, sale.idempotency_key);
        synced++;
      } else {
        // Stop on first non-network failure (e.g. 401 session expired)
        break;
      }
    } catch {
      // Network error — stop syncing, will retry on next online event
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
```

**Step 2: Add online event listener**

Add a `useEffect` for the online listener + storage event (for multi-tab sync):

```js
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
```

**Step 3: Export new values**

Add to the context value object (near line 1091):

```js
// Offline queue
offlineQueueCount,
offlineSyncing,
offlineSyncResult,
syncQueue,
```

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat: syncQueue with online listener + multi-tab storage sync"
```

---

### Task 4: Offline banner in POSRedesign

**Files:**
- Modify: `frontend/src/pages/redesign/POSRedesign.jsx`

**Step 1: Add offline banner**

Import `WifiOff`, `RefreshCw` from lucide-react. Destructure `offlineQueueCount`, `offlineSyncing`, `syncQueue` from `usePOS()`.

Add a banner **above** the existing error/notice banners (before line 37 in POSContent). The banner renders when `offlineQueueCount > 0`:

```jsx
{offlineQueueCount > 0 && (
  <div className="fixed top-0 left-0 right-0 z-60 flex items-center justify-between px-4 py-2.5 bg-amber-500 text-white text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
    <span className="flex items-center gap-2">
      <WifiOff size={16} />
      {offlineQueueCount} sale(s) queued offline — will sync automatically
    </span>
    <button
      onClick={syncQueue}
      disabled={offlineSyncing}
      className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold transition disabled:opacity-50"
    >
      <RefreshCw size={12} className={offlineSyncing ? "animate-spin" : ""} />
      {offlineSyncing ? "Syncing..." : "Sync now"}
    </button>
  </div>
)}
```

Also add a green success banner that appears briefly when `offlineSyncResult`:

```jsx
{offlineSyncResult && (
  <div className="fixed top-0 left-0 right-0 z-60 flex items-center justify-center px-4 py-2.5 bg-emerald-500 text-white text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
    {offlineSyncResult.synced} sale(s) synced successfully
  </div>
)}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/redesign/POSRedesign.jsx
git commit -m "feat: offline queue banner with sync button in POS"
```

---

### Task 5: Block wallet/points-redeem when offline

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSCheckoutModal.jsx:299-349`

**Step 1: Add offline guard to toggles**

Add `const isOffline = !navigator.onLine;` at the top of the component (before `handleWalletToggle`).

For the **Redeem Points toggle** (line 300-323): Wrap with an additional condition. If offline, show a disabled state with tooltip:

```jsx
{checkoutCustomerPoints >= 100 && (
  <button
    type="button"
    onClick={() => !isOffline && setRedeemPointsOn((v) => !v)}
    disabled={isOffline}
    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 transition font-semibold text-sm ${
      isOffline
        ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
        : redeemPointsOn
          ? "border-amber-400 bg-amber-50 text-amber-800"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
    }`}
    title={isOffline ? "Points redemption requires connectivity" : ""}
  >
    {/* ... inner content unchanged ... */}
  </button>
)}
```

For the **Wallet toggle** (line 326-349): Same pattern — disable when `isOffline`:

```jsx
{checkoutWalletBalance > 0 && (
  <button
    type="button"
    onClick={() => !isOffline && handleWalletToggle()}
    disabled={isOffline}
    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 transition font-semibold text-sm ${
      isOffline
        ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
        : payWithWalletOn
          ? "border-emerald-400 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
    }`}
    title={isOffline ? "Wallet payment requires connectivity" : ""}
  >
    {/* ... inner content unchanged ... */}
  </button>
)}
```

Also: if `isOffline` and `redeemPointsOn` was true (stale state), force it off. Add near top:

```js
useEffect(() => {
  const handleOffline = () => {
    setRedeemPointsOn(false);
    if (payWithWalletOn) {
      setPayWithWalletOn(false);
      setPayments((prev) => prev.filter((p) => p.method !== "Wallet"));
    }
  };
  window.addEventListener("offline", handleOffline);
  return () => window.removeEventListener("offline", handleOffline);
}, [payWithWalletOn, setRedeemPointsOn, setPayWithWalletOn, setPayments]);
```

**Step 2: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSCheckoutModal.jsx
git commit -m "feat: block wallet/points redemption when offline"
```

---

### Task 6: Backend — relax shift validation for offline replayed sales

**Files:**
- Modify: `backend/routes/sales.js:306-314`

**Step 1: Allow closed-shift sales when idempotency_key is present**

The current logic at line 308-313 rejects sales when no open shift exists. For offline-queued sales (which always have an `idempotency_key`), the shift may have closed between queue time and sync time.

Modify the shift validation block: if `!activeShift` AND `idempotency_key` is provided, look up the shift from the payload instead of requiring an open one:

After line 308 (`activeShift = await getActiveShiftForOutlet(outlet_id);`), change the check:

```js
if (!activeShift) {
  // For offline-queued sales, accept if a shift existed (even if now closed)
  if (idempotency_key) {
    const { rows: [closedShift] } = await db.query(
      "SELECT id FROM cash_shifts WHERE outlet_id = $1 ORDER BY opened_at DESC LIMIT 1",
      [outlet_id]
    );
    if (closedShift) {
      activeShift = closedShift;
    } else {
      return res.status(400).json({ error: "No shift found for this outlet", code: "shift_not_open" });
    }
  } else {
    return res.status(400).json({
      error: "Cannot checkout because no open shift exists for this outlet",
      code: "shift_not_open",
    });
  }
}
```

Similarly, skip the attendance check for offline replays (shift may have been closed, employee may have clocked out):

```js
// Skip attendance check for offline-queued replays
if (!idempotency_key || activeShift.status === "open") {
  const attendanceStatus = await getEmployeeCheckoutStatus(authenticatedEmployeeId, outlet_id);
  // ... existing attendance validation ...
}
```

**Step 2: Commit**

```bash
git add backend/routes/sales.js
git commit -m "feat: relax shift/attendance validation for offline-queued sales"
```

---

### Task 7: Receipt shows offline status

**Files:**
- Modify: `frontend/src/utils/receipt.js` — look for `buildReceiptSections` function

**Step 1: Add offline indicator to receipt**

In `buildReceiptSections(slip, template)`, if `slip.offline === true`, add a note to the receipt sections:

- Invoice line shows "PENDING (offline)" instead of the invoice number
- Add a footer note: "Sale queued offline — final receipt available after sync"

This is a small change — find where `invoiceNumber` is used in the sections builder and conditionally show the offline text.

**Step 2: Commit**

```bash
git add frontend/src/utils/receipt.js
git commit -m "feat: provisional receipt shows offline pending status"
```

---

## Feature 2: Tenant Health Monitoring

### Task 8: Expand per-tenant stats endpoint

**Files:**
- Modify: `backend/routes/admin.js:313-343`

**Step 1: Expand the stats query**

Replace the existing `GET /api/admin/tenants/:id/stats` handler with a richer version. Keep the same structure but add more queries to the `Promise.all`:

```js
app.get("/api/admin/tenants/:id/stats", requireAllowedIp, requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, slug, status, max_employees, max_products, max_outlets FROM tenants WHERE id = $1",
      [req.params.id]
    );
    const tenant = rows[0] || null;
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    if (tenant.status !== "active") {
      return res.json({ stats: { status: tenant.status, message: "Tenant is not active" } });
    }

    const s = `tenant_${tenant.slug}`;
    const now = "NOW()";

    const [
      employees, products, outlets, sales, customers,
      salesToday, salesWeek, salesMonth,
      lastLogin, lastSale, lastShift,
      activeEmp7d, activeEmp30d,
      schemaSize
    ] = await Promise.all([
      db.query(`SELECT COUNT(*) AS cnt FROM ${s}.employees WHERE deleted_at IS NULL`),
      db.query(`SELECT COUNT(*) AS cnt FROM ${s}.products WHERE deleted_at IS NULL`),
      db.query(`SELECT COUNT(*) AS cnt FROM ${s}.outlets`),
      db.query(`SELECT COUNT(*) AS cnt FROM ${s}.sales`),
      db.query(`SELECT COUNT(*) AS cnt FROM ${s}.customers WHERE deleted_at IS NULL`),
      // Sales today + revenue
      db.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0)::numeric AS rev FROM ${s}.sales WHERE timestamp::date = CURRENT_DATE`),
      // Sales this week
      db.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0)::numeric AS rev FROM ${s}.sales WHERE timestamp >= date_trunc('week', ${now})`),
      // Sales this month
      db.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0)::numeric AS rev FROM ${s}.sales WHERE timestamp >= date_trunc('month', ${now})`),
      // Last login
      db.query(`SELECT MAX(timestamp) AS ts FROM ${s}.action_history WHERE action_type = 'login'`),
      // Last sale
      db.query(`SELECT MAX(timestamp) AS ts FROM ${s}.sales`),
      // Last shift opened
      db.query(`SELECT MAX(opened_at) AS ts FROM ${s}.cash_shifts`),
      // Active employees 7d
      db.query(`SELECT COUNT(DISTINCT employee_id) AS cnt FROM ${s}.action_history WHERE timestamp >= ${now} - INTERVAL '7 days'`),
      // Active employees 30d
      db.query(`SELECT COUNT(DISTINCT employee_id) AS cnt FROM ${s}.action_history WHERE timestamp >= ${now} - INTERVAL '30 days'`),
      // Schema size
      db.query(`SELECT COALESCE(SUM(pg_total_relation_size(schemaname || '.' || tablename)), 0) AS bytes FROM pg_tables WHERE schemaname = $1`, [`tenant_${tenant.slug}`]),
    ]);

    return res.json({
      stats: {
        employees: parseInt(employees.rows[0].cnt, 10),
        max_employees: tenant.max_employees,
        products: parseInt(products.rows[0].cnt, 10),
        max_products: tenant.max_products,
        outlets: parseInt(outlets.rows[0].cnt, 10),
        max_outlets: tenant.max_outlets,
        total_sales: parseInt(sales.rows[0].cnt, 10),
        customers: parseInt(customers.rows[0].cnt, 10),
        sales_today: parseInt(salesToday.rows[0].cnt, 10),
        revenue_today: Number(salesToday.rows[0].rev),
        sales_this_week: parseInt(salesWeek.rows[0].cnt, 10),
        revenue_this_week: Number(salesWeek.rows[0].rev),
        sales_this_month: parseInt(salesMonth.rows[0].cnt, 10),
        revenue_this_month: Number(salesMonth.rows[0].rev),
        last_login: lastLogin.rows[0].ts || null,
        last_sale: lastSale.rows[0].ts || null,
        last_shift_opened: lastShift.rows[0].ts || null,
        active_employees_7d: parseInt(activeEmp7d.rows[0].cnt, 10),
        active_employees_30d: parseInt(activeEmp30d.rows[0].cnt, 10),
        schema_size_mb: Math.round(Number(schemaSize.rows[0].bytes) / 1048576 * 10) / 10,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: expand per-tenant stats with activity, revenue, capacity, schema size"
```

---

### Task 9: Add attention endpoint + expand tenant list query

**Files:**
- Modify: `backend/routes/admin.js`

**Step 1: Add `GET /api/admin/attention`**

Add after the existing stats endpoint. This queries across ALL active tenants in one go:

```js
app.get("/api/admin/attention", requireAllowedIp, requireSuperAdmin, async (req, res) => {
  try {
    // Get all active tenants with plan limits
    const { rows: tenants } = await db.query(
      "SELECT id, slug, name, plan, max_employees, max_products, max_outlets FROM tenants WHERE status = 'active'"
    );

    const approaching = [];
    const dormant = [];
    const setupPending = [];

    for (const t of tenants) {
      const s = `tenant_${t.slug}`;
      try {
        const [empR, prodR, outR, loginR, setupR] = await Promise.all([
          db.query(`SELECT COUNT(*) AS cnt FROM ${s}.employees WHERE deleted_at IS NULL`),
          db.query(`SELECT COUNT(*) AS cnt FROM ${s}.products WHERE deleted_at IS NULL`),
          db.query(`SELECT COUNT(*) AS cnt FROM ${s}.outlets`),
          db.query(`SELECT MAX(timestamp) AS ts FROM ${s}.action_history WHERE action_type = 'login'`),
          db.query(`SELECT setup_complete FROM ${s}.company_profile WHERE id = 1`),
        ]);

        const emp = parseInt(empR.rows[0].cnt, 10);
        const prod = parseInt(prodR.rows[0].cnt, 10);
        const out = parseInt(outR.rows[0].cnt, 10);
        const lastLogin = loginR.rows[0].ts;
        const setupComplete = setupR.rows[0]?.setup_complete;

        // Check approaching limits (>85%)
        if (t.max_employees && emp / t.max_employees > 0.85) {
          approaching.push({ id: t.id, slug: t.slug, name: t.name, dimension: "employees", used: emp, max: t.max_employees });
        }
        if (t.max_products && prod / t.max_products > 0.85) {
          approaching.push({ id: t.id, slug: t.slug, name: t.name, dimension: "products", used: prod, max: t.max_products });
        }
        if (t.max_outlets && out / t.max_outlets > 0.85) {
          approaching.push({ id: t.id, slug: t.slug, name: t.name, dimension: "outlets", used: out, max: t.max_outlets });
        }

        // Check dormant (no login in 14+ days)
        if (lastLogin) {
          const daysSince = (Date.now() - new Date(lastLogin).getTime()) / 86400000;
          if (daysSince >= 14) {
            dormant.push({ id: t.id, slug: t.slug, name: t.name, last_login: lastLogin, days_inactive: Math.floor(daysSince) });
          }
        } else if (setupComplete) {
          // Setup complete but never logged in
          dormant.push({ id: t.id, slug: t.slug, name: t.name, last_login: null, days_inactive: null });
        }

        // Check setup pending
        if (!setupComplete) {
          setupPending.push({ id: t.id, slug: t.slug, name: t.name });
        }
      } catch {
        // Skip tenants with missing schemas
      }
    }

    return res.json({ approaching_limits: approaching, dormant, setup_pending: setupPending });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Expand `GET /api/admin/tenants` to include last_login + revenue_this_month**

Modify the existing tenants list endpoint (line ~134). After fetching tenants, for each active tenant do a quick query for `last_login` and `revenue_this_month`. To avoid N+1 for large numbers, this can be done in a `Promise.all` loop:

```js
// After fetching tenants array, enrich active ones:
const enriched = await Promise.all(tenants.map(async (t) => {
  if (t.status !== "active") return { ...t, last_login: null, revenue_this_month: 0, setup_complete: true };
  const s = `tenant_${t.slug}`;
  try {
    const [loginR, revR, setupR] = await Promise.all([
      db.query(`SELECT MAX(timestamp) AS ts FROM ${s}.action_history WHERE action_type = 'login'`),
      db.query(`SELECT COALESCE(SUM(total_amount), 0)::numeric AS rev FROM ${s}.sales WHERE timestamp >= date_trunc('month', NOW())`),
      db.query(`SELECT setup_complete FROM ${s}.company_profile WHERE id = 1`),
    ]);
    return {
      ...t,
      last_login: loginR.rows[0].ts || null,
      revenue_this_month: Number(revR.rows[0].rev),
      setup_complete: setupR.rows[0]?.setup_complete ?? true,
    };
  } catch {
    return { ...t, last_login: null, revenue_this_month: 0, setup_complete: true };
  }
}));
```

Return `enriched` instead of raw `tenants`.

**Step 3: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: attention endpoint + enriched tenant list with last_login + revenue"
```

---

### Task 10: AdminTenantDetail health dashboard

**Files:**
- Modify: `frontend/src/pages/admin/AdminTenantDetail.jsx:328-352`

**Step 1: Replace simple stats cards with health dashboard**

Replace the stats rendering section (lines 328-352) with three sections:

**Activity section:**
- Last login, last sale, last shift opened — all as relative time ("2 hours ago")
- Sales today / this week / this month with revenue
- Active employees 7d / 30d

**Plan Usage section:**
- Three horizontal progress bars for employees, products, outlets
- Each shows `used / max` label
- Color: green (<70%), amber (70-90%), red (>90%)

**Storage section:**
- Schema size in MB

Helper for relative time (add at top of file):
```js
function timeAgo(ts) {
  if (!ts) return "Never";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function usagePct(used, max) {
  if (!max) return 0;
  return Math.round((used / max) * 100);
}

function usageColor(pct) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}
```

The JSX for the health dashboard:

```jsx
{stats && !stats.message ? (
  <div className="space-y-6">
    {/* Activity */}
    <div>
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Activity</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">Last Login</p>
          <p className="text-sm font-semibold">{timeAgo(stats.last_login)}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">Last Sale</p>
          <p className="text-sm font-semibold">{timeAgo(stats.last_sale)}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">Last Shift</p>
          <p className="text-sm font-semibold">{timeAgo(stats.last_shift_opened)}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">Active Staff (7d / 30d)</p>
          <p className="text-sm font-semibold">{stats.active_employees_7d} / {stats.active_employees_30d}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-3">
        {[
          { label: "Today", sales: stats.sales_today, rev: stats.revenue_today },
          { label: "This Week", sales: stats.sales_this_week, rev: stats.revenue_this_week },
          { label: "This Month", sales: stats.sales_this_month, rev: stats.revenue_this_month },
        ].map((p) => (
          <div key={p.label} className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500">{p.label}</p>
            <p className="text-sm font-bold">{p.sales} sales</p>
            <p className="text-xs text-slate-400">{p.rev?.toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>

    {/* Plan Usage */}
    <div>
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Plan Usage</h3>
      {[
        { label: "Employees", used: stats.employees, max: stats.max_employees },
        { label: "Products", used: stats.products, max: stats.max_products },
        { label: "Outlets", used: stats.outlets, max: stats.max_outlets },
      ].map((d) => {
        const pct = usagePct(d.used, d.max);
        return (
          <div key={d.label} className="mb-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-600">{d.label}</span>
              <span className="font-semibold">{d.used} / {d.max || "∞"} ({pct}%)</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${usageColor(pct)} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>

    {/* Storage + Totals */}
    <div>
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Storage & Totals</h3>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">Schema Size</p>
          <p className="text-sm font-bold">{stats.schema_size_mb} MB</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">Total Sales</p>
          <p className="text-sm font-bold">{stats.total_sales?.toLocaleString()}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">Customers</p>
          <p className="text-sm font-bold">{stats.customers?.toLocaleString()}</p>
        </div>
      </div>
    </div>
  </div>
) : (
  <p className="text-sm text-slate-400">{stats?.message || "Stats unavailable"}</p>
)}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/AdminTenantDetail.jsx
git commit -m "feat: tenant health dashboard — activity, plan usage bars, storage"
```

---

### Task 11: AdminTenantList health columns

**Files:**
- Modify: `frontend/src/pages/admin/AdminTenantList.jsx`

**Step 1: Add health dot + revenue + last activity columns**

Update the table header and row rendering to add 3 new columns. The `tenants` array now has `last_login`, `revenue_this_month`, `setup_complete` from the enriched API.

Health dot logic:
```js
function healthDot(t) {
  if (!t.setup_complete) return { color: "bg-slate-400", label: "Setup pending" };
  if (!t.last_login) return { color: "bg-red-500", label: "Never logged in" };
  const days = (Date.now() - new Date(t.last_login).getTime()) / 86400000;
  if (days < 1) return { color: "bg-emerald-500", label: "Active today" };
  if (days < 7) return { color: "bg-amber-500", label: `${Math.floor(days)}d ago` };
  return { color: "bg-red-500", label: `${Math.floor(days)}d ago` };
}
```

Add columns to the table: Health (dot + tooltip), Revenue (formatted number), Last Activity (relative time).

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/AdminTenantList.jsx
git commit -m "feat: health dot + revenue + last activity columns in tenant list"
```

---

### Task 12: AdminDashboard "Needs Attention" card

**Files:**
- Modify: `frontend/src/pages/admin/AdminDashboard.jsx`

**Step 1: Fetch attention data**

Add a second fetch in the existing `useEffect` to call `GET /api/admin/attention`. Store in `attention` state.

**Step 2: Render "Needs Attention" card**

Add between the KPI cards and recent tenants sections. Three sub-sections:

- **Approaching Limits** — count badge, list of tenant+dimension if expanded
- **Dormant** — count badge, list of tenant+days inactive
- **Setup Pending** — count badge, list of tenant names

Each section is clickable → navigates to `/admin/tenants/${id}`.

If all three are empty, show a green "All tenants healthy" message.

```jsx
<div className="bg-white rounded-xl shadow-sm border p-5 mb-6">
  <h2 className="font-semibold text-lg mb-4">Needs Attention</h2>
  {!attention ? (
    <p className="text-sm text-slate-400">Loading...</p>
  ) : attention.approaching_limits.length === 0 && attention.dormant.length === 0 && attention.setup_pending.length === 0 ? (
    <p className="text-sm text-emerald-600 font-medium">All tenants healthy</p>
  ) : (
    <div className="space-y-3">
      {attention.approaching_limits.length > 0 && (
        <div>
          <p className="text-sm font-medium text-amber-600">
            {attention.approaching_limits.length} approaching plan limits
          </p>
          {attention.approaching_limits.map((a) => (
            <p key={`${a.id}-${a.dimension}`} className="text-xs text-slate-500 ml-2">
              {a.name}: {a.used}/{a.max} {a.dimension}
            </p>
          ))}
        </div>
      )}
      {attention.dormant.length > 0 && (
        <div>
          <p className="text-sm font-medium text-red-600">
            {attention.dormant.length} dormant tenants
          </p>
          {attention.dormant.map((d) => (
            <p key={d.id} className="text-xs text-slate-500 ml-2">
              {d.name}: {d.days_inactive ? `${d.days_inactive}d inactive` : "Never logged in"}
            </p>
          ))}
        </div>
      )}
      {attention.setup_pending.length > 0 && (
        <div>
          <p className="text-sm font-medium text-slate-600">
            {attention.setup_pending.length} setup pending
          </p>
          {attention.setup_pending.map((s) => (
            <p key={s.id} className="text-xs text-slate-500 ml-2">{s.name}</p>
          ))}
        </div>
      )}
    </div>
  )}
</div>
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/AdminDashboard.jsx
git commit -m "feat: needs attention card on admin dashboard"
```

---

### Task 13: Final verification + ROADMAP update

**Step 1: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: Clean build, no errors.

**Step 2: Update ROADMAP.md**

Add completed entries for both features.

**Step 3: Update CLAUDE.md status snapshot**

Add offline sale queuing and tenant health monitoring to the current status.

**Step 4: Final commit**

```bash
git add ROADMAP.md CLAUDE.md
git commit -m "docs: update ROADMAP and CLAUDE.md for offline queuing + health monitoring"
```

---

## Summary

| Task | Feature | Files | Effort |
|------|---------|-------|--------|
| 1 | Offline queue | offlineQueue.js + POSContext | Small |
| 2 | Offline queue | POSContext completeSale | Medium |
| 3 | Offline queue | POSContext syncQueue + listener | Medium |
| 4 | Offline queue | POSRedesign banner | Small |
| 5 | Offline queue | POSCheckoutModal toggles | Small |
| 6 | Offline queue | sales.js shift relaxation | Small |
| 7 | Offline queue | receipt.js offline indicator | Small |
| 8 | Health monitoring | admin.js per-tenant stats | Medium |
| 9 | Health monitoring | admin.js attention + list enrichment | Medium |
| 10 | Health monitoring | AdminTenantDetail health dashboard | Medium |
| 11 | Health monitoring | AdminTenantList health columns | Small |
| 12 | Health monitoring | AdminDashboard attention card | Small |
| 13 | Verification | Build + docs | Small |
