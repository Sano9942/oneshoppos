# Sweep Resume Script — Copy & Paste Tomorrow

## Step 1: Close current browser, open new tab

## Step 2: Paste this in DevTools Console (F12) to resume at Step 13

```javascript
// Resume Step 13 — Add 2nd Outlet with proper form fill
(async () => {
  // Navigate to outlets page
  window.location.href = '/outlets';
  
  // Wait for page load
  await new Promise(r => setTimeout(r, 2000));
  
  // Click "Add Outlet" button
  const addBtn = document.querySelector('button:has-text("Add Outlet")') || 
                 Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Add Outlet'));
  if (addBtn) addBtn.click();
  
  // Wait for modal
  await new Promise(r => setTimeout(r, 1000));
  
  // Fill form fields via JavaScript (avoid selector brittleness)
  const inputs = document.querySelectorAll('input[type="text"]');
  if (inputs.length >= 3) {
    inputs[0].value = 'Branch 2';                    // Outlet name
    inputs[1].value = 'Shop 123 Mall Road, Lahore';  // Address
    inputs[2].value = '03001234567';                 // Phone
    
    // Trigger change events
    inputs.forEach(inp => inp.dispatchEvent(new Event('input', { bubbles: true })));
  }
  
  console.log('✓ Form filled. Click Save button now.');
})();
```

## Step 3: After form fills, manually click the blue "Save" button

Expected: POST `/api/outlets` → Pro paywall modal appears

## Step 4: If paywall appears, wait for user to manually click "Approve" in SanoPay sandbox (Step 16)

## Notes:
- Outlet name: `Branch 2`
- Address: `Shop 123 Mall Road, Lahore`
- Phone: `03001234567`
- Tenant: `livetestauto` (already logged in)
- User: `Sweep Operator` (password: `SweepRun123!`)

---

**If you need to re-login:**
```javascript
window.location.href = '/logout';
// Then go to https://sanopos.com and log in with:
// Store Code: livetestauto
// Username: Sweep Operator
// Password: SweepRun123!
```
