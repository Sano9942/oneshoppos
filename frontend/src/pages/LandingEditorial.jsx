import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Editorial landing page — preview at /preview/landing-v2
 *
 * Concept: "A trade journal of modern retail."
 * Self-contained: injects its own fonts, owns its own theme tokens, does not
 * touch Tailwind theme. Renders only on /preview/landing-v2.
 */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,300..900,0..100&family=Hanken+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap";

const ISSUE = {
  vol: "VOL. I",
  no: "NO. 04",
  edition: "LAHORE EDITION",
  date: "APRIL 2026",
};

const STATS = [
  { num: "67+", label: "Report Tabs" },
  { num: "90+", label: "Built-in Features" },
  { num: "0", label: "Feature Locks" },
  { num: "5 min", label: "Setup Time" },
  { num: "100%", label: "Works Offline" },
];

const INDUSTRIES = [
  {
    n: "01",
    name: "Retail Floor",
    body: "Barcode lanes, multi-outlet stock transfers, demand forecasting, and a POS that survives load-shedding.",
  },
  {
    n: "02",
    name: "Salon & Spa",
    body: "Service tickets, commission plans, package & membership tracking, walk-in staff assignment.",
  },
  {
    n: "03",
    name: "Clinic & Pharmacy",
    body: "Treatment plans, dental & physiotherapy charts, batch & expiry tracking, FBR-grade invoicing.",
  },
  {
    n: "04",
    name: "Restaurant & Café",
    body: "Floor plan, KDS, table & check management, QR ordering, kitchen-printed bills, split & merge.",
  },
];

const DEPARTMENTS = [
  {
    n: "I",
    kicker: "Compliance",
    title: "FBR Digital Invoicing",
    body: "Real-time posting with auto-retry queue and category-level HS codes. The kind of compliance you stop thinking about.",
    span: 2,
  },
  {
    n: "II",
    kicker: "Resilience",
    title: "Offline Sale Queuing",
    body: "Sales ring up locally, sync when the line returns. Outages stop being events.",
    span: 1,
  },
  {
    n: "III",
    kicker: "Insight",
    title: "Sixty-Seven Reports",
    body: "Sales, stock, purchasing, accounting, payroll. Plus an AI panel that answers in plain language.",
    span: 1,
  },
  {
    n: "IV",
    kicker: "Loyalty",
    title: "Wallet, Tiers, RFM",
    body: "Bronze through Platinum, points transfer, an eleven-segment RFM map, and a wallet ledger that balances.",
    span: 2,
  },
  {
    n: "V",
    kicker: "Ledger",
    title: "Accounting, Built In",
    body: "P&L, balance sheet, cash flow, journal entries, AP/AR, post-dated cheques. No QuickBooks. No Xero.",
    span: 2,
  },
  {
    n: "VI",
    kicker: "Operations",
    title: "Pick · Pack · Dispatch",
    body: "Loadsheets, scan-dispatch, GRN by barcode, cross-channel order handling. Warehouse-grade in a POS.",
    span: 1,
  },
  {
    n: "VII",
    kicker: "Channels",
    title: "Shopify · WooCommerce · Daraz",
    body: "Stock, orders, and pricing kept in lockstep across counter and channel. One inventory of record.",
    span: 1,
  },
  {
    n: "VIII",
    kicker: "Hardware",
    title: "Thermal & Network Print",
    body: "ESC/POS over USB. TCP/IP to network printers. Standard retail kit, no special drivers.",
    span: 2,
  },
];

const COMPARISON = [
  ["FBR digital invoicing — real time", true, "Add-on, or absent"],
  ["Offline sale queuing", true, "Not available"],
  ["Report tabs", "67+", "15 to 25 typical"],
  ["Built-in accounting (P&L, ledgers, journals)", true, "Requires QuickBooks / Xero"],
  ["Customer wallet & tiered loyalty", true, "Paid add-on"],
  ["RFM segmentation, 11 segments", true, "Rare or absent"],
  ["Promotions engine + price lists", true, "Limited or enterprise tier"],
  ["Multi-outlet stock transfers", true, "Enterprise tier only"],
  ["Pick / pack / dispatch workflow", true, "Separate WMS required"],
  ["Shopify + WooCommerce sync", true, "Enterprise tier only"],
  ["Self-service signup", "5 minutes", "Requires sales call"],
  ["Free plan with all features", true, "Limited or trial only"],
];

const PRICING = [
  {
    chapter: "I",
    name: "Free",
    price: "₨ 0",
    cadence: "/ forever",
    note: "For independent shops getting on their feet.",
    inclusions: [
      "1 outlet, up to 3 employees",
      "Up to 100 products",
      "All features. No locks.",
      "Community support",
    ],
    cta: { label: "Start free", to: "/signup" },
    primary: false,
  },
  {
    chapter: "II",
    name: "Pro",
    price: "₨ 8,000",
    cadence: "/ month, per outlet",
    note: "For shops that have outgrown spreadsheets.",
    inclusions: [
      "Unlimited employees & products",
      "Multi-outlet — pay only for what you add",
      "FBR digital invoicing + AI insights",
      "Email + WhatsApp support, 45-day trial",
    ],
    cta: { label: "Begin a 45-day trial", to: "/signup?plan=pro" },
    primary: true,
  },
];

/* ─── Receipt artifact (CSS-only thermal mock) ──────────────────────────── */

function ReceiptArtifact() {
  return (
    <div className="receipt-wrap">
      <div className="receipt-perf receipt-perf-top" aria-hidden="true" />
      <div className="receipt-paper">
        <div className="receipt-head">
          <div className="receipt-shop">PACKAGES MALL · LAHORE</div>
          <div className="receipt-meta">Tax Invoice · Outlet 01</div>
        </div>
        <div className="receipt-rule" />
        <div className="receipt-rows">
          <div className="receipt-row">
            <span>1 × Khaadi Lawn 3pc</span>
            <span>4,950</span>
          </div>
          <div className="receipt-row">
            <span>2 × Sapphire Kurta</span>
            <span>3,800</span>
          </div>
          <div className="receipt-row">
            <span>1 × Sana Safinaz Dupatta</span>
            <span>2,200</span>
          </div>
          <div className="receipt-row receipt-row-faint">
            <span>Promo · SPRING10</span>
            <span>−1,095</span>
          </div>
        </div>
        <div className="receipt-rule" />
        <div className="receipt-row receipt-row-bold">
          <span>Total · PKR</span>
          <span>9,855</span>
        </div>
        <div className="receipt-rule receipt-rule-thin" />
        <div className="receipt-fbr">
          <div className="receipt-irn">
            <div className="receipt-label">FBR · IRN</div>
            <div className="receipt-mono">7000007D9-260418-00041</div>
          </div>
          <div className="receipt-qr" aria-hidden="true">
            <div className="qr-grid">
              {Array.from({ length: 49 }).map((_, i) => (
                <span key={i} data-on={[1, 2, 4, 6, 7, 9, 12, 13, 18, 20, 22, 25, 27, 30, 31, 34, 38, 41, 42, 44, 47].includes(i) ? "1" : "0"} />
              ))}
            </div>
          </div>
        </div>
        <div className="receipt-foot">
          THANK YOU · BACK SOON<br />
          sanopos.com / receipt / 41
        </div>
      </div>
      <div className="receipt-perf receipt-perf-bottom" aria-hidden="true" />
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function LandingEditorial() {
  const [year] = useState(() => new Date().getFullYear());
  const fontInjected = useRef(false);

  useEffect(() => {
    if (fontInjected.current) return;
    fontInjected.current = true;
    if (!document.querySelector('link[data-le-font="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      link.setAttribute("data-le-font", "1");
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="le-root">
      <style>{LE_STYLES}</style>

      {/* ── Masthead ─────────────────────────────────────────────────── */}
      <header className="le-mast">
        <div className="le-container">
          <div className="le-mast-top">
            <span className="le-mono">{ISSUE.vol} · {ISSUE.no}</span>
            <span className="le-mono le-hide-sm">{ISSUE.edition}</span>
            <span className="le-mono">{ISSUE.date}</span>
          </div>
          <div className="le-rule" />
          <div className="le-mast-row">
            <h1 className="le-wordmark">SanoPOS</h1>
            <nav className="le-mast-nav">
              <a href="#departments">Departments</a>
              <a href="#pricing">Pricing</a>
              <a href="#field">Field Notes</a>
              <Link to="/login" className="le-mast-cta">Sign in →</Link>
            </nav>
          </div>
          <div className="le-rule" />
          <p className="le-folio">
            <em>A trade journal of modern retail</em> — printed in Lahore for shops, salons,
            clinics and kitchens that ring up sales the right way.
          </p>
        </div>
      </header>

      {/* ── Hero spread ──────────────────────────────────────────────── */}
      <section className="le-hero">
        <div className="le-container le-hero-grid">
          <div className="le-hero-copy">
            <span className="le-kicker">The leader · April 2026</span>
            <h2 className="le-hero-headline">
              <span className="le-dropcap">A</span> point of sale
              that reads like a <em>story</em>,
              <br /> not a spreadsheet.
            </h2>
            <p className="le-lede">
              SanoPOS is a complete back-office and counter system for Pakistani
              retailers — <strong>FBR-ready, offline-tolerant, and unbundled from
              add-ons</strong>. Sixty-seven reports, accounting in the same window,
              and a free tier that does not flinch at feature locks.
            </p>
            <div className="le-cta-row">
              <Link to="/signup" className="le-btn le-btn-primary">
                Begin a 45-day trial
                <span className="le-btn-arrow" aria-hidden="true">→</span>
              </Link>
              <Link to="/login" className="le-btn le-btn-ghost">
                Sign in to your shop
              </Link>
            </div>
            <div className="le-hero-credits">
              <span className="le-mono">SET IN</span>
              <span>Fraunces · Hanken Grotesk · JetBrains Mono</span>
              <span className="le-mono">·</span>
              <span>No card required</span>
            </div>
          </div>
          <aside className="le-hero-art">
            <ReceiptArtifact />
            <p className="le-art-cap">
              <span className="le-mono">FIG. 01</span> &nbsp;A live tax invoice with FBR IRN,
              composed at counter on a thermal printer.
            </p>
          </aside>
        </div>
      </section>

      {/* ── Stats strip ──────────────────────────────────────────────── */}
      <section className="le-stats">
        <div className="le-container">
          <div className="le-stats-label le-mono">By the numbers</div>
          <div className="le-stats-row">
            {STATS.map((s, i) => (
              <div className="le-stat" key={s.label}>
                <div className="le-stat-num">{s.num}</div>
                <div className="le-stat-label">{s.label}</div>
                {i < STATS.length - 1 && <span className="le-stat-rule" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pull-quote / Editorial ───────────────────────────────────── */}
      <section className="le-quote">
        <div className="le-container">
          <p className="le-quote-text">
            "We built SanoPOS for the small shop owner who has been told for
            years that they need <em>enterprise software</em>. They don't.
            They need software that respects their time, their language, and
            their margins."
          </p>
          <p className="le-quote-attr le-mono">
            — Founder's Note · Lahore, 2025
          </p>
        </div>
      </section>

      {/* ── Industries spread ────────────────────────────────────────── */}
      <section className="le-section" id="industries">
        <div className="le-container">
          <header className="le-sec-head">
            <span className="le-mono">§ Industries served</span>
            <h3 className="le-sec-title">
              Built thin enough for a kiosk, deep enough for a chain.
            </h3>
          </header>
          <div className="le-rule" />
          <div className="le-industries">
            {INDUSTRIES.map((it) => (
              <article className="le-ind-card" key={it.n}>
                <div className="le-ind-num le-mono">{it.n} / 04</div>
                <h4 className="le-ind-name">{it.name}</h4>
                <p className="le-ind-body">{it.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Departments / Features ──────────────────────────────────── */}
      <section className="le-section le-departments" id="departments">
        <div className="le-container">
          <header className="le-sec-head">
            <span className="le-mono">§ Departments</span>
            <h3 className="le-sec-title">
              The features, set down in their proper columns.
            </h3>
          </header>
          <div className="le-rule" />
          <div className="le-dept-grid">
            {DEPARTMENTS.map((d) => (
              <article
                key={d.n}
                className={`le-dept-card le-dept-span-${d.span}`}
              >
                <div className="le-dept-head">
                  <span className="le-dept-num">{d.n}.</span>
                  <span className="le-mono le-dept-kicker">{d.kicker}</span>
                </div>
                <h4 className="le-dept-title">{d.title}</h4>
                <p className="le-dept-body">{d.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing as table of contents ─────────────────────────────── */}
      <section className="le-section le-pricing" id="pricing">
        <div className="le-container">
          <header className="le-sec-head">
            <span className="le-mono">§ Subscriptions</span>
            <h3 className="le-sec-title">
              Two plans. Every feature on both.
            </h3>
          </header>
          <div className="le-rule" />
          <div className="le-toc">
            {PRICING.map((p) => (
              <article
                key={p.name}
                className={`le-toc-row ${p.primary ? "le-toc-primary" : ""}`}
              >
                <div className="le-toc-chapter le-mono">CHAPTER {p.chapter}</div>
                <div className="le-toc-body">
                  <div className="le-toc-headline">
                    <h4 className="le-toc-name">{p.name}</h4>
                    <span className="le-toc-leader" aria-hidden="true" />
                    <div className="le-toc-price">
                      <span className="le-toc-price-num">{p.price}</span>
                      <span className="le-toc-price-cadence">{p.cadence}</span>
                    </div>
                  </div>
                  <p className="le-toc-note">{p.note}</p>
                  <ul className="le-toc-list">
                    {p.inclusions.map((line) => (
                      <li key={line}>
                        <span className="le-toc-bullet" aria-hidden="true">·</span>
                        {line}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to={p.cta.to}
                    className={`le-btn ${p.primary ? "le-btn-primary" : "le-btn-ghost"}`}
                  >
                    {p.cta.label}
                    <span className="le-btn-arrow" aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
          </div>
          <p className="le-pricing-fine">
            Need more outlets? Add them as a paid line-item, any time.
            Cancel from the dashboard. Your data is yours, exportable as CSV.
          </p>
        </div>
      </section>

      {/* ── Comparison ──────────────────────────────────────────────── */}
      <section className="le-section le-compare" id="field">
        <div className="le-container">
          <header className="le-sec-head">
            <span className="le-mono">§ Field notes</span>
            <h3 className="le-sec-title">
              SanoPOS vs. the field, line by line.
            </h3>
          </header>
          <div className="le-rule" />
          <div className="le-table-wrap">
            <table className="le-table">
              <thead>
                <tr>
                  <th></th>
                  <th className="le-table-us">SanoPOS</th>
                  <th>The Field</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([feat, us, them], i) => (
                  <tr key={i}>
                    <td>{feat}</td>
                    <td className="le-table-us">
                      {us === true ? <span className="le-check">✓</span> : us}
                    </td>
                    <td className="le-table-them">{them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Testimonial ─────────────────────────────────────────────── */}
      <section className="le-section le-testimonial">
        <div className="le-container">
          <span className="le-mono">A reader writes —</span>
          <blockquote className="le-test-quote">
            "We switched from a Karachi vendor that charged us per feature.
            SanoPOS gave us FBR, multi-outlet, and accounting on the first day.
            The closing of books used to take a Saturday. Now it's an hour."
          </blockquote>
          <div className="le-test-attr">
            <span className="le-test-name">Bilal A.</span>
            <span className="le-mono">·</span>
            <span>Owner, three-outlet apparel chain</span>
            <span className="le-mono">·</span>
            <span>Lahore</span>
          </div>
        </div>
      </section>

      {/* ── Pakistan-first colophon strip ──────────────────────────── */}
      <section className="le-section le-credentials">
        <div className="le-container">
          <div className="le-cred-grid">
            <div className="le-cred-cell">
              <span className="le-mono">Tax</span>
              <strong>FBR Digital Invoicing</strong>
              <span>Real-time IRN, retry queue, HS code inheritance.</span>
            </div>
            <div className="le-cred-cell">
              <span className="le-mono">Currency</span>
              <strong>Pakistani Rupee · ₨</strong>
              <span>Native PKR formatting, denominations, cash drawer.</span>
            </div>
            <div className="le-cred-cell">
              <span className="le-mono">Couriers</span>
              <strong>13 Pakistan integrations</strong>
              <span>Leopards, TCS, BlueEx, Postex, Trax, Rider, Swyft, Bykea…</span>
            </div>
            <div className="le-cred-cell">
              <span className="le-mono">Reliability</span>
              <strong>Cloudflare · Sentry · UptimeRobot</strong>
              <span>5-minute pings, structured logs, error tracking.</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── End CTA ─────────────────────────────────────────────────── */}
      <section className="le-section le-end">
        <div className="le-container le-end-inner">
          <h3 className="le-end-headline">
            Begin your subscription.
          </h3>
          <p className="le-end-sub">
            Forty-five days, every feature, no card. Cancel from the dashboard.
          </p>
          <div className="le-cta-row">
            <Link to="/signup" className="le-btn le-btn-primary le-btn-lg">
              Start the trial
              <span className="le-btn-arrow" aria-hidden="true">→</span>
            </Link>
            <Link to="/login" className="le-btn le-btn-ghost le-btn-lg">
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      {/* ── Colophon ────────────────────────────────────────────────── */}
      <footer className="le-foot">
        <div className="le-container">
          <div className="le-rule" />
          <div className="le-foot-grid">
            <div>
              <div className="le-mono">COLOPHON</div>
              <p className="le-foot-text">
                Set in Fraunces, Hanken Grotesk, and JetBrains Mono.
                Composed in Lahore. <strong>SanoPOS</strong> is a registered
                product of Sano Merchandise.
              </p>
            </div>
            <div>
              <div className="le-mono">SECTIONS</div>
              <ul className="le-foot-list">
                <li><a href="#departments">Departments</a></li>
                <li><a href="#industries">Industries</a></li>
                <li><a href="#pricing">Subscriptions</a></li>
                <li><a href="#field">Field Notes</a></li>
              </ul>
            </div>
            <div>
              <div className="le-mono">DESK</div>
              <ul className="le-foot-list">
                <li><Link to="/login">Sign in</Link></li>
                <li><Link to="/signup">Open an account</Link></li>
                <li><Link to="/terms">Terms</Link></li>
                <li><Link to="/privacy">Privacy</Link></li>
              </ul>
            </div>
            <div>
              <div className="le-mono">EDITION</div>
              <p className="le-foot-text">
                Vol. I · No. 04 · April 2026 · Lahore. <br />
                © {year} Sano Merchandise. All rights reserved.
              </p>
            </div>
          </div>
          <p className="le-foot-tail le-mono">
            — END OF EDITION —
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ─── Stylesheet ─────────────────────────────────────────────────────────── */

const LE_STYLES = `
.le-root {
  --paper: #F5F0E6;
  --paper-2: #EFE9DD;
  --ink: #1A1814;
  --ink-2: #4A453E;
  --ink-soft: #6B6358;
  --rule: #1A1814;
  --accent: #C2410C;
  --accent-soft: #FED7AA;
  --highlight: #E8B73C;

  --serif: "Fraunces", Georgia, "Times New Roman", serif;
  --sans: "Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;

  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-feature-settings: "ss01", "ss02";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
  overflow-x: hidden;
}

/* paper grain */
.le-root::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.06;
  z-index: 1;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  mix-blend-mode: multiply;
}
.le-root > * { position: relative; z-index: 2; }

.le-container {
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 32px;
}
@media (max-width: 720px) {
  .le-container { padding: 0 20px; }
}

.le-mono {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-2);
  font-weight: 500;
}

.le-rule {
  height: 1px;
  background: var(--rule);
  width: 100%;
}

.le-hide-sm {
  display: inline;
}
@media (max-width: 720px) { .le-hide-sm { display: none; } }

/* ── Masthead ──────────────────────────────────────────────────────── */
.le-mast {
  padding: 22px 0 26px;
}
.le-mast-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0 10px;
  gap: 16px;
}
.le-mast-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 14px 0 12px;
  gap: 32px;
}
.le-wordmark {
  font-family: var(--serif);
  font-weight: 700;
  font-size: clamp(48px, 9vw, 112px);
  letter-spacing: -0.045em;
  line-height: 0.85;
  margin: 0;
  font-variation-settings: "SOFT" 30, "opsz" 144;
}
.le-mast-nav {
  display: flex;
  align-items: center;
  gap: 26px;
  padding-bottom: 10px;
}
.le-mast-nav a {
  font-family: var(--sans);
  font-weight: 500;
  font-size: 14px;
  letter-spacing: 0.01em;
  color: var(--ink);
  text-decoration: none;
  transition: color 0.15s;
}
.le-mast-nav a:hover { color: var(--accent); }
.le-mast-cta {
  background: var(--ink);
  color: var(--paper) !important;
  padding: 10px 18px;
  border-radius: 0;
  font-weight: 600;
  transition: background 0.15s;
}
.le-mast-cta:hover { background: var(--accent) !important; }
@media (max-width: 720px) {
  .le-mast-nav { gap: 14px; }
  .le-mast-nav a:not(.le-mast-cta) { display: none; }
}

.le-folio {
  font-family: var(--serif);
  font-style: italic;
  font-size: 16px;
  color: var(--ink-2);
  margin: 14px 0 0;
  text-align: center;
  font-weight: 400;
}

/* ── Hero ──────────────────────────────────────────────────────────── */
.le-hero {
  padding: 72px 0 96px;
}
.le-hero-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 80px;
  align-items: start;
}
@media (max-width: 980px) {
  .le-hero-grid { grid-template-columns: 1fr; gap: 56px; }
}
.le-kicker {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 600;
  display: inline-block;
  padding-bottom: 18px;
}
.le-hero-headline {
  font-family: var(--serif);
  font-size: clamp(40px, 6.4vw, 86px);
  font-weight: 400;
  line-height: 0.96;
  letter-spacing: -0.025em;
  color: var(--ink);
  margin: 0 0 28px;
  font-variation-settings: "SOFT" 50, "opsz" 144;
}
.le-hero-headline em {
  font-style: italic;
  color: var(--accent);
  font-weight: 400;
}
.le-dropcap {
  font-family: var(--serif);
  font-weight: 700;
  font-size: 1.6em;
  float: left;
  line-height: 0.85;
  padding: 0.05em 0.08em 0 0;
  margin-right: 0.04em;
  color: var(--ink);
  font-variation-settings: "SOFT" 0, "opsz" 144;
}
.le-lede {
  font-family: var(--serif);
  font-size: clamp(17px, 1.6vw, 20px);
  line-height: 1.55;
  color: var(--ink-2);
  max-width: 580px;
  margin: 0 0 32px;
}
.le-lede strong { color: var(--ink); font-weight: 600; }

.le-cta-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.le-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 15px;
  padding: 14px 22px;
  text-decoration: none;
  border-radius: 0;
  transition: transform 0.15s, background 0.15s, color 0.15s;
  border: 1px solid var(--ink);
  cursor: pointer;
  letter-spacing: 0.005em;
}
.le-btn-lg { padding: 18px 28px; font-size: 16px; }
.le-btn-primary {
  background: var(--ink);
  color: var(--paper);
}
.le-btn-primary:hover {
  background: var(--accent);
  border-color: var(--accent);
}
.le-btn-ghost {
  background: transparent;
  color: var(--ink);
}
.le-btn-ghost:hover {
  background: var(--ink);
  color: var(--paper);
}
.le-btn-arrow {
  display: inline-block;
  transition: transform 0.15s;
}
.le-btn:hover .le-btn-arrow { transform: translateX(4px); }

.le-hero-credits {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 28px;
  font-family: var(--sans);
  font-size: 12px;
  color: var(--ink-soft);
  letter-spacing: 0.02em;
}
.le-hero-credits .le-mono { color: var(--ink-2); }

/* ── Receipt artifact ──────────────────────────────────────────────── */
.le-hero-art {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}
.receipt-wrap {
  width: 320px;
  max-width: 100%;
  filter: drop-shadow(0 30px 60px rgba(26,24,20,0.18))
          drop-shadow(0 8px 18px rgba(26,24,20,0.10));
  transform: rotate(-1.6deg);
  transition: transform 0.4s ease;
  position: relative;
}
.receipt-wrap:hover { transform: rotate(0deg) translateY(-4px); }
.receipt-paper {
  background: linear-gradient(180deg, #FBF8F2 0%, #F5EFE2 100%);
  padding: 28px 26px 28px;
  font-family: var(--mono);
  font-size: 12px;
  color: #2A271F;
  position: relative;
}
.receipt-perf {
  height: 12px;
  background:
    radial-gradient(circle at 6px 6px, transparent 4px, #FBF8F2 4.5px) 0 0 / 12px 12px;
}
.receipt-perf-top {
  background:
    radial-gradient(circle at 6px 0, var(--paper) 4px, #FBF8F2 4.5px) 0 0 / 12px 12px;
}
.receipt-perf-bottom {
  background:
    radial-gradient(circle at 6px 12px, var(--paper) 4px, #F5EFE2 4.5px) 0 0 / 12px 12px;
}
.receipt-head {
  text-align: center;
  margin-bottom: 12px;
}
.receipt-shop {
  font-weight: 600;
  letter-spacing: 0.06em;
  font-size: 11px;
  margin-bottom: 4px;
}
.receipt-meta {
  font-size: 10px;
  color: #5C5648;
  letter-spacing: 0.04em;
}
.receipt-rule {
  height: 0;
  border-top: 1px dashed #6B6358;
  margin: 10px 0;
}
.receipt-rule-thin {
  border-top: 1px dashed #B8AE9A;
  margin: 8px 0;
}
.receipt-rows { display: flex; flex-direction: column; gap: 6px; }
.receipt-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  letter-spacing: 0.02em;
}
.receipt-row-faint { color: var(--accent); }
.receipt-row-bold { font-weight: 700; font-size: 13px; padding-top: 2px; }

.receipt-fbr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 14px 0 10px;
  gap: 12px;
}
.receipt-label {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: #6B6358;
  margin-bottom: 4px;
}
.receipt-mono { font-size: 10px; font-weight: 600; letter-spacing: 0.04em; }
.receipt-qr {
  width: 56px;
  height: 56px;
  background: #FBF8F2;
  padding: 4px;
  border: 1px solid #2A271F;
}
.qr-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(7, 1fr);
  gap: 1px;
  width: 100%;
  height: 100%;
}
.qr-grid span { background: transparent; }
.qr-grid span[data-on="1"] { background: #1A1814; }

.receipt-foot {
  text-align: center;
  font-size: 10px;
  color: #5C5648;
  line-height: 1.5;
  letter-spacing: 0.04em;
  margin-top: 8px;
}

.le-art-cap {
  font-family: var(--serif);
  font-style: italic;
  font-size: 13px;
  color: var(--ink-soft);
  text-align: center;
  max-width: 280px;
  line-height: 1.45;
  margin: 6px 0 0;
}

/* ── Stats ─────────────────────────────────────────────────────────── */
.le-stats {
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  padding: 26px 0;
  background: var(--paper-2);
}
.le-stats-label {
  text-align: center;
  display: block;
  margin-bottom: 18px;
}
.le-stats-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  align-items: center;
}
@media (max-width: 720px) {
  .le-stats-row { grid-template-columns: repeat(2, 1fr); gap: 18px; }
  .le-stat-rule { display: none; }
}
.le-stat {
  position: relative;
  text-align: center;
  padding: 8px 12px;
}
.le-stat-num {
  font-family: var(--serif);
  font-size: clamp(32px, 4vw, 48px);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1;
  font-variation-settings: "SOFT" 30, "opsz" 144;
  color: var(--ink);
}
.le-stat-label {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--ink-2);
  text-transform: uppercase;
  margin-top: 8px;
}
.le-stat-rule {
  position: absolute;
  right: 0;
  top: 12px;
  bottom: 12px;
  width: 1px;
  background: var(--rule);
  opacity: 0.3;
}

/* ── Pull-quote ────────────────────────────────────────────────────── */
.le-quote {
  padding: 96px 0;
  text-align: center;
}
.le-quote-text {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 300;
  font-size: clamp(24px, 3.4vw, 38px);
  line-height: 1.35;
  letter-spacing: -0.012em;
  color: var(--ink);
  max-width: 880px;
  margin: 0 auto 28px;
  font-variation-settings: "SOFT" 80, "opsz" 144;
}
.le-quote-text em { color: var(--accent); }
.le-quote-attr {
  text-align: center;
}

/* ── Section heads ─────────────────────────────────────────────────── */
.le-section { padding: 88px 0; }
.le-sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 48px;
  margin-bottom: 18px;
}
@media (max-width: 720px) {
  .le-sec-head { flex-direction: column; gap: 8px; }
}
.le-sec-title {
  font-family: var(--serif);
  font-size: clamp(28px, 3.6vw, 44px);
  font-weight: 400;
  letter-spacing: -0.02em;
  line-height: 1.05;
  color: var(--ink);
  margin: 0;
  max-width: 720px;
  text-align: right;
  font-variation-settings: "SOFT" 40, "opsz" 144;
}
@media (max-width: 720px) { .le-sec-title { text-align: left; } }

/* ── Industries ────────────────────────────────────────────────────── */
.le-industries {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  margin-top: 32px;
}
@media (max-width: 980px) { .le-industries { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .le-industries { grid-template-columns: 1fr; } }
.le-ind-card {
  padding: 28px 24px 36px 0;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid transparent;
  transition: background 0.2s;
}
.le-ind-card:last-child { border-right: none; padding-right: 0; }
.le-ind-card:not(:last-child) { padding-right: 24px; }
@media (max-width: 980px) {
  .le-ind-card:nth-child(2n) { border-right: none; padding-right: 0; }
  .le-ind-card { border-bottom: 1px solid var(--rule); padding-bottom: 28px; margin-bottom: 0; }
  .le-ind-card:nth-last-child(-n+2) { border-bottom: none; }
}
@media (max-width: 540px) {
  .le-ind-card { border-right: none !important; border-bottom: 1px solid var(--rule); padding: 24px 0; }
  .le-ind-card:last-child { border-bottom: none; }
}
.le-ind-num {
  display: block;
  margin-bottom: 14px;
  color: var(--accent);
  font-weight: 600;
}
.le-ind-name {
  font-family: var(--serif);
  font-size: clamp(22px, 2.4vw, 30px);
  font-weight: 500;
  letter-spacing: -0.018em;
  margin: 0 0 10px;
  color: var(--ink);
  font-variation-settings: "SOFT" 30, "opsz" 144;
}
.le-ind-body {
  font-family: var(--sans);
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--ink-2);
  margin: 0;
}

/* ── Departments / features grid ───────────────────────────────────── */
.le-dept-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  margin-top: 32px;
  border-top: 1px solid var(--rule);
}
@media (max-width: 980px) { .le-dept-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .le-dept-grid { grid-template-columns: 1fr; } }

.le-dept-card {
  padding: 32px 28px 36px;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  position: relative;
  transition: background 0.2s;
}
.le-dept-card:hover { background: var(--paper-2); }
.le-dept-span-2 { grid-column: span 2; }
@media (max-width: 980px) {
  .le-dept-span-2 { grid-column: span 1; }
}
@media (max-width: 600px) {
  .le-dept-card { border-right: none; }
  .le-dept-card:last-child { border-bottom: none; }
}
.le-dept-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.le-dept-num {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 700;
  font-style: italic;
  color: var(--accent);
  font-variation-settings: "SOFT" 0, "opsz" 144;
}
.le-dept-kicker { color: var(--ink-2); }
.le-dept-title {
  font-family: var(--serif);
  font-size: clamp(22px, 2.2vw, 28px);
  font-weight: 500;
  letter-spacing: -0.018em;
  line-height: 1.1;
  margin: 0 0 14px;
  color: var(--ink);
  font-variation-settings: "SOFT" 30, "opsz" 144;
}
.le-dept-body {
  font-family: var(--sans);
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--ink-2);
  margin: 0;
  max-width: 60ch;
}

/* ── Pricing / TOC ─────────────────────────────────────────────────── */
.le-pricing {
  background: var(--paper-2);
}
.le-toc {
  margin-top: 32px;
  display: grid;
  gap: 0;
}
.le-toc-row {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 32px;
  padding: 36px 0;
  border-top: 1px solid var(--rule);
  align-items: start;
}
.le-toc-row:last-child { border-bottom: 1px solid var(--rule); }
@media (max-width: 720px) {
  .le-toc-row { grid-template-columns: 1fr; gap: 16px; }
}
.le-toc-chapter {
  padding-top: 12px;
  color: var(--accent);
  font-weight: 600;
}
.le-toc-headline {
  display: flex;
  align-items: baseline;
  gap: 18px;
  margin-bottom: 12px;
}
.le-toc-name {
  font-family: var(--serif);
  font-size: clamp(36px, 5vw, 64px);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1;
  margin: 0;
  color: var(--ink);
  font-variation-settings: "SOFT" 30, "opsz" 144;
}
.le-toc-leader {
  flex: 1;
  height: 1px;
  border-bottom: 2px dotted var(--ink-2);
  align-self: end;
  margin-bottom: 14px;
  min-width: 30px;
}
.le-toc-price {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
}
.le-toc-price-num {
  font-family: var(--serif);
  font-size: clamp(28px, 3.6vw, 44px);
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--ink);
  line-height: 1;
  font-variation-settings: "SOFT" 20, "opsz" 144;
}
.le-toc-primary .le-toc-price-num { color: var(--accent); }
.le-toc-price-cadence {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-2);
  margin-top: 6px;
}
.le-toc-note {
  font-family: var(--serif);
  font-style: italic;
  font-size: 17px;
  line-height: 1.5;
  color: var(--ink-2);
  margin: 6px 0 18px;
}
.le-toc-list {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 28px;
}
@media (max-width: 720px) { .le-toc-list { grid-template-columns: 1fr; } }
.le-toc-list li {
  font-family: var(--sans);
  font-size: 14.5px;
  color: var(--ink);
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.le-toc-bullet {
  font-family: var(--serif);
  color: var(--accent);
  font-weight: 700;
  font-size: 18px;
  line-height: 1;
}
.le-pricing-fine {
  font-family: var(--serif);
  font-style: italic;
  text-align: center;
  font-size: 14px;
  color: var(--ink-soft);
  margin: 28px 0 0;
}

/* ── Comparison table ──────────────────────────────────────────────── */
.le-table-wrap {
  margin-top: 32px;
  overflow-x: auto;
  border-top: 1px solid var(--rule);
}
.le-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--sans);
  font-size: 14.5px;
}
.le-table th, .le-table td {
  padding: 16px 12px;
  text-align: left;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}
.le-table th {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-2);
  font-weight: 500;
  padding-bottom: 14px;
  padding-top: 18px;
}
.le-table td:first-child {
  font-family: var(--serif);
  font-size: 16px;
  color: var(--ink);
  width: 50%;
}
.le-table-us {
  color: var(--accent);
  font-weight: 600;
}
.le-table-them {
  color: var(--ink-soft);
  font-style: italic;
  font-family: var(--serif);
}
.le-table tr:nth-child(even) td {
  background: var(--paper-2);
}
.le-check {
  font-family: var(--serif);
  font-size: 22px;
  line-height: 1;
  color: var(--accent);
}

/* ── Testimonial ───────────────────────────────────────────────────── */
.le-testimonial {
  background: var(--ink);
  color: var(--paper);
  text-align: center;
  padding: 96px 0;
}
.le-testimonial .le-mono { color: var(--accent-soft); }
.le-test-quote {
  font-family: var(--serif);
  font-size: clamp(22px, 2.6vw, 32px);
  line-height: 1.4;
  font-weight: 400;
  letter-spacing: -0.012em;
  margin: 22px auto 28px;
  max-width: 920px;
  font-variation-settings: "SOFT" 40, "opsz" 144;
  font-style: italic;
}
.le-test-attr {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  font-family: var(--sans);
  font-size: 14px;
  color: var(--paper-2);
}
.le-test-name { font-weight: 600; color: var(--paper); }

/* ── Credentials strip ─────────────────────────────────────────────── */
.le-credentials {
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  padding: 56px 0;
  background: var(--paper-2);
}
.le-cred-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 40px;
}
@media (max-width: 980px) { .le-cred-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .le-cred-grid { grid-template-columns: 1fr; } }
.le-cred-cell {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.le-cred-cell strong {
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 500;
  letter-spacing: -0.012em;
  color: var(--ink);
  font-variation-settings: "SOFT" 30, "opsz" 144;
}
.le-cred-cell span:last-child {
  font-family: var(--sans);
  font-size: 13.5px;
  color: var(--ink-2);
  line-height: 1.5;
}

/* ── End CTA ───────────────────────────────────────────────────────── */
.le-end {
  text-align: center;
  padding: 104px 0;
}
.le-end-headline {
  font-family: var(--serif);
  font-size: clamp(40px, 6vw, 80px);
  font-weight: 400;
  letter-spacing: -0.025em;
  line-height: 1;
  margin: 0 0 18px;
  font-variation-settings: "SOFT" 60, "opsz" 144;
  color: var(--ink);
}
.le-end-sub {
  font-family: var(--serif);
  font-style: italic;
  font-size: 19px;
  color: var(--ink-2);
  margin: 0 0 32px;
}
.le-end-inner .le-cta-row { justify-content: center; }

/* ── Footer ────────────────────────────────────────────────────────── */
.le-foot {
  background: var(--paper);
  padding: 36px 0 56px;
}
.le-foot-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 40px;
  padding: 36px 0 24px;
}
@media (max-width: 720px) { .le-foot-grid { grid-template-columns: repeat(2, 1fr); gap: 28px; } }
@media (max-width: 480px) { .le-foot-grid { grid-template-columns: 1fr; } }
.le-foot-text {
  font-family: var(--serif);
  font-size: 14px;
  color: var(--ink-2);
  line-height: 1.55;
  margin: 12px 0 0;
}
.le-foot-text strong { color: var(--ink); font-weight: 600; }
.le-foot-list {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.le-foot-list a {
  font-family: var(--sans);
  font-size: 14px;
  color: var(--ink);
  text-decoration: none;
  transition: color 0.15s;
}
.le-foot-list a:hover { color: var(--accent); }
.le-foot-tail {
  text-align: center;
  margin: 16px 0 0;
  letter-spacing: 0.4em;
}

/* ── Reduced motion ────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .receipt-wrap { transform: none; transition: none; }
  .le-btn-arrow { transition: none; }
}
`;
