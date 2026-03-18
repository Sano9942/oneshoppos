# UX & Onboarding Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 7 UX improvements: dark mode, global toast, profile dropdown, employee profile page, POS keyboard shortcuts, POS help overlay, and breadcrumbs.

**Architecture:** CSS variable theming for dark mode, React context for toasts, new profile page + dropdown replacing logout button, F-key shortcuts in POS keydown listener, route-based breadcrumbs in app layout.

**Tech Stack:** React 19, Tailwind CSS v4, existing CSS variable system in `tokens.css`, no new dependencies.

---

### Task 1: Dark Mode — CSS Variables + Theme Utility

**Files:**
- Modify: `frontend/src/ui/tokens.css`
- Create: `frontend/src/utils/theme.js`
- Modify: `frontend/src/index.css`

**Step 1: Add dark theme variables to tokens.css**

Append after the existing `:root` block in `frontend/src/ui/tokens.css`:

```css
[data-theme="dark"] {
  --ui-bg: #0f172a;
  --ui-surface: #1e293b;
  --ui-muted-surface: #334155;
  --ui-border: #475569;
  --ui-text: #f1f5f9;
  --ui-text-muted: #94a3b8;
  --ui-primary: #10b981;
  --ui-primary-strong: #059669;
  --ui-danger: #ef4444;
  --ui-warning: #f59e0b;
  --ui-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  --ui-shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.4);
}

[data-theme="dark"] .ui-shell-bg {
  background: linear-gradient(180deg, #1e293b 0%, var(--ui-bg) 100%);
}
```

**Step 2: Create theme utility**

Create `frontend/src/utils/theme.js`:

```js
const STORAGE_KEY = "sanopos_theme";

export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || "light";
}

export function setTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function initTheme() {
  setTheme(getTheme());
}
```

**Step 3: Init theme on app boot**

In `frontend/src/index.css`, add after the body rule:

```css
/* Prevent flash of wrong theme */
html { background: var(--ui-bg); }
```

In `frontend/src/App.jsx`, add at the top of the file (before component):
```js
import { initTheme } from "./utils/theme";
initTheme();
```

**Step 4: Fix hardcoded colors in AppLayoutRedesign.jsx**

In `frontend/src/components/AppLayoutRedesign.jsx`:
- Line 34: change `bg-white` to `bg-(--ui-surface)` on the sidebar `<aside>`
- Line 97: change `bg-white` to `bg-(--ui-surface)` on the `<header>`

**Step 5: Commit**

```bash
git add frontend/src/ui/tokens.css frontend/src/utils/theme.js frontend/src/index.css frontend/src/App.jsx frontend/src/components/AppLayoutRedesign.jsx
git commit -m "feat: dark mode CSS variables + theme utility"
```

---

### Task 2: Global Toast System

**Files:**
- Create: `frontend/src/contexts/ToastContext.jsx`
- Modify: `frontend/src/App.jsx` (wrap provider)

**Step 1: Create ToastContext.jsx**

Create `frontend/src/contexts/ToastContext.jsx`:

```jsx
import { createContext, useCallback, useContext, useState } from "react";

const ToastContext = createContext(null);
let _id = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message, type = "info") => {
    const id = ++_id;
    setToasts((prev) => {
      const next = [...prev, { id, message, type }];
      return next.length > 3 ? next.slice(-3) : next;
    });
    setTimeout(() => dismiss(id), 4000);
    return id;
  }, [dismiss]);

  const success = useCallback((msg) => toast(msg, "success"), [toast]);
  const error = useCallback((msg) => toast(msg, "error"), [toast]);
  const warning = useCallback((msg) => toast(msg, "warning"), [toast]);

  const COLORS = {
    success: "bg-emerald-600 text-white",
    error: "bg-red-600 text-white",
    warning: "bg-amber-500 text-white",
    info: "bg-(--ui-surface) text-(--ui-text) border border-(--ui-border)",
  };

  return (
    <ToastContext.Provider value={{ toast, success, error, warning }}>
      {children}
      <div className="fixed bottom-4 right-4 z-200 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-right-4 duration-200 ${COLORS[t.type] || COLORS.info}`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-2 opacity-70 hover:opacity-100 cursor-pointer"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}
```

**Step 2: Wrap app in ToastProvider**

In `frontend/src/App.jsx`, import and wrap. Add `ToastProvider` inside `CurrencyProvider` but outside `AuthProvider`:

```js
import { ToastProvider } from "./contexts/ToastContext";
```

Wrap: `<CurrencyProvider><ToastProvider><AuthProvider>...`

**Step 3: Commit**

```bash
git add frontend/src/contexts/ToastContext.jsx frontend/src/App.jsx
git commit -m "feat: global toast notification system"
```

---

### Task 3: Profile Dropdown (replace Logout button)

**Files:**
- Modify: `frontend/src/components/AppLayoutRedesign.jsx`

**Step 1: Replace the logout button + employee badge**

In `AppLayoutRedesign.jsx`, replace lines 110-126 (the `<div className="ml-4 flex items-center gap-4">` block) with a profile dropdown.

Import at the top:
```js
import { ChevronLeft, ChevronRight, LogOut, Moon, Search, Sun, User, UserCircle } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { getTheme, toggleTheme } from "../utils/theme";
```

Replace the header right section (lines 110-126):
```jsx
<div className="ml-4 flex items-center gap-4">
  <ContextSwitcher />
  <NotificationBell />
  <ProfileDropdown employee={employee} logout={logout} navigate={navigate} />
</div>
```

Add the `ProfileDropdown` component above `AppLayoutRedesign`:

```jsx
function ProfileDropdown({ employee, logout, navigate }) {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="ui-focus-ring flex items-center gap-2 rounded-lg border border-(--ui-border) px-2.5 py-1.5 text-xs font-medium text-(--ui-text) hover:bg-(--ui-muted-surface) transition cursor-pointer"
      >
        <UserCircle size={16} />
        <span>{employee?.name || "Employee"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-(--ui-border) bg-(--ui-surface) py-1 shadow-lg z-50">
          <div className="px-3 py-2 border-b border-(--ui-border)">
            <p className="text-sm font-semibold text-(--ui-text)">{employee?.name}</p>
            <p className="text-xs text-(--ui-text-muted)">
              {employee?.role_id === 1 ? "Administrator" : employee?.role_id === 2 ? "Manager" : "Cashier"}
            </p>
          </div>
          <button
            onClick={() => { setOpen(false); navigate("/profile"); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-(--ui-text) hover:bg-(--ui-muted-surface) cursor-pointer"
          >
            <User size={14} /> My Profile
          </button>
          <button
            onClick={() => { const next = toggleTheme(); setThemeState(next); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-(--ui-text) hover:bg-(--ui-muted-surface) cursor-pointer"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <div className="border-t border-(--ui-border) mt-1 pt-1">
            <button
              onClick={async () => { setOpen(false); await logout(); navigate("/login", { replace: true }); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-(--ui-muted-surface) cursor-pointer"
            >
              <LogOut size={14} /> Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/AppLayoutRedesign.jsx
git commit -m "feat: profile dropdown with dark mode toggle (replaces logout button)"
```

---

### Task 4: Employee Profile Page

**Files:**
- Create: `frontend/src/pages/redesign/ProfileRedesign.jsx`
- Modify: `frontend/src/App.jsx` (add route)
- Modify: `backend/routes/employees.js` (add change-pin endpoint)

**Step 1: Add change-pin backend endpoint**

In `backend/routes/employees.js`, add after the `change-password` endpoint:

```js
  // PUT /api/employees/:id/change-pin — employee changes own PIN
  app.put("/api/employees/:id/change-pin", async (req, res) => {
    const { id } = req.params;
    const actorId = Number(req.headers["x-employee-id"] || 0);
    if (actorId !== Number(id)) {
      return res.status(403).json({ error: "You can only change your own PIN" });
    }

    const { current_pin, new_pin } = req.body || {};
    if (!new_pin || new_pin.length < 4 || new_pin.length > 10) {
      return res.status(400).json({ error: "New PIN must be 4-10 digits" });
    }
    if (!current_pin) {
      return res.status(400).json({ error: "current_pin is required" });
    }

    try {
      const { rows: [employee] } = await db.query(
        "SELECT id, pin_hash, pin_code FROM employees WHERE id = $1 AND deleted_at IS NULL",
        [Number(id)]
      );
      if (!employee) return res.status(404).json({ error: "Employee not found" });

      let verified = false;
      if (employee.pin_hash) {
        verified = await bcrypt.compare(String(current_pin), employee.pin_hash);
      } else if (employee.pin_code) {
        verified = String(current_pin).trim() === String(employee.pin_code).trim();
      }
      if (!verified) {
        return res.status(401).json({ error: "Current PIN is incorrect" });
      }

      const pin_hash = await bcrypt.hash(String(new_pin), 10);
      await db.query(
        "UPDATE employees SET pin_code = $1, pin_hash = $2 WHERE id = $3",
        [new_pin, pin_hash, Number(id)]
      );

      res.json({ message: "PIN changed successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 2: Create ProfileRedesign.jsx**

Create `frontend/src/pages/redesign/ProfileRedesign.jsx`:

```jsx
import { useEffect, useState } from "react";
import { KeyRound, Lock, Mail, MapPin, Shield, User } from "lucide-react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, Input, PageShell, SectionCard } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";

export default function ProfileRedesign() {
  const { employee } = useAuth();
  const { success, error: showError } = useToast();
  const [profile, setProfile] = useState(null);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);

  // PIN change
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, outRes] = await Promise.all([
          fetch(`${API}/api/auth/me`),
          employee?.id ? fetch(`${API}/api/employees/${employee.id}/outlets`) : null,
        ]);
        const meData = await meRes.json();
        setProfile(meData.employee || meData);
        if (outRes) {
          const outData = await outRes.json();
          setOutlets(outData.outlets || []);
        }
      } catch { /* silent */ }
      setLoading(false);
    })();
  }, [employee?.id]);

  const changePin = async (e) => {
    e.preventDefault();
    if (newPin !== confirmPin) { showError("PINs do not match"); return; }
    if (newPin.length < 4) { showError("PIN must be at least 4 digits"); return; }
    setSavingPin(true);
    try {
      const res = await fetch(`${API}/api/employees/${employee.id}/change-pin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success("PIN changed successfully");
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
    } catch (err) { showError(err.message); }
    setSavingPin(false);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { showError("Passwords do not match"); return; }
    if (newPassword.length < 8) { showError("Password must be at least 8 characters"); return; }
    setSavingPassword(true);
    try {
      const res = await fetch(`${API}/api/employees/${employee.id}/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword || undefined, pin: !currentPassword ? currentPin : undefined, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success("Password changed successfully");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err) { showError(err.message); }
    setSavingPassword(false);
  };

  if (loading) return <PageShell title="My Profile"><p className="text-sm text-(--ui-text-muted)">Loading...</p></PageShell>;

  return (
    <PageShell title="My Profile" subtitle="View your account details and change your credentials.">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Info Card */}
        <SectionCard className="p-5 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Account Info</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-(--ui-text)"><User size={14} className="text-(--ui-text-muted)" /> {profile?.name}</div>
            <div className="flex items-center gap-2 text-(--ui-text)"><Shield size={14} className="text-(--ui-text-muted)" /> <Badge>{profile?.role || (profile?.role_id === 1 ? "Administrator" : profile?.role_id === 2 ? "Manager" : "Cashier")}</Badge></div>
            {profile?.email && <div className="flex items-center gap-2 text-(--ui-text)"><Mail size={14} className="text-(--ui-text-muted)" /> {profile.email}</div>}
          </div>
          {outlets.length > 0 && (
            <>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted) pt-2">Assigned Outlets</h3>
              <div className="space-y-1">
                {outlets.map((o) => (
                  <div key={o.outlet_id} className="flex items-center gap-2 text-sm text-(--ui-text)">
                    <MapPin size={12} className="text-(--ui-text-muted)" /> {o.name}
                    {o.is_primary && <Badge tone="warning">Primary</Badge>}
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionCard>

        {/* Change PIN */}
        <SectionCard className="p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Change PIN</h3>
          <form onSubmit={changePin} className="space-y-2">
            <Input type="password" placeholder="Current PIN" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} required maxLength={10} />
            <Input type="password" placeholder="New PIN (4-10 digits)" value={newPin} onChange={(e) => setNewPin(e.target.value)} required maxLength={10} />
            <Input type="password" placeholder="Confirm new PIN" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} required maxLength={10} />
            {newPin && confirmPin && newPin !== confirmPin && <p className="text-xs text-red-600">PINs do not match</p>}
            <Button tone="primary" type="submit" disabled={savingPin || !currentPin || !newPin || newPin !== confirmPin}>
              <KeyRound size={14} className="mr-1 inline" />{savingPin ? "Saving..." : "Change PIN"}
            </Button>
          </form>
        </SectionCard>

        {/* Change Password */}
        <SectionCard className="p-5 md:col-span-2">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Change Password</h3>
          <form onSubmit={changePassword} className="space-y-2 max-w-md">
            <Input type="password" placeholder="Current password (or PIN if no password set)" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            <Input type="password" placeholder="New password (min 8 chars)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            <Input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            {newPassword && confirmPassword && newPassword !== confirmPassword && <p className="text-xs text-red-600">Passwords do not match</p>}
            <Button tone="primary" type="submit" disabled={savingPassword || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword}>
              <Lock size={14} className="mr-1 inline" />{savingPassword ? "Saving..." : "Change Password"}
            </Button>
          </form>
        </SectionCard>
      </div>
    </PageShell>
  );
}
```

**Step 3: Add route to App.jsx**

Add lazy import:
```js
const ProfileRedesign = lazy(() => import("./pages/redesign/ProfileRedesign"));
```

Add route inside the authenticated `<Route>` block (after `/dashboard` route):
```jsx
<Route path="/profile" element={<ProfileRedesign />} />
```

**Step 4: Commit**

```bash
git add backend/routes/employees.js frontend/src/pages/redesign/ProfileRedesign.jsx frontend/src/App.jsx
git commit -m "feat: employee profile page with PIN/password change"
```

---

### Task 5: POS Keyboard Shortcuts

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx` (extend keydown listener)

**Step 1: Extend the barcode scanner keydown handler**

In `frontend/src/pages/redesign/pos/POSContext.jsx`, find the `handleKeyDown` function (line 388). Replace it to handle F-keys BEFORE the barcode logic:

```js
    function handleKeyDown(e) {
      // F-key shortcuts — work even when focus is in an input
      const fkeys = {
        F1: () => { e.preventDefault(); setShowShortcutsOverlay((v) => !v); },
        F2: () => { e.preventDefault(); if (cart.length) setShowDiscountModal(true); },
        F3: () => { e.preventDefault(); if (cart.length) parkSale(); },
        F4: () => { e.preventDefault(); const el = document.querySelector('[data-pos-customer-search]'); if (el) el.focus(); },
        F5: () => { e.preventDefault(); setShowParked(true); },
        F8: () => { e.preventDefault(); if (cart.length) removeFromCart(cart[cart.length - 1].id); },
        F9: () => { e.preventDefault(); if (cart.length) openCheckout(); },
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
```

**Step 2: Add `showShortcutsOverlay` state**

Near the other state declarations (around line 62-80), add:
```js
const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);
```

**Step 3: Export the new state**

Add to the context value object (around line 1090-1180):
```js
showShortcutsOverlay,
setShowShortcutsOverlay,
```

**Step 4: Update useEffect deps**

The keydown useEffect needs `cart`, `parkSale`, `openCheckout`, `removeFromCart`, `setCart` in its dependency array. Update:
```js
  }, [handleBarcodeScanned, cart, parkSale, openCheckout, removeFromCart, setCart]);
```

Note: `parkSale`, `openCheckout`, `removeFromCart` are already defined in the same component. `setCart` is a state setter (stable). `cart` is needed for the `.length` checks.

**Step 5: Add `data-pos-customer-search` attribute**

In `frontend/src/pages/redesign/pos/POSSearchArea.jsx` (or wherever the customer search input is), add `data-pos-customer-search` attribute to the customer search input element so F4 can focus it. Search for the customer search input and add the attribute.

**Step 6: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSContext.jsx frontend/src/pages/redesign/pos/POSSearchArea.jsx
git commit -m "feat: POS keyboard shortcuts (F1-F10, Esc)"
```

---

### Task 6: POS Help Overlay

**Files:**
- Create: `frontend/src/pages/redesign/pos/POSShortcutsOverlay.jsx`
- Modify: `frontend/src/pages/redesign/POSRedesign.jsx` (mount overlay + ? button)

**Step 1: Create POSShortcutsOverlay.jsx**

Create `frontend/src/pages/redesign/pos/POSShortcutsOverlay.jsx`:

```jsx
import { usePOS } from "./POSContext";
import { Keyboard, X } from "lucide-react";

const SHORTCUTS = [
  { key: "F1", action: "Toggle this help" },
  { key: "F2", action: "Apply discount" },
  { key: "F3", action: "Park sale" },
  { key: "F4", action: "Customer search" },
  { key: "F5", action: "View parked sales" },
  { key: "F8", action: "Remove last item" },
  { key: "F9", action: "Checkout / Pay" },
  { key: "F10", action: "Clear cart" },
  { key: "Esc", action: "Close modal" },
];

export default function POSShortcutsOverlay() {
  const { showShortcutsOverlay, setShowShortcutsOverlay } = usePOS();
  if (!showShortcutsOverlay) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={() => setShowShortcutsOverlay(false)}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-(--ui-surface) p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-(--ui-text)">
            <Keyboard size={20} />
            <h2 className="text-lg font-bold">Keyboard Shortcuts</h2>
          </div>
          <button onClick={() => setShowShortcutsOverlay(false)} className="text-(--ui-text-muted) hover:text-(--ui-text) cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-1">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-(--ui-text)">{s.action}</span>
              <kbd className="rounded bg-(--ui-muted-surface) px-2 py-0.5 font-mono text-xs text-(--ui-text-muted) border border-(--ui-border)">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-(--ui-text-muted) text-center">
          Press F1 or Esc to close
        </p>
      </div>
    </div>
  );
}
```

**Step 2: Mount in POSRedesign.jsx**

In `frontend/src/pages/redesign/POSRedesign.jsx`:

Add import:
```js
import POSShortcutsOverlay from "./pos/POSShortcutsOverlay";
```

Add `<POSShortcutsOverlay />` after `<POSSessionExpiredModal />` (the last modal, around line 19).

**Step 3: Add ? button to POS header**

In `frontend/src/pages/redesign/pos/POSHeader.jsx`, add a small `?` button that triggers `setShowShortcutsOverlay(true)`. Read the file first to find the right place.

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSShortcutsOverlay.jsx frontend/src/pages/redesign/POSRedesign.jsx frontend/src/pages/redesign/pos/POSHeader.jsx
git commit -m "feat: POS keyboard shortcuts help overlay"
```

---

### Task 7: Breadcrumbs

**Files:**
- Create: `frontend/src/ui/Breadcrumbs.jsx`
- Modify: `frontend/src/components/AppLayoutRedesign.jsx` (add breadcrumbs)

**Step 1: Create Breadcrumbs.jsx**

Create `frontend/src/ui/Breadcrumbs.jsx`:

```jsx
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

const LABELS = {
  dashboard: "Dashboard",
  "sales-history": "Sales History",
  "cash-management": "Cash Management",
  customers: "Customers",
  crm: "CRM",
  quotations: "Quotations",
  orders: "Orders",
  "parked-sales": "Parked Sales",
  products: "Products",
  categories: "Categories",
  brands: "Brands",
  taxes: "Taxes",
  "attribute-sets": "Attribute Sets",
  promotions: "Promotions",
  "purchase-orders": "Purchase Orders",
  "stock-adjustments": "Stock Adjustments",
  transfers: "Transfers",
  "returned-stock": "Returned Stock",
  "supplier-payables": "Supplier Payables",
  "reorder-alerts": "Reorder Alerts",
  suppliers: "Suppliers",
  expenses: "Expenses",
  approvals: "Approvals",
  reports: "Reports",
  accounting: "Accounting",
  kiosk: "Kiosk",
  attendance: "Attendance",
  hr: "HR",
  notifications: "Notifications",
  employees: "Employees",
  outlets: "Outlets",
  "company-settings": "Company Profile",
  "shopify-integration": "Shopify",
  "barcode-templates": "Barcode Templates",
  "receipt-templates": "Receipt Templates",
  "printer-settings": "Printer Settings",
  "backup-restore": "Backup",
  administrator: "Administrator",
  "action-history": "Action History",
  inventory: "Inventory",
  returns: "Returns",
  profile: "My Profile",
};

const SKIP = ["/dashboard", "/pos", "/kiosk", "/customer-display"];

export default function Breadcrumbs() {
  const { pathname } = useLocation();

  if (SKIP.some((p) => pathname === p || pathname === "/")) return null;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav className="mb-3 flex items-center gap-1 text-xs text-(--ui-text-muted)">
      <Link to="/dashboard" className="hover:text-(--ui-text) transition">
        <Home size={12} />
      </Link>
      {segments.map((seg, i) => {
        const path = "/" + segments.slice(0, i + 1).join("/");
        const label = LABELS[seg] || seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const isLast = i === segments.length - 1;
        return (
          <span key={path} className="flex items-center gap-1">
            <ChevronRight size={10} />
            {isLast ? (
              <span className="text-(--ui-text) font-medium">{label}</span>
            ) : (
              <Link to={path} className="hover:text-(--ui-text) transition">{label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
```

**Step 2: Add to AppLayoutRedesign.jsx**

Import:
```js
import Breadcrumbs from "../ui/Breadcrumbs";
```

In the `<main>` element (line 128), add `<Breadcrumbs />` before the `<Suspense>`:
```jsx
<main className="min-h-0 flex-1 overflow-auto p-4">
  <Breadcrumbs />
  <Suspense fallback={...}>
    <Outlet />
  </Suspense>
</main>
```

**Step 3: Commit**

```bash
git add frontend/src/ui/Breadcrumbs.jsx frontend/src/components/AppLayoutRedesign.jsx
git commit -m "feat: breadcrumb navigation"
```

---

### Task 8: Build Verification + Push

**Step 1: Build frontend**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors.

**Step 2: Verify all commits**

Run: `git log --oneline -10`

**Step 3: Push branch**

```bash
git push -u origin feature/ux-onboarding
```
