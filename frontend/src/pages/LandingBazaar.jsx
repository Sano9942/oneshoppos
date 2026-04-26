import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Retail-floor maximalist landing — preview at /preview/landing-bazaar
 *
 * Concept: SanoPOS as a Pakistani bazaar signage system. Saffron + ink + hot
 * magenta duotone, condensed display type, scrolling ticker strips, an
 * animated SKU cycler, a live-counter, and feature claims printed as
 * price-tag stickers. Positioning honest to PRs 1–9.
 */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700;800;900&family=Big+Shoulders+Stencil+Display:wght@800;900&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700&display=swap";

const SKUS = [
  { sku: "SKU-7841", name: "SAPPHIRE KURTA · L · WHITE", price: "3,200" },
  { sku: "SKU-2204", name: "KHAADI LAWN · 3 PIECE · M", price: "4,950" },
  { sku: "SKU-9911", name: "SANA SAFINAZ DUPATTA · IVORY", price: "2,200" },
  { sku: "SKU-1077", name: "GUL AHMED · LAWN · 2 PC · S", price: "3,890" },
  { sku: "SKU-3358", name: "BAREEZE PRINTED SHIRT · M", price: "2,750" },
  { sku: "SKU-5510", name: "ALKARAM · UNSTITCHED · 3 PC", price: "5,400" },
  { sku: "SKU-8821", name: "SAPPHIRE KIDS · 4–6 YR · BLUE", price: "1,890" },
];

const STICKERS = [
  { tilt: -4, label: "FREE", sub: "FOREVER", note: "no trial · no lock", tone: "ink" },
  { tilt: 3, label: "FBR", sub: "INCLUDED", note: "real-time IRN", tone: "magenta" },
  { tilt: -2, label: "0", sub: "FEATURE LOCKS", note: "everything, on every plan", tone: "saffron" },
  { tilt: 5, label: "67+", sub: "REPORTS", note: "POS · books · stock · payroll", tone: "ink" },
  { tilt: -3, label: "OFFLINE", sub: "SAFE", note: "queue locally · auto-sync", tone: "magenta" },
  { tilt: 2, label: "13", sub: "COURIERS", note: "leopards · tcs · postex · …", tone: "saffron" },
];

const MARQUEE_TOP = [
  "● LIVE",
  "184 SALES POSTED TODAY",
  "47 ACTIVE OUTLETS",
  "FBR · 200 OK",
  "OFFLINE QUEUE · 0 PENDING",
  "12 NEW SHOPS THIS WEEK",
  "0 FEATURE LOCKS",
];

const MARQUEE_BOTTOM = [
  "STOCK TRANSFERS",
  "LOYALTY · 11 RFM SEGMENTS",
  "67 REPORTS",
  "WALLET CREDIT",
  "BARCODE GRN",
  "PICK · PACK · DISPATCH",
  "SHOPIFY · WOO · DARAZ",
  "ESC/POS THERMAL",
  "AI INSIGHTS PANEL",
  "FBR DIGITAL INVOICING",
  "MULTI-OUTLET",
  "PRICE LISTS · PROMOTIONS",
];

const COMPARE = [
  ["FBR DIGITAL INVOICING", "INCLUDED", "ADD-ON / ABSENT"],
  ["OFFLINE SALE QUEUE", "INCLUDED", "ABSENT"],
  ["REPORT TABS", "67+", "15–25"],
  ["BUILT-IN ACCOUNTING", "INCLUDED", "REQUIRES QB / XERO"],
  ["WALLET + TIERED LOYALTY", "INCLUDED", "PAID ADD-ON"],
  ["MULTI-OUTLET TRANSFERS", "INCLUDED", "ENTERPRISE TIER"],
  ["FREE PLAN, ALL FEATURES", "INCLUDED", "TRIAL ONLY"],
];

const COMING_SOON = ["SALON & SPA", "CLINIC & PHARMACY", "RESTAURANT & CAFÉ", "RENTALS", "EDUCATION", "VETERINARY"];

/* ─── Animated SKU cycler ─────────────────────────────────────────── */

function SKUCycler() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % SKUS.length), 1900);
    return () => clearInterval(t);
  }, []);
  const sku = SKUS[i];
  return (
    <div className="bz-sku">
      <div className="bz-sku-head">
        <span className="bz-sku-led" aria-hidden="true" />
        SCAN · LIVE
      </div>
      <div className="bz-sku-body" key={i}>
        <div className="bz-sku-id">{sku.sku}</div>
        <div className="bz-sku-name">{sku.name}</div>
        <div className="bz-sku-price">
          <span className="bz-sku-cur">₨</span>
          <span className="bz-sku-num">{sku.price}</span>
        </div>
      </div>
      <div className="bz-sku-foot">
        <span>★ INSTOCK · 12</span>
        <span>POS-01 · CTR-A</span>
      </div>
    </div>
  );
}

/* ─── Animated count-up ────────────────────────────────────────────── */

function CountUp({ to, duration = 1800, prefix = "", suffix = "" }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.floor(to * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {val.toLocaleString()}
      {suffix}
    </span>
  );
}

/* ─── Live ticking counter (slowly increments forever) ─────────────── */

function LiveTicker({ start = 1847239 }) {
  const [val, setVal] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setVal((v) => v + Math.floor(Math.random() * 4) + 1), 1200);
    return () => clearInterval(t);
  }, []);
  return <>{val.toLocaleString()}</>;
}

/* ─── Marquee ──────────────────────────────────────────────────────── */

function Marquee({ items, tone = "ink", reverse = false }) {
  const track = items.concat(items);
  return (
    <div className={`bz-marquee bz-marquee-${tone}`}>
      <div className={`bz-marquee-track ${reverse ? "bz-marquee-rev" : ""}`}>
        {track.map((it, i) => (
          <span key={i} className="bz-marquee-item">
            {it} <span className="bz-marquee-sep" aria-hidden="true">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────── */

export default function LandingBazaar() {
  const [year] = useState(() => new Date().getFullYear());
  const fontInjected = useRef(false);

  useEffect(() => {
    if (fontInjected.current) return;
    fontInjected.current = true;
    if (!document.querySelector('link[data-bz-font="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      link.setAttribute("data-bz-font", "1");
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="bz-root">
      <style>{BZ_STYLES}</style>

      <Marquee items={MARQUEE_TOP} tone="ink" />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="bz-header">
        <div className="bz-container bz-header-row">
          <Link to="/" className="bz-brand">
            <span className="bz-brand-mark">S</span>
            <div>
              <div className="bz-brand-name">SANOPOS</div>
              <div className="bz-brand-meta">RETAIL · LAHORE · MMXXVI</div>
            </div>
          </Link>
          <nav className="bz-nav">
            <a href="#stickers">FEATURES</a>
            <a href="#prices">PRICES</a>
            <a href="#compare">VS. THE FIELD</a>
            <Link to="/login" className="bz-nav-cta">SIGN IN ↗</Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="bz-hero">
        <div className="bz-container bz-hero-grid">
          <div className="bz-hero-copy">
            <div className="bz-eyebrow">
              <span className="bz-eyebrow-pulse" aria-hidden="true" />
              SPRING DROP · APR 2026
            </div>
            <h1 className="bz-hero-title">
              <span className="bz-line">RING IT UP.</span>
              <span className="bz-line bz-line-stencil">PACK IT UP.</span>
              <span className="bz-line bz-line-mag">SHIP IT.</span>
            </h1>

            <p className="bz-lede">
              The free-forever POS for Pakistani retail. Counter, books,
              FBR, and 67 reports — in one window, on every plan.
              <strong> No card. No trial. No locks.</strong>
            </p>

            <div className="bz-cta-row">
              <Link to="/signup" className="bz-cta-primary">
                <span>OPEN A FREE SHOP</span>
                <span className="bz-cta-arrow" aria-hidden="true">→</span>
              </Link>
              <Link to="/login" className="bz-cta-ghost">
                I HAVE A SHOP · SIGN IN
              </Link>
            </div>

            <div className="bz-hero-fine">
              FREE = 1 OUTLET · 3 STAFF · 100 PRODUCTS &nbsp;·&nbsp; PRO ₨ 8,000 / OUTLET / MONTH
            </div>
          </div>

          <aside className="bz-hero-art">
            <div className="bz-art-stack">
              <div className="bz-stamp bz-stamp-sale" aria-hidden="true">
                <div>SALE</div>
                <div className="bz-stamp-sub">LIVE · POS-01</div>
              </div>
              <SKUCycler />
              <div className="bz-stamp bz-stamp-fbr" aria-hidden="true">
                <div>FBR</div>
                <div className="bz-stamp-sub">POSTED ✓</div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* ── Live counter strip ─────────────────────────────────────── */}
      <section className="bz-counter">
        <div className="bz-container bz-counter-row">
          <div className="bz-counter-cell">
            <div className="bz-counter-label">SALES POSTED · ALL-TIME</div>
            <div className="bz-counter-num"><LiveTicker start={1847239} /></div>
          </div>
          <div className="bz-counter-cell bz-counter-mid">
            <div className="bz-counter-label">REPORTS · INCLUDED</div>
            <div className="bz-counter-num"><CountUp to={67} suffix="+" duration={1800} /></div>
          </div>
          <div className="bz-counter-cell">
            <div className="bz-counter-label">FEATURES · LOCKED</div>
            <div className="bz-counter-num bz-counter-zero">00</div>
          </div>
        </div>
      </section>

      {/* ── Feature stickers ───────────────────────────────────────── */}
      <section className="bz-stickers" id="stickers">
        <div className="bz-container">
          <header className="bz-section-head">
            <div className="bz-section-tag">// THE STICKERS //</div>
            <h2 className="bz-section-title">EVERYTHING ON THE WALL.</h2>
            <p className="bz-section-sub">No paid add-ons. No enterprise tier. No "request a demo".</p>
          </header>

          <div className="bz-sticker-grid">
            {STICKERS.map((s, i) => (
              <div
                key={i}
                className={`bz-sticker bz-sticker-${s.tone}`}
                style={{ "--tilt": `${s.tilt}deg` }}
              >
                <div className="bz-sticker-label">{s.label}</div>
                <div className="bz-sticker-sub">{s.sub}</div>
                <div className="bz-sticker-note">{s.note}</div>
                <div className="bz-sticker-hole" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <Marquee items={MARQUEE_BOTTOM} tone="magenta" />

      {/* ── Pricing as price tags ──────────────────────────────────── */}
      <section className="bz-prices" id="prices">
        <div className="bz-container">
          <header className="bz-section-head">
            <div className="bz-section-tag">// PRICE TAGS //</div>
            <h2 className="bz-section-title">TWO PLANS.<br />ALL FEATURES ON BOTH.</h2>
            <p className="bz-section-sub">Free is permanent. Pro is paid per outlet, monthly.</p>
          </header>

          <div className="bz-tags">
            {/* FREE */}
            <article className="bz-tag bz-tag-free">
              <div className="bz-tag-string" aria-hidden="true" />
              <div className="bz-tag-stamp">★ EVERYDAY</div>
              <div className="bz-tag-name">FREE</div>
              <div className="bz-tag-tagline">For shops finding their feet.</div>
              <div className="bz-tag-price">
                <span className="bz-tag-cur">₨</span>
                <span className="bz-tag-num">0</span>
              </div>
              <div className="bz-tag-cad">FOREVER · NOT A TRIAL</div>
              <ul className="bz-tag-list">
                <li>1 OUTLET</li>
                <li>UP TO 3 STAFF</li>
                <li>UP TO 100 PRODUCTS</li>
                <li>EVERY RETAIL FEATURE</li>
                <li>FBR DIGITAL INVOICING</li>
                <li>OFFLINE SALE QUEUE</li>
                <li>COMMUNITY SUPPORT</li>
              </ul>
              <Link to="/signup" className="bz-tag-cta bz-tag-cta-free">
                OPEN FREE SHOP →
              </Link>
            </article>

            {/* PRO */}
            <article className="bz-tag bz-tag-pro">
              <div className="bz-tag-string" aria-hidden="true" />
              <div className="bz-tag-stamp bz-tag-stamp-hot">▼ FOR SCALE</div>
              <div className="bz-tag-name">PRO</div>
              <div className="bz-tag-tagline">When the shop has outgrown Free.</div>
              <div className="bz-tag-price">
                <span className="bz-tag-cur">₨</span>
                <span className="bz-tag-num">8,000</span>
              </div>
              <div className="bz-tag-cad">PER MONTH · PER OUTLET</div>
              <ul className="bz-tag-list">
                <li>UNLIMITED STAFF</li>
                <li>UNLIMITED PRODUCTS</li>
                <li>MULTI-OUTLET + STOCK TRANSFERS</li>
                <li>CONTEXT-AWARE PRICING</li>
                <li>AI INSIGHTS PANEL</li>
                <li>EMAIL + WHATSAPP SUPPORT</li>
                <li>CANCEL FROM DASHBOARD</li>
              </ul>
              <Link to="/signup" className="bz-tag-cta bz-tag-cta-pro">
                START ON FREE → UPGRADE LATER
              </Link>
              <div className="bz-tag-foot">
                Begin on Free. Upgrade from /billing when ready. Add outlets one at a time.
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ── Compare strip (receipt-style) ──────────────────────────── */}
      <section className="bz-compare" id="compare">
        <div className="bz-container">
          <header className="bz-section-head">
            <div className="bz-section-tag">// THE FIELD //</div>
            <h2 className="bz-section-title">SANOPOS &nbsp;∷&nbsp; THE FIELD</h2>
          </header>
          <div className="bz-compare-table">
            <div className="bz-compare-row bz-compare-head">
              <div>FEATURE</div>
              <div className="bz-compare-us">SANOPOS</div>
              <div>THE FIELD</div>
            </div>
            {COMPARE.map(([f, us, them], i) => (
              <div className="bz-compare-row" key={i}>
                <div>{f}</div>
                <div className="bz-compare-us">
                  <span className="bz-compare-yes">{us}</span>
                </div>
                <div>
                  <span className="bz-compare-no">{them}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Couriers / regional fit ────────────────────────────────── */}
      <section className="bz-couriers">
        <div className="bz-container">
          <header className="bz-section-head bz-section-head-light">
            <div className="bz-section-tag">// SHIPPING NATIONWIDE //</div>
            <h2 className="bz-section-title">13 COURIERS WIRED IN.</h2>
            <p className="bz-section-sub bz-section-sub-light">From the dashboard. Live tracking, label printing, COD reconciliation.</p>
          </header>
          <div className="bz-courier-grid">
            {["LEOPARDS", "TCS", "BLUEEX", "POSTEX", "TRAX", "RIDER", "SWYFT", "BYKEA", "MNP", "PAKPOST", "DHL", "FEDEX", "CALLCOURIER"].map((c) => (
              <div className="bz-courier" key={c}>{c}</div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonial ────────────────────────────────────────────── */}
      <section className="bz-quote">
        <div className="bz-container">
          <div className="bz-quote-card">
            <div className="bz-quote-tag">FIELD REPORT · LAHORE</div>
            <blockquote className="bz-quote-text">
              "WE SWITCHED FROM A KARACHI VENDOR THAT CHARGED PER FEATURE.
              SANOPOS GAVE US FBR + MULTI-OUTLET + ACCOUNTING ON DAY ONE.
              CLOSING THE BOOKS USED TO TAKE A SATURDAY. NOW IT'S AN HOUR."
            </blockquote>
            <div className="bz-quote-attr">
              <strong>BILAL A.</strong> &nbsp;·&nbsp; THREE-OUTLET APPAREL CHAIN &nbsp;·&nbsp; LAHORE
            </div>
          </div>
        </div>
      </section>

      {/* ── Coming soon ────────────────────────────────────────────── */}
      <section className="bz-soon">
        <div className="bz-container">
          <header className="bz-section-head">
            <div className="bz-section-tag">// SHIPPING SOON //</div>
            <h2 className="bz-section-title">RETAIL TODAY.<br />THE REST, THIS YEAR.</h2>
            <p className="bz-section-sub">Public launch is for retail. The rest of the presets are already built — opening in waves.</p>
          </header>
          <div className="bz-soon-grid">
            {COMING_SOON.map((it) => (
              <div key={it} className="bz-soon-card">
                <div className="bz-soon-name">{it}</div>
                <div className="bz-soon-tag">IN PREVIEW</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── End CTA ────────────────────────────────────────────────── */}
      <section className="bz-end">
        <div className="bz-container bz-end-inner">
          <h2 className="bz-end-title">
            OPEN A SHOP.<br />
            <span className="bz-end-mag">RING IT UP.</span>
          </h2>
          <p className="bz-end-sub">Five minutes. Email to verify. Selling tonight.</p>
          <div className="bz-cta-row">
            <Link to="/signup" className="bz-cta-primary bz-cta-large">
              <span>OPEN A FREE SHOP</span>
              <span className="bz-cta-arrow" aria-hidden="true">→</span>
            </Link>
            <Link to="/login" className="bz-cta-ghost bz-cta-large">SIGN IN</Link>
          </div>
        </div>
      </section>

      <Marquee items={MARQUEE_BOTTOM} tone="ink" reverse />

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="bz-foot">
        <div className="bz-container">
          <div className="bz-foot-grid">
            <div>
              <div className="bz-foot-h">// SHOP</div>
              <ul>
                <li><Link to="/signup">OPEN ACCOUNT</Link></li>
                <li><Link to="/login">SIGN IN</Link></li>
                <li><a href="#prices">PRICES</a></li>
                <li><a href="#compare">VS. FIELD</a></li>
              </ul>
            </div>
            <div>
              <div className="bz-foot-h">// COMPANY</div>
              <ul>
                <li><Link to="/terms">TERMS</Link></li>
                <li><Link to="/privacy">PRIVACY</Link></li>
                <li>HELLO@SANOPOS.COM</li>
              </ul>
            </div>
            <div>
              <div className="bz-foot-h">// COLOPHON</div>
              <p>SET IN BIG SHOULDERS, BIG SHOULDERS STENCIL, OUTFIT, DM MONO. PRINTED IN LAHORE.</p>
            </div>
            <div>
              <div className="bz-foot-h">// EDITION</div>
              <p>SPRING DROP · APR 2026 · LAHORE<br />© {year} SANO MERCHANDISE</p>
            </div>
          </div>
          <div className="bz-foot-tail">
            ✦ ✦ ✦ &nbsp; END OF DAY · SHOP CLOSED · SEE YOU TOMORROW &nbsp; ✦ ✦ ✦
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Stylesheet ─────────────────────────────────────────────────────────── */

const BZ_STYLES = `
.bz-root {
  --saffron: #FFCB30;
  --saffron-2: #FFB800;
  --ink: #0E0F12;
  --ink-2: #2A2C32;
  --magenta: #FF2D7A;
  --magenta-2: #E61E68;
  --cyan: #19D7FF;
  --cream: #FFFAF0;
  --paper: #FFF6E2;

  --display: "Big Shoulders Display", "Bebas Neue", Impact, sans-serif;
  --stencil: "Big Shoulders Stencil Display", "Big Shoulders Display", Impact, sans-serif;
  --sans: "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "DM Mono", "JetBrains Mono", Menlo, monospace;

  background: var(--saffron);
  color: var(--ink);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
  min-height: 100vh;
  overflow-x: hidden;
  font-weight: 500;
}

.bz-container {
  max-width: 1320px;
  margin: 0 auto;
  padding: 0 28px;
}
@media (max-width: 720px) { .bz-container { padding: 0 18px; } }

/* ── Marquee ─────────────────────────────────────────────────────────── */
.bz-marquee {
  overflow: hidden;
  white-space: nowrap;
  padding: 14px 0;
  border-top: 3px solid var(--ink);
  border-bottom: 3px solid var(--ink);
}
.bz-marquee-ink { background: var(--ink); color: var(--saffron); }
.bz-marquee-magenta { background: var(--magenta); color: var(--cream); }
.bz-marquee-track {
  display: inline-flex;
  animation: bz-marq 38s linear infinite;
  font-family: var(--display);
  font-weight: 700;
  font-size: 19px;
  letter-spacing: 0.04em;
}
.bz-marquee-rev { animation-direction: reverse; animation-duration: 44s; }
.bz-marquee-item {
  display: inline-flex;
  align-items: center;
  gap: 28px;
  padding-right: 28px;
}
.bz-marquee-sep { color: currentColor; opacity: 0.6; }
@keyframes bz-marq {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}

/* ── Header ─────────────────────────────────────────────────────────── */
.bz-header {
  background: var(--saffron);
  border-bottom: 3px solid var(--ink);
  padding: 18px 0;
}
.bz-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.bz-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
  color: var(--ink);
}
.bz-brand-mark {
  font-family: var(--display);
  font-weight: 900;
  font-size: 38px;
  background: var(--ink);
  color: var(--saffron);
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  letter-spacing: -0.04em;
}
.bz-brand-name {
  font-family: var(--display);
  font-weight: 900;
  font-size: 28px;
  letter-spacing: -0.015em;
  line-height: 0.9;
}
.bz-brand-meta {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ink-2);
  margin-top: 4px;
}
.bz-nav { display: flex; align-items: center; gap: 26px; }
.bz-nav a {
  font-family: var(--display);
  font-weight: 700;
  font-size: 16px;
  color: var(--ink);
  text-decoration: none;
  letter-spacing: 0.04em;
  transition: color 0.15s;
}
.bz-nav a:hover { color: var(--magenta); }
.bz-nav-cta {
  background: var(--ink) !important;
  color: var(--saffron) !important;
  padding: 12px 18px;
  border: 3px solid var(--ink);
  font-weight: 800;
  letter-spacing: 0.06em !important;
  transition: all 0.15s;
}
.bz-nav-cta:hover {
  background: var(--magenta) !important;
  color: var(--cream) !important;
  border-color: var(--magenta);
}
@media (max-width: 720px) {
  .bz-nav { gap: 12px; }
  .bz-nav a:not(.bz-nav-cta) { display: none; }
  .bz-brand-meta { display: none; }
}

/* ── Hero ───────────────────────────────────────────────────────────── */
.bz-hero {
  padding: 64px 0 80px;
  background: var(--saffron);
  border-bottom: 3px solid var(--ink);
  position: relative;
  overflow: hidden;
}
.bz-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle at 1px 1px, rgba(14,15,18,0.10) 1px, transparent 0);
  background-size: 24px 24px;
  pointer-events: none;
}
.bz-hero-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 56px;
  align-items: center;
  position: relative;
}
@media (max-width: 980px) {
  .bz-hero-grid { grid-template-columns: 1fr; gap: 48px; }
}

.bz-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-family: var(--mono);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.16em;
  background: var(--ink);
  color: var(--saffron);
  padding: 8px 16px;
  margin-bottom: 28px;
}
.bz-eyebrow-pulse {
  display: inline-block;
  width: 10px;
  height: 10px;
  background: var(--magenta);
  border-radius: 50%;
  animation: bz-pulse 1.5s ease-in-out infinite;
}
@keyframes bz-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.3); }
}

.bz-hero-title {
  font-family: var(--display);
  font-weight: 900;
  font-size: clamp(58px, 11vw, 168px);
  line-height: 0.84;
  letter-spacing: -0.04em;
  margin: 0 0 32px;
  display: flex;
  flex-direction: column;
}
.bz-line {
  display: inline-block;
  text-transform: uppercase;
}
.bz-line-stencil {
  font-family: var(--stencil);
  font-weight: 900;
  letter-spacing: -0.03em;
}
.bz-line-mag {
  background: var(--magenta);
  color: var(--cream);
  padding: 0 0.1em;
  align-self: flex-start;
  transform: rotate(-1.2deg) translateY(-4px);
}

.bz-lede {
  font-family: var(--sans);
  font-weight: 400;
  font-size: clamp(18px, 1.6vw, 22px);
  line-height: 1.5;
  color: var(--ink);
  max-width: 560px;
  margin: 0 0 32px;
}
.bz-lede strong { background: var(--ink); color: var(--saffron); padding: 0 6px; font-weight: 700; }

.bz-cta-row {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
}
.bz-cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-family: var(--display);
  font-weight: 800;
  font-size: 17px;
  letter-spacing: 0.06em;
  color: var(--saffron);
  background: var(--ink);
  padding: 18px 26px;
  text-decoration: none;
  border: 3px solid var(--ink);
  position: relative;
  transition: all 0.15s;
  text-transform: uppercase;
}
.bz-cta-large { padding: 22px 32px; font-size: 19px; }
.bz-cta-primary::after {
  content: "";
  position: absolute;
  inset: 5px -5px -5px 5px;
  background: var(--magenta);
  z-index: -1;
  transition: inset 0.15s;
}
.bz-cta-primary:hover {
  background: var(--magenta);
  border-color: var(--magenta);
  color: var(--cream);
}
.bz-cta-primary:hover::after { inset: 0 0 0 0; background: var(--ink); }
.bz-cta-arrow { transition: transform 0.15s; display: inline-block; }
.bz-cta-primary:hover .bz-cta-arrow { transform: translateX(4px); }

.bz-cta-ghost {
  display: inline-flex;
  align-items: center;
  font-family: var(--display);
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.06em;
  color: var(--ink);
  background: transparent;
  padding: 18px 22px;
  text-decoration: none;
  border: 3px solid var(--ink);
  transition: all 0.15s;
  text-transform: uppercase;
}
.bz-cta-ghost:hover { background: var(--ink); color: var(--saffron); }

.bz-hero-fine {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--ink);
  margin-top: 24px;
  font-weight: 500;
  background: var(--cream);
  display: inline-block;
  padding: 8px 12px;
  border: 2px solid var(--ink);
}

/* ── Hero art (SKU + stamps) ────────────────────────────────────────── */
.bz-hero-art {
  display: flex;
  justify-content: center;
  align-items: center;
}
.bz-art-stack {
  position: relative;
  width: 100%;
  max-width: 380px;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bz-stamp {
  position: absolute;
  font-family: var(--display);
  font-weight: 900;
  text-align: center;
  padding: 14px 18px;
  border: 3px solid var(--ink);
  letter-spacing: -0.02em;
  line-height: 0.9;
  z-index: 1;
}
.bz-stamp > div:first-child { font-size: 38px; }
.bz-stamp-sub {
  font-family: var(--mono);
  font-weight: 500;
  font-size: 9.5px;
  letter-spacing: 0.16em;
  margin-top: 6px;
  font-style: normal;
}
.bz-stamp-sale {
  background: var(--magenta);
  color: var(--cream);
  top: 6%;
  left: -8%;
  transform: rotate(-12deg);
  animation: bz-jiggle 6s ease-in-out infinite;
}
.bz-stamp-fbr {
  background: var(--ink);
  color: var(--saffron);
  bottom: 8%;
  right: -8%;
  transform: rotate(8deg);
  animation: bz-jiggle 7s ease-in-out infinite reverse;
}
@keyframes bz-jiggle {
  0%, 100% { transform: rotate(var(--r, -12deg)) translateY(0); }
  50% { transform: rotate(calc(var(--r, -12deg) + 1deg)) translateY(-4px); }
}
.bz-stamp-sale { --r: -12deg; }
.bz-stamp-fbr { --r: 8deg; }

/* ── SKU cycler ─────────────────────────────────────────────────────── */
.bz-sku {
  background: var(--cream);
  border: 3px solid var(--ink);
  padding: 18px 20px;
  width: 100%;
  max-width: 320px;
  position: relative;
  z-index: 2;
  box-shadow: 8px 8px 0 var(--ink);
}
.bz-sku-head {
  font-family: var(--mono);
  font-weight: 600;
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--magenta);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.bz-sku-led {
  display: inline-block;
  width: 9px;
  height: 9px;
  background: var(--magenta);
  border-radius: 50%;
  animation: bz-blink 1s steps(2) infinite;
}
@keyframes bz-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.2; } }

.bz-sku-body {
  animation: bz-fadein 0.4s ease;
}
@keyframes bz-fadein {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.bz-sku-id {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--ink-2);
  font-weight: 500;
}
.bz-sku-name {
  font-family: var(--display);
  font-weight: 800;
  font-size: 19px;
  letter-spacing: -0.005em;
  line-height: 1.05;
  margin: 8px 0 12px;
  min-height: 44px;
}
.bz-sku-price { display: flex; align-items: baseline; gap: 6px; }
.bz-sku-cur {
  font-family: var(--display);
  font-weight: 700;
  font-size: 22px;
  color: var(--ink-2);
}
.bz-sku-num {
  font-family: var(--display);
  font-weight: 900;
  font-size: 44px;
  letter-spacing: -0.03em;
  color: var(--magenta);
  line-height: 1;
}
.bz-sku-foot {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--ink-2);
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--ink-2);
}

/* ── Live counter ───────────────────────────────────────────────────── */
.bz-counter {
  background: var(--ink);
  color: var(--cream);
  padding: 38px 0;
  border-bottom: 3px solid var(--ink);
}
.bz-counter-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr;
  align-items: center;
  gap: 36px;
}
@media (max-width: 720px) { .bz-counter-row { grid-template-columns: 1fr; gap: 22px; } }
.bz-counter-cell { text-align: left; }
.bz-counter-mid { text-align: center; border-left: 1px solid var(--ink-2); border-right: 1px solid var(--ink-2); padding: 0 24px; }
@media (max-width: 720px) { .bz-counter-mid { border: none; padding: 0; } }
.bz-counter-label {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--saffron);
  margin-bottom: 8px;
  font-weight: 500;
}
.bz-counter-num {
  font-family: var(--display);
  font-weight: 900;
  font-size: clamp(40px, 6vw, 76px);
  letter-spacing: -0.04em;
  line-height: 0.95;
  color: var(--cream);
}
.bz-counter-zero { color: var(--magenta); }

/* ── Section heads ──────────────────────────────────────────────────── */
.bz-section-head { margin-bottom: 48px; }
.bz-section-head-light { color: var(--cream); }
.bz-section-tag {
  font-family: var(--mono);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.18em;
  color: var(--magenta);
  margin-bottom: 12px;
}
.bz-section-head-light .bz-section-tag { color: var(--saffron); }
.bz-section-title {
  font-family: var(--display);
  font-weight: 900;
  font-size: clamp(40px, 6.4vw, 96px);
  letter-spacing: -0.035em;
  line-height: 0.92;
  margin: 0 0 16px;
  text-transform: uppercase;
  color: inherit;
}
.bz-section-sub {
  font-family: var(--sans);
  font-size: 18px;
  color: var(--ink-2);
  max-width: 600px;
  margin: 0;
  line-height: 1.5;
}
.bz-section-sub-light { color: var(--cream); opacity: 0.85; }

/* ── Stickers ───────────────────────────────────────────────────────── */
.bz-stickers { padding: 96px 0 72px; background: var(--cream); border-bottom: 3px solid var(--ink); }
.bz-sticker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
}
@media (max-width: 880px) { .bz-sticker-grid { grid-template-columns: repeat(2, 1fr); gap: 20px; } }
@media (max-width: 540px) { .bz-sticker-grid { grid-template-columns: 1fr; } }
.bz-sticker {
  position: relative;
  padding: 32px 24px 26px;
  text-align: center;
  border: 3px solid var(--ink);
  transform: rotate(var(--tilt, 0deg));
  transition: transform 0.25s ease, box-shadow 0.25s;
  box-shadow: 6px 6px 0 var(--ink);
  background: var(--cream);
}
.bz-sticker:hover {
  transform: rotate(0deg) translateY(-4px);
  box-shadow: 10px 10px 0 var(--ink);
}
.bz-sticker-saffron { background: var(--saffron); }
.bz-sticker-magenta { background: var(--magenta); color: var(--cream); }
.bz-sticker-magenta { color: var(--cream); }
.bz-sticker-ink { background: var(--ink); color: var(--saffron); }
.bz-sticker-label {
  font-family: var(--display);
  font-weight: 900;
  font-size: clamp(48px, 6.5vw, 88px);
  line-height: 0.9;
  letter-spacing: -0.04em;
  margin-bottom: 4px;
}
.bz-sticker-sub {
  font-family: var(--display);
  font-weight: 800;
  font-size: 18px;
  letter-spacing: 0.06em;
  margin-bottom: 14px;
}
.bz-sticker-note {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: currentColor;
  opacity: 0.8;
  font-weight: 500;
}
.bz-sticker-hole {
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 16px;
  background: var(--saffron);
  border: 3px solid var(--ink);
  border-radius: 50%;
}
.bz-sticker-saffron .bz-sticker-hole { background: var(--cream); }

/* ── Prices / price tags ────────────────────────────────────────────── */
.bz-prices { padding: 96px 0; background: var(--saffron); border-bottom: 3px solid var(--ink); }
.bz-tags {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  margin-top: 32px;
  padding-top: 24px;
}
@media (max-width: 880px) { .bz-tags { grid-template-columns: 1fr; gap: 56px; } }

.bz-tag {
  background: var(--cream);
  border: 4px solid var(--ink);
  padding: 36px 32px 28px;
  position: relative;
  box-shadow: 10px 10px 0 var(--ink);
  transition: transform 0.2s, box-shadow 0.2s;
}
.bz-tag:hover {
  transform: translateY(-4px);
  box-shadow: 14px 14px 0 var(--ink);
}
.bz-tag-pro { background: var(--ink); color: var(--cream); }
.bz-tag-string {
  position: absolute;
  top: -28px;
  left: 50%;
  width: 2px;
  height: 28px;
  background: var(--ink);
  transform: translateX(-50%);
}
.bz-tag-string::before {
  content: "";
  position: absolute;
  top: -10px;
  left: 50%;
  width: 14px;
  height: 14px;
  border: 2px solid var(--ink);
  border-radius: 50%;
  transform: translateX(-50%);
  background: var(--saffron);
}
.bz-tag-stamp {
  display: inline-block;
  font-family: var(--display);
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.12em;
  background: var(--ink);
  color: var(--saffron);
  padding: 6px 12px;
  margin-bottom: 14px;
}
.bz-tag-stamp-hot { background: var(--magenta); color: var(--cream); }
.bz-tag-pro .bz-tag-stamp { background: var(--saffron); color: var(--ink); }
.bz-tag-pro .bz-tag-stamp-hot { background: var(--magenta); color: var(--cream); }

.bz-tag-name {
  font-family: var(--display);
  font-weight: 900;
  font-size: clamp(64px, 8vw, 110px);
  letter-spacing: -0.04em;
  line-height: 0.9;
  margin: 0;
}
.bz-tag-pro .bz-tag-name { color: var(--saffron); }
.bz-tag-tagline {
  font-family: var(--sans);
  font-size: 16px;
  color: inherit;
  opacity: 0.75;
  margin: 6px 0 22px;
}
.bz-tag-price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  border-top: 3px dashed currentColor;
  padding-top: 20px;
}
.bz-tag-cur {
  font-family: var(--display);
  font-weight: 700;
  font-size: 30px;
  opacity: 0.7;
}
.bz-tag-num {
  font-family: var(--display);
  font-weight: 900;
  font-size: clamp(72px, 10vw, 132px);
  letter-spacing: -0.05em;
  line-height: 0.85;
}
.bz-tag-pro .bz-tag-num { color: var(--magenta); }
.bz-tag-cad {
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.16em;
  font-weight: 600;
  margin: 8px 0 22px;
  opacity: 0.85;
}

.bz-tag-list {
  list-style: none;
  padding: 0;
  margin: 0 0 24px;
  display: grid;
  gap: 8px;
  border-top: 3px dashed currentColor;
  padding-top: 18px;
}
.bz-tag-list li {
  font-family: var(--display);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.04em;
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.bz-tag-list li::before {
  content: "✓";
  color: var(--magenta);
  font-weight: 800;
}
.bz-tag-pro .bz-tag-list li::before { color: var(--saffron); }

.bz-tag-cta {
  display: block;
  text-align: center;
  font-family: var(--display);
  font-weight: 800;
  font-size: 16px;
  letter-spacing: 0.08em;
  text-decoration: none;
  padding: 18px 16px;
  border: 3px solid var(--ink);
  transition: all 0.15s;
}
.bz-tag-cta-free {
  background: var(--ink);
  color: var(--saffron);
}
.bz-tag-cta-free:hover { background: var(--magenta); border-color: var(--magenta); color: var(--cream); }
.bz-tag-cta-pro {
  background: var(--magenta);
  color: var(--cream);
  border-color: var(--magenta);
}
.bz-tag-cta-pro:hover { background: var(--saffron); border-color: var(--saffron); color: var(--ink); }
.bz-tag-foot {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  margin: 14px 0 0;
  opacity: 0.7;
  line-height: 1.55;
  text-align: center;
}

/* ── Compare ────────────────────────────────────────────────────────── */
.bz-compare { padding: 96px 0; background: var(--cream); border-bottom: 3px solid var(--ink); }
.bz-compare-table {
  margin-top: 32px;
  border: 3px solid var(--ink);
  background: var(--cream);
}
.bz-compare-row {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr;
  border-bottom: 2px solid var(--ink);
}
.bz-compare-row:last-child { border-bottom: none; }
.bz-compare-row > div {
  padding: 16px 18px;
  font-family: var(--display);
  font-weight: 600;
  font-size: 14.5px;
  letter-spacing: 0.04em;
  border-right: 2px solid var(--ink);
}
.bz-compare-row > div:last-child { border-right: none; }
.bz-compare-head {
  background: var(--ink);
  color: var(--saffron);
}
.bz-compare-head .bz-compare-us { color: var(--magenta); }
.bz-compare-head > div {
  font-family: var(--display);
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.14em;
}
.bz-compare-yes {
  background: var(--saffron);
  color: var(--ink);
  padding: 4px 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
}
.bz-compare-no {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ink-2);
  opacity: 0.7;
  font-weight: 500;
}
@media (max-width: 720px) {
  .bz-compare-row { grid-template-columns: 1fr; }
  .bz-compare-row > div { border-right: none; border-bottom: 1px dashed var(--ink-2); }
  .bz-compare-row > div:last-child { border-bottom: none; }
}

/* ── Couriers ───────────────────────────────────────────────────────── */
.bz-couriers { padding: 96px 0; background: var(--ink); color: var(--cream); border-bottom: 3px solid var(--ink); }
.bz-courier-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 14px;
  margin-top: 32px;
}
@media (max-width: 880px) { .bz-courier-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 540px) { .bz-courier-grid { grid-template-columns: repeat(2, 1fr); } }
.bz-courier {
  font-family: var(--display);
  font-weight: 800;
  font-size: 18px;
  letter-spacing: 0.06em;
  text-align: center;
  padding: 18px 10px;
  background: var(--saffron);
  color: var(--ink);
  border: 2px solid var(--saffron);
  transition: all 0.15s;
}
.bz-courier:hover {
  background: var(--magenta);
  border-color: var(--magenta);
  color: var(--cream);
}

/* ── Quote ──────────────────────────────────────────────────────────── */
.bz-quote { padding: 96px 0; background: var(--magenta); color: var(--cream); border-bottom: 3px solid var(--ink); }
.bz-quote-card {
  background: var(--cream);
  color: var(--ink);
  border: 4px solid var(--ink);
  padding: 32px 32px 28px;
  position: relative;
  box-shadow: 12px 12px 0 var(--ink);
  max-width: 880px;
  margin: 0 auto;
}
.bz-quote-tag {
  display: inline-block;
  font-family: var(--mono);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.16em;
  background: var(--ink);
  color: var(--saffron);
  padding: 6px 12px;
  margin-bottom: 18px;
}
.bz-quote-text {
  font-family: var(--display);
  font-weight: 800;
  font-size: clamp(22px, 3vw, 36px);
  line-height: 1.25;
  letter-spacing: -0.02em;
  margin: 0 0 18px;
  text-transform: uppercase;
}
.bz-quote-attr {
  font-family: var(--mono);
  font-size: 12.5px;
  letter-spacing: 0.1em;
  color: var(--ink-2);
}
.bz-quote-attr strong { color: var(--ink); font-weight: 700; }

/* ── Coming soon ────────────────────────────────────────────────────── */
.bz-soon { padding: 96px 0; background: var(--saffron); border-bottom: 3px solid var(--ink); }
.bz-soon-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 32px;
}
@media (max-width: 720px) { .bz-soon-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .bz-soon-grid { grid-template-columns: 1fr; } }
.bz-soon-card {
  background: var(--cream);
  border: 3px solid var(--ink);
  padding: 18px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  transition: all 0.15s;
}
.bz-soon-card:hover { background: var(--magenta); color: var(--cream); border-color: var(--magenta); }
.bz-soon-name {
  font-family: var(--display);
  font-weight: 800;
  font-size: 18px;
  letter-spacing: -0.005em;
}
.bz-soon-tag {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--magenta);
  font-weight: 600;
}
.bz-soon-card:hover .bz-soon-tag { color: var(--saffron); }

/* ── End ────────────────────────────────────────────────────────────── */
.bz-end { padding: 120px 0; background: var(--cream); border-bottom: 3px solid var(--ink); text-align: center; }
.bz-end-title {
  font-family: var(--display);
  font-weight: 900;
  font-size: clamp(56px, 9vw, 144px);
  letter-spacing: -0.045em;
  line-height: 0.88;
  margin: 0 0 22px;
  text-transform: uppercase;
}
.bz-end-mag {
  background: var(--magenta);
  color: var(--cream);
  padding: 0 0.08em;
  display: inline-block;
  transform: rotate(-1.5deg);
}
.bz-end-sub {
  font-family: var(--sans);
  font-size: 18px;
  color: var(--ink-2);
  margin: 0 0 36px;
}
.bz-end-inner .bz-cta-row { justify-content: center; }

/* ── Footer ─────────────────────────────────────────────────────────── */
.bz-foot { background: var(--ink); color: var(--cream); padding: 56px 0 36px; }
.bz-foot-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
  padding-bottom: 36px;
  border-bottom: 2px solid var(--ink-2);
}
@media (max-width: 720px) { .bz-foot-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .bz-foot-grid { grid-template-columns: 1fr; } }
.bz-foot-h {
  font-family: var(--display);
  font-weight: 800;
  font-size: 14px;
  letter-spacing: 0.16em;
  color: var(--saffron);
  margin-bottom: 14px;
}
.bz-foot p, .bz-foot ul {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.05em;
  color: var(--cream);
  opacity: 0.75;
  line-height: 1.7;
  margin: 0;
}
.bz-foot ul { list-style: none; padding: 0; }
.bz-foot a {
  color: var(--cream);
  text-decoration: none;
  transition: color 0.15s;
}
.bz-foot a:hover { color: var(--magenta); }
.bz-foot-tail {
  font-family: var(--display);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.16em;
  color: var(--saffron);
  text-align: center;
  margin-top: 22px;
}

@media (prefers-reduced-motion: reduce) {
  .bz-marquee-track,
  .bz-stamp,
  .bz-eyebrow-pulse,
  .bz-sku-led,
  .bz-sku-body { animation: none; }
}
`;
