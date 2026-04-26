import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Brutalist / utility landing page — preview at /preview/landing-brutalist
 *
 * Concept: SanoPOS as a technical spec sheet. Mono type everywhere, hairline
 * black grid, single hi-vis yellow accent, ASCII dividers, frame numbers.
 * Self-contained: own fonts, own theme, no Tailwind theme dependency.
 */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap";

const BUILD = {
  ver: "v0.1.0-PREVIEW",
  hash: "8a4f2c1",
  built: "26 APR 2026",
  status: "PRODUCTION",
};

const SPEC_ROWS = [
  ["RUNTIME", "Browser · Tablet · Phone · Thermal POS hardware"],
  ["INSTALL", "Progressive Web App · 5 minutes · zero dependencies"],
  ["LOCALE", "PKR · English · Urdu (selected screens)"],
  ["COMPLIANCE", "FBR digital invoicing · IRN · QR code · auto-retry queue"],
  ["OFFLINE", "Sale queue persists locally · auto-sync on reconnect"],
  ["HARDWARE", "USB scanners · ESC/POS thermal · network TCP/IP printers"],
  ["INTEGRATIONS", "Shopify · WooCommerce · Daraz · 13 Pakistan couriers"],
  ["SUPPORT", "Email · WhatsApp · in-app tickets"],
];

const FRAMES = [
  { n: "001", k: "POS", t: "Counter & barcode", body: "Split payment, park & recall, returns + exchanges, PIN re-auth, customer-facing display, F1–F10." },
  { n: "002", k: "INVENTORY", t: "Stock & movement", body: "Per-outlet stock, transfers, adjustments, kits/bundles, serials, dead stock, demand forecasting." },
  { n: "003", k: "PURCHASING", t: "PO & GRN", body: "Multi-level approvals, partial GRN, barcode receiving, supplier payables ledger, RMA returns." },
  { n: "004", k: "ACCOUNTING", t: "Books, in window", body: "P&L, balance sheet, cash flow, journal entries, AP/AR, post-dated cheques. No Xero needed." },
  { n: "005", k: "FULFILLMENT", t: "Pick · Pack · Ship", body: "Picklists, loadsheets, scan-dispatch, cross-channel order handling, order aging." },
  { n: "006", k: "CRM", t: "Wallet & loyalty", body: "Bronze→Platinum tiers, points transfer, 11-segment RFM, wallet ledger, blacklisting, segments." },
  { n: "007", k: "REPORTS", t: "67 tabs + AI", body: "Sales / stock / purchasing / payroll. AI panel answers in plain language. CSV export everywhere." },
  { n: "008", k: "INTEGRATIONS", t: "Channels & couriers", body: "Shopify + WooCommerce stock sync. 13 Pakistan courier integrations. Public OpenAPI." },
];

const MATRIX = [
  ["FBR digital invoicing", "INCLUDED", "ADD-ON / ABSENT"],
  ["Offline sale queue", "INCLUDED", "ABSENT"],
  ["Report tabs", "67+", "15–25"],
  ["Built-in accounting", "INCLUDED", "REQUIRES QB / XERO"],
  ["Wallet + tiered loyalty", "INCLUDED", "PAID ADD-ON"],
  ["RFM segmentation", "INCLUDED", "ABSENT"],
  ["Multi-outlet transfers", "INCLUDED", "ENTERPRISE TIER"],
  ["Pick / pack / dispatch", "INCLUDED", "SEPARATE WMS"],
  ["Shopify + Woo sync", "INCLUDED", "ENTERPRISE TIER"],
  ["Self-service signup", "5 MIN", "SALES CALL"],
  ["Free plan, all features", "INCLUDED", "TRIAL ONLY"],
  ["Thermal printer support", "ESC/POS + NETWORK", "BROWSER PRINT"],
];

const PLANS = [
  {
    code: "PLAN-FREE",
    name: "FREE",
    price: "0",
    cur: "PKR",
    cadence: "FOREVER",
    note: "INDEPENDENT SHOPS",
    lines: [
      "1 OUTLET",
      "UP TO 3 EMPLOYEES",
      "UP TO 100 PRODUCTS",
      "ALL FEATURES — NO LOCKS",
      "COMMUNITY SUPPORT",
    ],
    cta: { label: "OPEN ACCOUNT →", to: "/signup" },
    primary: false,
  },
  {
    code: "PLAN-PRO",
    name: "PRO",
    price: "8,000",
    cur: "PKR",
    cadence: "/ MONTH · OUTLET",
    note: "SHOPS WITH SCALE",
    lines: [
      "UNLIMITED EMPLOYEES",
      "UNLIMITED PRODUCTS",
      "MULTI-OUTLET (PAY PER OUTLET)",
      "FBR + AI INSIGHTS",
      "EMAIL + WHATSAPP SUPPORT",
      "45-DAY TRIAL · NO CARD",
    ],
    cta: { label: "START TRIAL →", to: "/signup?plan=pro" },
    primary: true,
  },
];

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function LandingBrutalist() {
  const [year] = useState(() => new Date().getFullYear());
  const fontInjected = useRef(false);

  useEffect(() => {
    if (fontInjected.current) return;
    fontInjected.current = true;
    if (!document.querySelector('link[data-lb-font="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      link.setAttribute("data-lb-font", "1");
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="lb-root">
      <style>{LB_STYLES}</style>

      {/* ── Top status bar ──────────────────────────────────────────── */}
      <div className="lb-status">
        <div className="lb-container lb-status-row">
          <span><span className="lb-dot" aria-hidden="true" />SYSTEM · {BUILD.status}</span>
          <span className="lb-status-mid">SANOPOS / RETAIL OS</span>
          <span>{BUILD.ver} · {BUILD.hash} · {BUILD.built}</span>
        </div>
      </div>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="lb-header">
        <div className="lb-container lb-header-row">
          <div className="lb-brand">
            <div className="lb-brand-mark">[ S ]</div>
            <div>
              <div className="lb-brand-name">SANOPOS</div>
              <div className="lb-brand-meta">RETAIL · CLINIC · SALON · F&B</div>
            </div>
          </div>
          <nav className="lb-nav">
            <a href="#frames">FRAMES</a>
            <a href="#matrix">MATRIX</a>
            <a href="#plans">PLANS</a>
            <Link to="/login" className="lb-nav-cta">SIGN IN ░</Link>
          </nav>
        </div>
        <div className="lb-bar lb-bar-thick" />
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="lb-hero">
        <div className="lb-container">
          <div className="lb-frame-tag">FRAME 001 / 008 ─────── HERO</div>
          <h1 className="lb-hero-title">
            <span>POINT</span>
            <span>OF</span>
            <span className="lb-hi">SALE.</span>
            <br />
            <span>BUILT</span>
            <span>IN</span>
            <span>PAKISTAN.</span>
            <br />
            <span>FBR</span>
            <span className="lb-hi">/</span>
            <span>READY.</span>
          </h1>

          <div className="lb-hero-grid">
            <div className="lb-hero-cell">
              <div className="lb-cell-label">SUMMARY</div>
              <p className="lb-cell-body">
                A complete back-office and counter system for Pakistani
                retailers, clinics, salons, and restaurants. FBR digital
                invoicing, offline sale queue, sixty-seven reports, and
                accounting — in one window, on every plan.
              </p>
            </div>
            <div className="lb-hero-cell">
              <div className="lb-cell-label">ACTION</div>
              <div className="lb-cta-stack">
                <Link to="/signup" className="lb-btn lb-btn-primary">
                  ▶ START 45-DAY TRIAL
                </Link>
                <Link to="/login" className="lb-btn lb-btn-ghost">
                  → SIGN IN
                </Link>
                <span className="lb-cta-fine">NO CARD · CANCEL FROM DASHBOARD</span>
              </div>
            </div>
            <div className="lb-hero-cell lb-hero-cell-status">
              <div className="lb-cell-label">STATUS / LIVE</div>
              <div className="lb-status-list">
                <div><span className="lb-led lb-led-on" />FBR API · 200 OK</div>
                <div><span className="lb-led lb-led-on" />SHOPIFY · SYNCED</div>
                <div><span className="lb-led lb-led-on" />OFFLINE QUEUE · 0 PENDING</div>
                <div><span className="lb-led lb-led-on" />UPTIME · 99.97%</div>
                <div><span className="lb-led lb-led-blink" />JOBS · RUNNING</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Spec sheet ─────────────────────────────────────────────── */}
      <section className="lb-spec">
        <div className="lb-container">
          <div className="lb-frame-tag">FRAME 002 / 008 ─────── SPECIFICATION</div>
          <div className="lb-spec-grid">
            {SPEC_ROWS.map(([k, v]) => (
              <div className="lb-spec-row" key={k}>
                <div className="lb-spec-key">{k}</div>
                <div className="lb-spec-dots" aria-hidden="true" />
                <div className="lb-spec-val">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats / counters ───────────────────────────────────────── */}
      <section className="lb-counters">
        <div className="lb-container lb-counters-row">
          <Counter num="67" label="REPORTS" />
          <Counter num="90" label="FEATURES" />
          <Counter num="00" label="LOCKS" />
          <Counter num="13" label="COURIERS" />
          <Counter num="11" label="RFM SEGMENTS" />
          <Counter num="100" label="% OFFLINE" />
        </div>
      </section>

      {/* ── Frames / features ──────────────────────────────────────── */}
      <section className="lb-frames" id="frames">
        <div className="lb-container">
          <div className="lb-section-head">
            <div className="lb-frame-tag">FRAME 003 / 008 ─────── MODULES</div>
            <h2 className="lb-section-title">EIGHT MODULES.<br />ONE SUBSCRIPTION.</h2>
          </div>
          <div className="lb-frames-grid">
            {FRAMES.map((f) => (
              <article className="lb-frame-card" key={f.n}>
                <div className="lb-frame-card-head">
                  <span className="lb-frame-card-n">{f.n}</span>
                  <span className="lb-frame-card-k">{f.k}</span>
                </div>
                <h3 className="lb-frame-card-t">{f.t}</h3>
                <p className="lb-frame-card-body">{f.body}</p>
                <div className="lb-frame-card-foot">
                  ░ MODULE READY · INCLUDED ON ALL PLANS
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Matrix / comparison ────────────────────────────────────── */}
      <section className="lb-matrix" id="matrix">
        <div className="lb-container">
          <div className="lb-section-head">
            <div className="lb-frame-tag">FRAME 004 / 008 ─────── COMPARISON MATRIX</div>
            <h2 className="lb-section-title">SANOPOS &nbsp;∶∶∶ &nbsp;THE FIELD.</h2>
          </div>
          <div className="lb-matrix-table">
            <div className="lb-matrix-row lb-matrix-head">
              <div>FEATURE</div>
              <div className="lb-mx-us">SANOPOS</div>
              <div className="lb-mx-them">THE FIELD</div>
            </div>
            {MATRIX.map(([feat, us, them], i) => (
              <div className="lb-matrix-row" key={i}>
                <div>{feat}</div>
                <div className="lb-mx-us">
                  <span className="lb-mx-tag lb-mx-tag-yes">{us}</span>
                </div>
                <div className="lb-mx-them">
                  <span className="lb-mx-tag lb-mx-tag-no">{them}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing as invoice ─────────────────────────────────────── */}
      <section className="lb-plans" id="plans">
        <div className="lb-container">
          <div className="lb-section-head">
            <div className="lb-frame-tag">FRAME 005 / 008 ─────── SUBSCRIPTION INVOICE</div>
            <h2 className="lb-section-title">TWO PLANS.<br />ALL FEATURES ON BOTH.</h2>
          </div>
          <div className="lb-invoice-grid">
            {PLANS.map((p) => (
              <article
                key={p.code}
                className={`lb-invoice ${p.primary ? "lb-invoice-primary" : ""}`}
              >
                <div className="lb-invoice-head">
                  <div>
                    <div className="lb-invoice-code">{p.code}</div>
                    <div className="lb-invoice-name">{p.name}</div>
                  </div>
                  <div className="lb-invoice-stamp">
                    {p.primary ? "▼ RECOMMENDED" : "● BASE TIER"}
                  </div>
                </div>
                <div className="lb-invoice-meta">
                  <span>SEGMENT · {p.note}</span>
                </div>
                <div className="lb-bar" />
                <div className="lb-invoice-amount">
                  <div className="lb-invoice-cur">{p.cur}</div>
                  <div className="lb-invoice-num">{p.price}</div>
                  <div className="lb-invoice-cadence">{p.cadence}</div>
                </div>
                <div className="lb-bar" />
                <div className="lb-invoice-lines">
                  {p.lines.map((l) => (
                    <div className="lb-invoice-line" key={l}>
                      <span className="lb-invoice-line-mark">[✓]</span>
                      <span>{l}</span>
                    </div>
                  ))}
                </div>
                <div className="lb-bar" />
                <Link
                  to={p.cta.to}
                  className={`lb-btn lb-btn-block ${p.primary ? "lb-btn-primary" : "lb-btn-ghost"}`}
                >
                  {p.cta.label}
                </Link>
              </article>
            ))}
          </div>
          <p className="lb-plans-fine">
            ──── EXTRA OUTLETS PURCHASABLE ANYTIME · DATA EXPORTABLE AS CSV · NO LOCK-IN ────
          </p>
        </div>
      </section>

      {/* ── Testimonial as receipt printout ────────────────────────── */}
      <section className="lb-quote-section">
        <div className="lb-container">
          <div className="lb-frame-tag lb-frame-tag-light">FRAME 006 / 008 ─────── FIELD REPORT</div>
          <div className="lb-quote-card">
            <div className="lb-quote-meta">
              <span>FIELD · LAHORE</span>
              <span>OPERATOR · BILAL A.</span>
              <span>OUTLETS · 03</span>
              <span>VERIFIED · ✓</span>
            </div>
            <div className="lb-bar lb-bar-light" />
            <blockquote className="lb-quote-text">
              "WE SWITCHED FROM A KARACHI VENDOR THAT CHARGED PER FEATURE.
              SANOPOS GAVE US FBR + MULTI-OUTLET + ACCOUNTING ON DAY ONE.
              CLOSING THE BOOKS USED TO TAKE A SATURDAY. NOW IT'S AN HOUR."
            </blockquote>
            <div className="lb-bar lb-bar-light" />
            <div className="lb-quote-foot">END OF REPORT · 003 OF 003</div>
          </div>
        </div>
      </section>

      {/* ── Pakistan-first credentials ─────────────────────────────── */}
      <section className="lb-creds">
        <div className="lb-container">
          <div className="lb-frame-tag">FRAME 007 / 008 ─────── REGIONAL FIT</div>
          <div className="lb-creds-grid">
            <div className="lb-cred">
              <div className="lb-cred-stamp">[ TAX ]</div>
              <div className="lb-cred-title">FBR DIGITAL INVOICING</div>
              <div className="lb-cred-body">REAL-TIME IRN · RETRY QUEUE · HS CODE INHERITANCE</div>
            </div>
            <div className="lb-cred">
              <div className="lb-cred-stamp">[ ₨ ]</div>
              <div className="lb-cred-title">PAKISTANI RUPEE NATIVE</div>
              <div className="lb-cred-body">PKR FORMATTING · DENOMINATION CASH DRAWER</div>
            </div>
            <div className="lb-cred">
              <div className="lb-cred-stamp">[ ⛟ ]</div>
              <div className="lb-cred-title">13 COURIER INTEGRATIONS</div>
              <div className="lb-cred-body">LEOPARDS · TCS · BLUEEX · POSTEX · TRAX · RIDER · SWYFT · BYKEA · MNP · DHL · FEDEX</div>
            </div>
            <div className="lb-cred">
              <div className="lb-cred-stamp">[ ░ ]</div>
              <div className="lb-cred-title">RELIABILITY STACK</div>
              <div className="lb-cred-body">CLOUDFLARE · SENTRY · UPTIMEROBOT · 5-MIN PINGS</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── End / CTA ──────────────────────────────────────────────── */}
      <section className="lb-end">
        <div className="lb-container">
          <div className="lb-frame-tag">FRAME 008 / 008 ─────── ACTION</div>
          <h2 className="lb-end-title">
            START TRIAL.<br />KEEP <span className="lb-hi">SELLING.</span>
          </h2>
          <div className="lb-end-actions">
            <Link to="/signup" className="lb-btn lb-btn-primary lb-btn-lg">
              ▶ START 45-DAY TRIAL
            </Link>
            <Link to="/login" className="lb-btn lb-btn-ghost lb-btn-lg">
              → SIGN IN
            </Link>
          </div>
          <div className="lb-end-fine">
            NO CARD · CANCEL FROM DASHBOARD · ALL FEATURES UNLOCKED
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="lb-foot">
        <div className="lb-bar lb-bar-thick" />
        <div className="lb-container">
          <div className="lb-foot-grid">
            <div>
              <div className="lb-foot-h">[ COLOPHON ]</div>
              <p>SET IN IBM PLEX MONO. COMPOSED IN LAHORE. SANOPOS IS A REGISTERED PRODUCT OF SANO MERCHANDISE.</p>
            </div>
            <div>
              <div className="lb-foot-h">[ FRAMES ]</div>
              <ul><li><a href="#frames">MODULES</a></li><li><a href="#matrix">MATRIX</a></li><li><a href="#plans">PLANS</a></li></ul>
            </div>
            <div>
              <div className="lb-foot-h">[ DESK ]</div>
              <ul><li><Link to="/login">SIGN IN</Link></li><li><Link to="/signup">OPEN ACCOUNT</Link></li><li><Link to="/terms">TERMS</Link></li><li><Link to="/privacy">PRIVACY</Link></li></ul>
            </div>
            <div>
              <div className="lb-foot-h">[ BUILD ]</div>
              <p>{BUILD.ver} · {BUILD.hash}<br />BUILT {BUILD.built}<br />© {year} SANO MERCHANDISE</p>
            </div>
          </div>
          <div className="lb-bar" />
          <div className="lb-foot-tail">
            ─── EOF ─── EOF ─── EOF ─── EOF ─── EOF ─── EOF ─── EOF ─── EOF ───
          </div>
        </div>
      </footer>
    </div>
  );
}

function Counter({ num, label }) {
  return (
    <div className="lb-counter">
      <div className="lb-counter-num">{num}</div>
      <div className="lb-counter-label">{label}</div>
    </div>
  );
}

/* ─── Stylesheet ─────────────────────────────────────────────────────────── */

const LB_STYLES = `
.lb-root {
  --paper: #FAFAF7;
  --paper-2: #F1F0EA;
  --ink: #0A0A0A;
  --ink-2: #2A2A2A;
  --ink-soft: #5A5A5A;
  --rule: #0A0A0A;
  --hi: #FFD500;
  --hi-soft: #FFF4B0;
  --bad: #BB2222;

  --mono: "IBM Plex Mono", "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
  --sans: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

  background: var(--paper);
  color: var(--ink);
  font-family: var(--mono);
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
  min-height: 100vh;
  overflow-x: hidden;
}

.lb-container {
  max-width: 1300px;
  margin: 0 auto;
  padding: 0 28px;
}
@media (max-width: 720px) { .lb-container { padding: 0 16px; } }

.lb-bar { height: 1px; background: var(--ink); width: 100%; }
.lb-bar-thick { height: 4px; }
.lb-bar-light { background: var(--paper-2); height: 1px; }

.lb-frame-tag {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--ink-2);
  font-weight: 500;
  padding: 12px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
}
.lb-frame-tag-light { color: var(--paper-2); }

/* ── Top status bar ──────────────────────────────────────────────── */
.lb-status {
  background: var(--ink);
  color: var(--paper);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  padding: 8px 0;
}
.lb-status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.lb-status-mid { color: var(--hi); font-weight: 600; }
@media (max-width: 720px) { .lb-status-mid { display: none; } }
.lb-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  background: var(--hi);
  border-radius: 50%;
  margin-right: 8px;
  animation: lb-pulse 1.6s ease-in-out infinite;
  vertical-align: middle;
}
@keyframes lb-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* ── Header ──────────────────────────────────────────────────────── */
.lb-header { padding: 16px 0 0; }
.lb-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18px;
  gap: 24px;
}
.lb-brand { display: flex; align-items: center; gap: 14px; }
.lb-brand-mark {
  background: var(--ink);
  color: var(--hi);
  font-family: var(--mono);
  font-weight: 700;
  font-size: 18px;
  padding: 6px 12px;
  letter-spacing: 0.08em;
}
.lb-brand-name {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 20px;
  letter-spacing: 0.05em;
  line-height: 1;
}
.lb-brand-meta {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--ink-soft);
  margin-top: 4px;
}
.lb-nav { display: flex; align-items: center; gap: 24px; }
.lb-nav a {
  font-family: var(--mono);
  font-weight: 500;
  font-size: 12.5px;
  letter-spacing: 0.1em;
  color: var(--ink);
  text-decoration: none;
  transition: color 0.1s;
}
.lb-nav a:hover { color: var(--ink-soft); }
.lb-nav-cta {
  background: var(--hi) !important;
  color: var(--ink) !important;
  padding: 10px 16px;
  border: 2px solid var(--ink);
  letter-spacing: 0.1em;
  font-weight: 600;
  transition: all 0.1s;
}
.lb-nav-cta:hover {
  background: var(--ink) !important;
  color: var(--hi) !important;
}
@media (max-width: 720px) {
  .lb-nav { gap: 12px; }
  .lb-nav a:not(.lb-nav-cta) { display: none; }
  .lb-brand-meta { display: none; }
}

/* ── Hero ────────────────────────────────────────────────────────── */
.lb-hero { padding: 48px 0 72px; }
.lb-hero-title {
  font-family: var(--mono);
  font-weight: 700;
  font-size: clamp(46px, 9.6vw, 148px);
  letter-spacing: -0.04em;
  line-height: 0.92;
  margin: 12px 0 56px;
  text-transform: uppercase;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.18em;
}
.lb-hero-title .lb-hi {
  background: var(--hi);
  padding: 0 0.08em;
  display: inline-block;
}
.lb-hero-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  border-top: 2px solid var(--ink);
  border-bottom: 2px solid var(--ink);
}
@media (max-width: 980px) {
  .lb-hero-grid { grid-template-columns: 1fr; }
  .lb-hero-cell { border-right: none !important; border-bottom: 1px solid var(--ink); }
  .lb-hero-cell:last-child { border-bottom: none; }
}
.lb-hero-cell {
  padding: 22px 22px 26px;
  border-right: 1px solid var(--ink);
}
.lb-hero-cell:last-child { border-right: none; }
.lb-cell-label {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--ink-soft);
  margin-bottom: 14px;
  font-weight: 500;
}
.lb-cell-body {
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink-2);
  margin: 0;
  font-weight: 400;
}
.lb-cta-stack { display: flex; flex-direction: column; gap: 8px; }
.lb-cta-fine {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--ink-soft);
  margin-top: 6px;
}
.lb-status-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  color: var(--ink-2);
  font-weight: 500;
}
.lb-led {
  display: inline-block;
  width: 9px;
  height: 9px;
  background: var(--hi);
  margin-right: 10px;
  vertical-align: middle;
  border: 1px solid var(--ink);
}
.lb-led-on { background: var(--hi); }
.lb-led-blink { animation: lb-blink 1s steps(2) infinite; }
@keyframes lb-blink {
  0%, 49% { background: var(--hi); }
  50%, 100% { background: var(--paper); }
}

/* ── Buttons ─────────────────────────────────────────────────────── */
.lb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--mono);
  font-weight: 600;
  font-size: 13px;
  padding: 14px 18px;
  text-decoration: none;
  border: 2px solid var(--ink);
  letter-spacing: 0.12em;
  transition: all 0.1s;
  cursor: pointer;
  text-transform: uppercase;
}
.lb-btn-block { width: 100%; }
.lb-btn-lg { padding: 18px 24px; font-size: 14px; }
.lb-btn-primary {
  background: var(--ink);
  color: var(--hi);
}
.lb-btn-primary:hover {
  background: var(--hi);
  color: var(--ink);
}
.lb-btn-ghost {
  background: var(--paper);
  color: var(--ink);
}
.lb-btn-ghost:hover {
  background: var(--ink);
  color: var(--paper);
}

/* ── Spec sheet ──────────────────────────────────────────────────── */
.lb-spec { padding: 56px 0; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); background: var(--paper-2); }
.lb-spec-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 56px;
}
@media (max-width: 720px) { .lb-spec-grid { grid-template-columns: 1fr; } }
.lb-spec-row {
  display: grid;
  grid-template-columns: 140px 1fr auto;
  align-items: baseline;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px dashed var(--ink-soft);
  font-family: var(--mono);
  font-size: 13px;
}
.lb-spec-key {
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink);
  font-size: 12px;
}
.lb-spec-dots {
  border-bottom: 1px dotted var(--ink-soft);
  height: 1px;
  align-self: end;
  margin-bottom: 6px;
}
.lb-spec-val {
  text-align: right;
  color: var(--ink-2);
  letter-spacing: 0.02em;
}

/* ── Counters ───────────────────────────────────────────────────── */
.lb-counters { background: var(--ink); color: var(--paper); padding: 36px 0; }
.lb-counters-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0;
}
@media (max-width: 720px) { .lb-counters-row { grid-template-columns: repeat(3, 1fr); gap: 24px; } }
.lb-counter {
  text-align: center;
  border-right: 1px solid var(--ink-2);
  padding: 8px;
}
.lb-counter:last-child { border-right: none; }
@media (max-width: 720px) {
  .lb-counter { border-right: none; }
}
.lb-counter-num {
  font-family: var(--mono);
  font-weight: 700;
  font-size: clamp(36px, 5vw, 56px);
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--hi);
}
.lb-counter-label {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.18em;
  color: var(--paper);
  margin-top: 8px;
  font-weight: 500;
}

/* ── Section heads ──────────────────────────────────────────────── */
.lb-section-head { padding-bottom: 16px; }
.lb-section-title {
  font-family: var(--mono);
  font-weight: 700;
  font-size: clamp(32px, 5vw, 64px);
  letter-spacing: -0.03em;
  line-height: 0.95;
  margin: 6px 0 24px;
  text-transform: uppercase;
}

/* ── Frames grid ────────────────────────────────────────────────── */
.lb-frames { padding: 80px 0; }
.lb-frames-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 2px solid var(--ink);
  border-left: 2px solid var(--ink);
}
@media (max-width: 1080px) { .lb-frames-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .lb-frames-grid { grid-template-columns: 1fr; } }
.lb-frame-card {
  border-right: 2px solid var(--ink);
  border-bottom: 2px solid var(--ink);
  padding: 20px 18px 18px;
  display: flex;
  flex-direction: column;
  background: var(--paper);
  transition: background 0.1s;
  position: relative;
}
.lb-frame-card:hover { background: var(--hi-soft); }
.lb-frame-card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 14px;
}
.lb-frame-card-n {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 36px;
  letter-spacing: -0.04em;
  line-height: 0.9;
  color: var(--ink);
}
.lb-frame-card-k {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--ink-soft);
  font-weight: 600;
}
.lb-frame-card-t {
  font-family: var(--mono);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0 0 10px;
  text-transform: uppercase;
}
.lb-frame-card-body {
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-2);
  margin: 0 0 14px;
  flex: 1;
}
.lb-frame-card-foot {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--ink-soft);
  padding-top: 10px;
  border-top: 1px dashed var(--ink-soft);
}

/* ── Matrix ──────────────────────────────────────────────────────── */
.lb-matrix { padding: 80px 0; background: var(--paper-2); border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
.lb-matrix-table {
  border: 2px solid var(--ink);
  background: var(--paper);
}
.lb-matrix-row {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr;
  gap: 0;
  border-bottom: 1px solid var(--ink);
}
.lb-matrix-row:last-child { border-bottom: none; }
.lb-matrix-row > div {
  padding: 14px 16px;
  font-family: var(--mono);
  font-size: 12.5px;
  letter-spacing: 0.04em;
  border-right: 1px solid var(--ink);
}
.lb-matrix-row > div:last-child { border-right: none; }
.lb-matrix-head {
  background: var(--ink);
  color: var(--paper);
  border-bottom: 2px solid var(--ink);
}
.lb-matrix-head > div {
  font-weight: 700;
  letter-spacing: 0.12em;
  font-size: 11px;
  border-right-color: var(--ink-2);
}
.lb-matrix-head .lb-mx-us { color: var(--hi); }
.lb-mx-tag {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  font-weight: 600;
  padding: 2px 8px;
  display: inline-block;
}
.lb-mx-tag-yes { background: var(--hi); color: var(--ink); }
.lb-mx-tag-no { background: var(--paper-2); color: var(--ink-soft); border: 1px dashed var(--ink-soft); }
@media (max-width: 720px) {
  .lb-matrix-row { grid-template-columns: 1fr; }
  .lb-matrix-row > div { border-right: none; border-bottom: 1px dashed var(--ink-soft); }
  .lb-matrix-row > div:last-child { border-bottom: none; }
}

/* ── Plans / invoice ────────────────────────────────────────────── */
.lb-plans { padding: 80px 0; }
.lb-invoice-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-top: 16px;
}
@media (max-width: 840px) { .lb-invoice-grid { grid-template-columns: 1fr; } }
.lb-invoice {
  border: 2px solid var(--ink);
  padding: 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--paper);
  position: relative;
}
.lb-invoice-primary {
  background: var(--ink);
  color: var(--paper);
}
.lb-invoice-primary .lb-bar { background: var(--paper-2); }
.lb-invoice-head { display: flex; justify-content: space-between; align-items: flex-start; }
.lb-invoice-code {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--ink-soft);
  font-weight: 600;
  margin-bottom: 4px;
}
.lb-invoice-primary .lb-invoice-code { color: var(--paper-2); }
.lb-invoice-name {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 36px;
  letter-spacing: -0.03em;
  line-height: 1;
}
.lb-invoice-stamp {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  font-weight: 600;
  padding: 4px 10px;
  background: var(--hi);
  color: var(--ink);
}
.lb-invoice:not(.lb-invoice-primary) .lb-invoice-stamp {
  background: var(--paper-2);
  color: var(--ink);
  border: 1px solid var(--ink);
}
.lb-invoice-meta {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--ink-soft);
}
.lb-invoice-primary .lb-invoice-meta { color: var(--paper-2); }
.lb-invoice-amount {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
}
.lb-invoice-cur {
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
}
.lb-invoice-primary .lb-invoice-cur { color: var(--hi); }
.lb-invoice-num {
  font-family: var(--mono);
  font-weight: 700;
  font-size: clamp(48px, 8vw, 96px);
  letter-spacing: -0.04em;
  line-height: 1;
}
.lb-invoice-primary .lb-invoice-num { color: var(--hi); }
.lb-invoice-cadence {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--ink-soft);
  margin-left: auto;
}
.lb-invoice-primary .lb-invoice-cadence { color: var(--paper-2); }
.lb-invoice-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: var(--mono);
  font-size: 12.5px;
  letter-spacing: 0.04em;
}
.lb-invoice-line { display: flex; gap: 10px; align-items: baseline; }
.lb-invoice-line-mark { color: var(--hi); font-weight: 700; }
.lb-invoice:not(.lb-invoice-primary) .lb-invoice-line-mark { color: var(--ink); }

.lb-plans-fine {
  text-align: center;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--ink-soft);
  margin: 36px 0 0;
}

/* ── Quote section ──────────────────────────────────────────────── */
.lb-quote-section { background: var(--ink); color: var(--paper); padding: 80px 0; }
.lb-quote-section .lb-frame-tag { color: var(--paper-2); }
.lb-quote-card {
  border: 2px solid var(--paper-2);
  padding: 28px 24px;
  background: var(--ink);
}
.lb-quote-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 28px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--paper-2);
  margin-bottom: 18px;
}
.lb-quote-meta span:last-child { color: var(--hi); }
.lb-quote-text {
  font-family: var(--mono);
  font-weight: 500;
  font-size: clamp(22px, 3vw, 34px);
  letter-spacing: -0.01em;
  line-height: 1.35;
  text-transform: uppercase;
  margin: 22px 0;
}
.lb-quote-foot {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--paper-2);
  margin-top: 16px;
}

/* ── Credentials ─────────────────────────────────────────────────── */
.lb-creds { padding: 80px 0; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
.lb-creds-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 2px solid var(--ink);
  border-left: 2px solid var(--ink);
  margin-top: 8px;
}
@media (max-width: 980px) { .lb-creds-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .lb-creds-grid { grid-template-columns: 1fr; } }
.lb-cred {
  border-right: 2px solid var(--ink);
  border-bottom: 2px solid var(--ink);
  padding: 22px 18px;
  background: var(--paper);
  transition: background 0.1s;
}
.lb-cred:hover { background: var(--hi-soft); }
.lb-cred-stamp {
  display: inline-block;
  background: var(--ink);
  color: var(--hi);
  font-family: var(--mono);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.06em;
  padding: 4px 10px;
  margin-bottom: 14px;
}
.lb-cred-title {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 14.5px;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}
.lb-cred-body {
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  color: var(--ink-2);
  line-height: 1.55;
}

/* ── End ─────────────────────────────────────────────────────────── */
.lb-end { padding: 96px 0; text-align: center; background: var(--paper-2); border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
.lb-end .lb-frame-tag { display: inline-block; }
.lb-end-title {
  font-family: var(--mono);
  font-weight: 700;
  font-size: clamp(40px, 7vw, 96px);
  letter-spacing: -0.04em;
  line-height: 0.95;
  margin: 12px 0 36px;
  text-transform: uppercase;
}
.lb-end-title .lb-hi {
  background: var(--hi);
  padding: 0 0.08em;
  display: inline-block;
}
.lb-end-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
.lb-end-fine {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--ink-soft);
  margin-top: 28px;
}

/* ── Footer ─────────────────────────────────────────────────────── */
.lb-foot { background: var(--ink); color: var(--paper); padding: 0 0 28px; }
.lb-foot .lb-bar { background: var(--paper-2); }
.lb-foot-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
  padding: 36px 0 24px;
}
@media (max-width: 720px) { .lb-foot-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .lb-foot-grid { grid-template-columns: 1fr; } }
.lb-foot-h {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--hi);
  margin-bottom: 12px;
}
.lb-foot p, .lb-foot ul {
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  color: var(--paper-2);
  line-height: 1.7;
  margin: 0;
}
.lb-foot ul { list-style: none; padding: 0; }
.lb-foot a {
  color: var(--paper);
  text-decoration: none;
  transition: color 0.1s;
}
.lb-foot a:hover { color: var(--hi); }
.lb-foot-tail {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--paper-2);
  text-align: center;
  margin-top: 18px;
  white-space: nowrap;
  overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .lb-dot, .lb-led-blink { animation: none; }
}
`;
