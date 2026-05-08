# KDS Setup — Quick Guide for Restaurant Merchants

**For:** Restaurant / cafe merchants on SanoPOS who want to run a Kitchen Display System (KDS) station and/or kitchen chit printers.
**Audience:** Owner / manager doing first-time setup. Not for end-of-shift staff.
**Time:** ~15 minutes for KDS tablet, ~10 minutes per kitchen printer.

---

## What you'll need

- An Android tablet (any modern model — Samsung Tab A, Lenovo Tab, or similar). Minimum 7" screen recommended; 10" is better for busy kitchens.
- A reliable WiFi network reaching the kitchen.
- A power outlet near the tablet (always-on).
- (Optional, but recommended) a thermal kitchen printer with Ethernet or WiFi (e.g. Epson TM-T20III-N, Star TSP100 LAN, or any 80mm ESC/POS printer with a network port).

---

## Step 1 — Prepare the Android tablet for always-on KDS mode

Kitchen tablets must stay awake during a service. By default Android sleeps after a few minutes — that's the wrong behaviour for a KDS station.

1. **Plug the tablet into power.** Keep it plugged whenever it's on the kitchen wall.
2. Open **Settings → About tablet** (or About phone). Tap "Build number" 7 times to enable Developer options (you'll see a "You are now a developer" toast).
3. Open **Settings → Developer options** (now visible at the bottom of Settings, or under "System"). Toggle on **Stay awake while charging**. The screen will now stay on as long as the cable is plugged in.
4. (Optional) **Settings → Display → Sleep** — set to "Never" or the longest available timeout. Belt and suspenders.
5. (Optional, recommended) **Settings → Display → Lock screen** — disable lock screen entirely, OR set a simple PIN that the kitchen team knows. Avoid biometrics on a tablet that other staff need to unlock.

> **Why "Stay awake while charging"** rather than just disabling sleep? Because if the cable accidentally gets unplugged, the tablet will go back to normal sleep behaviour and save battery — preventing it from running flat unattended overnight.

---

## Step 2 — Open the KDS in fullscreen browser mode

1. On the tablet, open **Chrome**.
2. Go to `https://sanopos.com/login` and login as a manager-tier or admin-tier employee. Cashiers don't have KDS permission.
3. Once logged in, navigate to `/kds` (or tap **KDS** in the left-hand sidebar).
4. Tap the Chrome menu (three-dot icon) → **Add to Home screen**. Name it "Kitchen Display." This creates an app-style shortcut.
5. Open that shortcut. Tap the menu again and select **Full screen** (some Chrome builds use a different label like "Reader mode" — pick the one that hides Chrome's address bar).

You should now see live tickets coming through as orders are fired from POS.

---

## Step 3 — Set up KDS stations (one-time, in the dashboard)

Done from a manager's regular phone or laptop, not the kitchen tablet.

1. Login → **Restaurant → KDS** (sidebar).
2. **+ New Station** — give it a name like "Hot Line" or "Cold Bar".
3. Set the outlet. (KDS is per-outlet — the same tenant can run different stations at different branches.)
4. Save.
5. Repeat for each kitchen station you run (Hot Line, Cold Bar, Pizza, etc.).

Routing rules — which products go to which station — can be added later via Settings → Restaurant → KDS routing rules. Without rules, all items default to the first station.

---

## Step 4 — Connect a kitchen chit printer (optional)

If you want paper chits printing alongside the KDS screen:

1. Confirm the printer is on the same WiFi/LAN as the SanoPOS tablet/POS. Plug it into the kitchen LAN switch or pair it to WiFi per the printer manufacturer's instructions.
2. Find the printer's IP address. Most network thermal printers have a "Print Self-Test" button — hold it for 3 seconds while powering on. The IP will print at the bottom of the test page (e.g. `192.168.1.100`).
3. In SanoPOS dashboard: **Settings → Printer Settings**.
4. Add a new printer:
   - **Type:** Network (TCP/IP)
   - **IP / Host:** `192.168.1.100` (whatever your printer reported)
   - **Port:** `9100` (standard for ESC/POS — only change if your printer manual says otherwise)
   - **Paper width:** `48` for 80mm rolls, `32` for 58mm rolls
5. Click **Test Print**. A receipt-shaped test page should print at the kitchen printer.
6. Save.

---

## Common problems

**KDS screen goes blank after a few minutes**
→ Step 1 was skipped or "Stay awake while charging" got turned off. Check Developer options.

**Test print works, but real chits don't print during service**
→ Check that the relevant products have KDS routing rules pointing to a station, and that the printer is associated with that station. Without routing, items go to the default (first) station only.

**Test print fails with "connection refused" or timeout**
→ Wrong IP. Run printer self-test again to confirm. Also check that POS and printer are on the same subnet (both `192.168.1.x`, for example).

**KDS shows tickets but no audio chime when a new ticket arrives**
→ Chrome on Android requires user interaction before audio can play. Tap anywhere on the KDS screen once after opening — the chime will work for the rest of the session.

**Printer prints garbled characters**
→ Wrong character encoding for ESC/POS. Open Printer Settings, change the encoding to PC437 (US default) or PC850 (multilingual). For Urdu/Arabic, ESC/POS thermal printers don't natively support those scripts — consider a 80mm graphics-mode printer instead.

**Tablet runs out of storage after 2-3 weeks**
→ Chrome is caching. Settings → Apps → Chrome → Storage → Clear cache. Schedule this monthly. The KDS doesn't store anything important locally.

---

## Hardware shortlist (Pakistan-friendly options)

These work well with SanoPOS based on common merchant deployments. Not endorsements — your local supplier may have better options.

| Type | Suggestion | Approx. price (PKR, 2026) |
|---|---|---|
| KDS tablet | Samsung Galaxy Tab A9 (8") or Lenovo Tab M8 | 35,000–55,000 |
| Kitchen printer | Epson TM-T20III-N (LAN) | 22,000–28,000 |
| Kitchen printer (cheaper) | Generic 80mm ESC/POS LAN printer | 8,000–15,000 |
| WiFi range extender (if kitchen has weak signal) | TP-Link RE220 or similar | 3,000–5,000 |

---

## Need help?

- In-app: tap the **?** support button (bottom-right) on any SanoPOS dashboard page. Attach a screenshot of the issue.
- Email: support@sanopos.com (response within 24 hours during business days).

---

*Document version: 2026-05-09. Reviewed against SanoPOS as of Phase 8 launch readiness sweep.*
