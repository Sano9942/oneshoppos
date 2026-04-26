import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Y2K / liquid-chrome landing — preview at /preview/landing-y2k
 *
 * Concept: SanoPOS reimagined as a Y2K product brochure — frosted glass,
 * chrome gradient type, animated mesh-gradient background with floating
 * blobs, holographic CTAs, ✦ sparkles. Self-contained: own fonts, own
 * theme, no Tailwind theme dependency. Ground truth from PRs 1–9.
 */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Tilt+Warp&family=Bricolage+Grotesque:opsz,wght@12..96,300..800&family=JetBrains+Mono:wght@400;500;600&display=swap";

const TICKER = [
  "✦ FREE FOREVER",
  "NO LOCKS",
  "NO TRIAL",
  "NO CARD",
  "FBR INCLUDED",
  "67+ REPORTS",
  "OFFLINE-SAFE",
  "13 COURIERS WIRED IN",
];

const FEATURES = [
  { hue: 1, title: "Counter & receipts", body: "Barcode scan, split tender, returns & exchanges, customer-facing display, F1–F10 shortcuts." },
  { hue: 2, title: "Stock & movement", body: "Per-outlet stock, transfers, kits, serial tracking, dead-stock reports, demand forecasting." },
  { hue: 3, title: "Books, in window", body: "P&L, balance sheet, cash flow, journals, AP/AR, post-dated cheques. No Xero needed." },
  { hue: 4, title: "Customer ledger", body: "Wallet, tiered loyalty, points transfer, 11-segment RFM, blacklisting." },
  { hue: 5, title: "FBR digital invoicing", body: "Real-time IRN with retry queue. HS-code inheritance per category." },
  { hue: 6, title: "Sixty-seven reports", body: "Sales, stock, payroll, accounting. Plus an AI panel that answers in plain language." },
];

const COURIERS = [
  "Leopards", "TCS", "BlueEx", "Postex", "Trax", "Rider",
  "Swyft", "Bykea", "MNP", "Pakpost", "DHL", "FedEx", "CallCourier",
];

const COMING_SOON = ["Salon & Spa", "Clinic & Pharmacy", "Restaurant & Café", "Rentals", "Education", "Veterinary"];

/* ─── Sparkle component ─────────────────────────────────────────────── */

function Sparkle({ top, left, size = 14, delay = 0 }) {
  return (
    <span
      className="y2-spark"
      style={{ top, left, "--sz": `${size}px`, "--d": `${delay}s` }}
      aria-hidden="true"
    >
      ✦
    </span>
  );
}

/* ─── Live ticking counter ──────────────────────────────────────────── */

function LiveTicker({ start = 1847239 }) {
  const [val, setVal] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setVal((v) => v + Math.floor(Math.random() * 4) + 1), 1300);
    return () => clearInterval(t);
  }, []);
  return <>{val.toLocaleString()}</>;
}

/* ─── Page ──────────────────────────────────────────────────────────── */

export default function LandingY2k() {
  const [year] = useState(() => new Date().getFullYear());
  const fontInjected = useRef(false);

  useEffect(() => {
    if (fontInjected.current) return;
    fontInjected.current = true;
    if (!document.querySelector('link[data-y2-font="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      link.setAttribute("data-y2-font", "1");
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="y2-root">
      <style>{Y2_STYLES}</style>

      {/* Mesh gradient + blobs background */}
      <div className="y2-bg" aria-hidden="true">
        <div className="y2-blob y2-blob-1" />
        <div className="y2-blob y2-blob-2" />
        <div className="y2-blob y2-blob-3" />
        <div className="y2-scanlines" />
      </div>

      {/* Sparkle field */}
      <Sparkle top="14%" left="8%" size={22} delay={0} />
      <Sparkle top="22%" left="92%" size={14} delay={0.6} />
      <Sparkle top="38%" left="4%" size={16} delay={1.2} />
      <Sparkle top="52%" left="88%" size={20} delay={0.3} />
      <Sparkle top="68%" left="6%" size={18} delay={1.8} />
      <Sparkle top="82%" left="94%" size={14} delay={0.9} />

      {/* Sticky chrome ticker */}
      <div className="y2-ticker">
        <div className="y2-ticker-track">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="y2-ticker-item">
              <span className="y2-ticker-text">{t}</span>
              <span className="y2-ticker-sep">✧</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="y2-header">
        <div className="y2-container y2-header-row">
          <Link to="/" className="y2-brand">
            <span className="y2-brand-orb" aria-hidden="true">
              <span className="y2-brand-orb-inner">S</span>
            </span>
            <span className="y2-brand-name">SanoPOS</span>
            <span className="y2-brand-meta">v0.1 ✦ chrome ed.</span>
          </Link>
          <nav className="y2-nav">
            <a href="#installed">Installed</a>
            <a href="#plans">Plans</a>
            <a href="#field">Field</a>
            <Link to="/login" className="y2-nav-cta">
              <span>Sign in</span>
              <span className="y2-nav-cta-arrow">›</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="y2-hero">
        <div className="y2-container y2-hero-grid">
          <div className="y2-hero-copy">
            <div className="y2-eyebrow">
              <span className="y2-eyebrow-dot" aria-hidden="true" />
              <span>SPRING / 26 ✦ NEW INSTALL</span>
            </div>

            <h1 className="y2-hero-title">
              <span className="y2-chrome-text">Open</span>{" "}
              <span className="y2-chrome-text">a</span>{" "}
              <span className="y2-chrome-text y2-chrome-warp">Free</span>
              <br />
              <span className="y2-iridescent">Shop</span>
              <span className="y2-hero-period">.</span>
            </h1>

            <p className="y2-lede">
              SanoPOS is a Pakistani point-of-sale system, freshly installed.
              <strong> Free forever for the first shop.</strong> FBR-ready,
              offline-tolerant, sixty-seven reports, and the books all in
              one window. No card. No trial. No locks.
            </p>

            <div className="y2-cta-row">
              <Link to="/signup" className="y2-cta-primary">
                <span className="y2-cta-shine" aria-hidden="true" />
                <span className="y2-cta-text">Open Free Shop</span>
                <span className="y2-cta-arrow" aria-hidden="true">→</span>
              </Link>
              <Link to="/login" className="y2-cta-glass">
                I have a shop · Sign in
              </Link>
            </div>

            <div className="y2-hero-orbs">
              <div className="y2-orb">
                <div className="y2-orb-num">01</div>
                <div className="y2-orb-label">outlet · free</div>
              </div>
              <div className="y2-orb y2-orb-pink">
                <div className="y2-orb-num">100</div>
                <div className="y2-orb-label">products · free</div>
              </div>
              <div className="y2-orb y2-orb-mint">
                <div className="y2-orb-num">8K</div>
                <div className="y2-orb-label">₨ / outlet · pro</div>
              </div>
            </div>
          </div>

          {/* Floating glass console */}
          <aside className="y2-hero-art">
            <div className="y2-console">
              <div className="y2-console-head">
                <span className="y2-console-dot y2-dot-r" />
                <span className="y2-console-dot y2-dot-y" />
                <span className="y2-console-dot y2-dot-g" />
                <span className="y2-console-title">sanopos / counter / live</span>
              </div>
              <div className="y2-console-body">
                <div className="y2-console-row">
                  <span className="y2-console-key">SCAN</span>
                  <span className="y2-console-val">SKU-7841 · KURTA · L</span>
                </div>
                <div className="y2-console-row">
                  <span className="y2-console-key">PRICE</span>
                  <span className="y2-console-val y2-console-num">₨ 3,200</span>
                </div>
                <div className="y2-console-rule" />
                <div className="y2-console-row">
                  <span className="y2-console-key">BILL #04</span>
                  <span className="y2-console-val">2 ITEMS</span>
                </div>
                <div className="y2-console-row">
                  <span className="y2-console-key">SUBTOTAL</span>
                  <span className="y2-console-val">9,855</span>
                </div>
                <div className="y2-console-row y2-console-row-hot">
                  <span className="y2-console-key">FBR</span>
                  <span className="y2-console-val">200 ✓ POSTED</span>
                </div>
                <div className="y2-console-rule" />
                <div className="y2-console-foot">
                  <span className="y2-console-blink" aria-hidden="true" />
                  ready &nbsp;·&nbsp; press F9 to check out
                </div>
              </div>
            </div>
            <div className="y2-console-glow" aria-hidden="true" />
          </aside>
        </div>
      </section>

      {/* ── Live counter ───────────────────────────────────────────── */}
      <section className="y2-counter">
        <div className="y2-container y2-counter-row">
          <div className="y2-counter-cell">
            <div className="y2-counter-label">SALES POSTED · ALL-TIME</div>
            <div className="y2-counter-num"><LiveTicker /></div>
          </div>
          <div className="y2-counter-cell y2-counter-mid">
            <div className="y2-counter-label">REPORTS · INCLUDED</div>
            <div className="y2-counter-num">67<span className="y2-counter-sm">+</span></div>
          </div>
          <div className="y2-counter-cell">
            <div className="y2-counter-label">FEATURES · LOCKED</div>
            <div className="y2-counter-num y2-counter-zero">00</div>
          </div>
        </div>
      </section>

      {/* ── Installed (features) ───────────────────────────────────── */}
      <section className="y2-installed" id="installed">
        <div className="y2-container">
          <header className="y2-section-head">
            <div className="y2-section-tag">// what's installed</div>
            <h2 className="y2-section-title">
              <span className="y2-iridescent">Six</span> components.<br />
              <span className="y2-chrome-text">One install.</span>
            </h2>
            <p className="y2-section-sub">
              Every feature, on every plan. No add-ons, no enterprise tier,
              no "request a demo".
            </p>
          </header>

          <div className="y2-features-grid">
            {FEATURES.map((f, i) => (
              <article className={`y2-feature y2-feature-h${f.hue}`} key={i}>
                <div className="y2-feature-icon" aria-hidden="true">
                  <span>{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h4 className="y2-feature-title">{f.title}</h4>
                <p className="y2-feature-body">{f.body}</p>
                <div className="y2-feature-tag">✦ included</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────── */}
      <section className="y2-plans" id="plans">
        <div className="y2-container">
          <header className="y2-section-head">
            <div className="y2-section-tag">// memberships</div>
            <h2 className="y2-section-title">
              Two plans. <span className="y2-iridescent">Same software.</span>
            </h2>
            <p className="y2-section-sub">
              Free is permanent. Pro is paid per outlet, monthly, additive
              one outlet at a time.
            </p>
          </header>

          <div className="y2-cards">
            <article className="y2-card">
              <div className="y2-card-stripe" />
              <div className="y2-card-meta">PLAN — 01</div>
              <h3 className="y2-card-name">Free</h3>
              <p className="y2-card-tag">For shops finding their feet.</p>
              <div className="y2-card-price">
                <span className="y2-card-cur">₨</span>
                <span className="y2-card-num">0</span>
                <span className="y2-card-cad">forever<br />not a trial</span>
              </div>
              <ul className="y2-card-list">
                <li>One outlet</li>
                <li>Up to three staff</li>
                <li>Up to one hundred products</li>
                <li>Every retail feature, no locks</li>
                <li>FBR digital invoicing</li>
                <li>Offline sale queue</li>
                <li>Community support</li>
              </ul>
              <Link to="/signup" className="y2-card-cta y2-card-cta-quiet">
                Open free shop
                <span aria-hidden="true">›</span>
              </Link>
            </article>

            <article className="y2-card y2-card-feature">
              <div className="y2-card-ribbon">★ for scale</div>
              <div className="y2-card-stripe y2-card-stripe-feature" />
              <div className="y2-card-meta y2-card-meta-feature">PLAN — 02</div>
              <h3 className="y2-card-name y2-card-name-feature">Pro</h3>
              <p className="y2-card-tag y2-card-tag-feature">When the shop has outgrown Free.</p>
              <div className="y2-card-price">
                <span className="y2-card-cur y2-card-cur-feature">₨</span>
                <span className="y2-card-num y2-card-num-feature">8,000</span>
                <span className="y2-card-cad y2-card-cad-feature">per month<br />per outlet</span>
              </div>
              <ul className="y2-card-list y2-card-list-feature">
                <li>Unlimited staff</li>
                <li>Unlimited products</li>
                <li>Multi-outlet + stock transfers</li>
                <li>Context-aware pricing</li>
                <li>AI insights panel</li>
                <li>Email + WhatsApp support</li>
                <li>Cancel from the dashboard</li>
              </ul>
              <Link to="/signup" className="y2-card-cta">
                <span className="y2-cta-shine" aria-hidden="true" />
                Begin on Free · Upgrade later
                <span aria-hidden="true">›</span>
              </Link>
              <p className="y2-card-foot">
                Add additional outlets one at a time, from <em>/billing</em>.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ── Couriers ───────────────────────────────────────────────── */}
      <section className="y2-couriers" id="field">
        <div className="y2-container">
          <header className="y2-section-head">
            <div className="y2-section-tag">// nationwide delivery</div>
            <h2 className="y2-section-title">
              <span className="y2-iridescent">Thirteen</span> couriers,<br />
              one dashboard.
            </h2>
          </header>
          <div className="y2-courier-grid">
            {COURIERS.map((c, i) => (
              <span key={c} className="y2-courier" style={{ "--rot": `${(i % 2 === 0 ? -1 : 1) * 0.6}deg` }}>
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonial ────────────────────────────────────────────── */}
      <section className="y2-quote">
        <div className="y2-container">
          <div className="y2-quote-orb">
            <div className="y2-quote-tag">FIELD REPORT · LAHORE</div>
            <blockquote className="y2-quote-text">
              "We had been paying a Karachi vendor by the feature. SanoPOS
              gave us FBR, multi-outlet, and the books on day one. Closing
              used to take a Saturday. It now takes an hour."
            </blockquote>
            <div className="y2-quote-attr">
              <strong>Bilal A.</strong>
              <span>·</span>
              <span>three-outlet apparel chain</span>
              <span>·</span>
              <span>Lahore</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Coming soon ────────────────────────────────────────────── */}
      <section className="y2-soon">
        <div className="y2-container">
          <header className="y2-section-head">
            <div className="y2-section-tag">// installing soon</div>
            <h2 className="y2-section-title">
              Retail today.<br />
              <span className="y2-chrome-text">The rest, this year.</span>
            </h2>
            <p className="y2-section-sub">
              Public launch is for retail. The other presets are already
              built — opening in waves through the year.
            </p>
          </header>
          <div className="y2-soon-grid">
            {COMING_SOON.map((it) => (
              <div key={it} className="y2-soon-card">
                <span className="y2-soon-icon">✦</span>
                <span className="y2-soon-name">{it}</span>
                <span className="y2-soon-tag">in preview</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── End CTA ────────────────────────────────────────────────── */}
      <section className="y2-end">
        <div className="y2-container y2-end-inner">
          <div className="y2-end-spark">✦</div>
          <h2 className="y2-end-title">
            <span className="y2-iridescent">Begin.</span>
          </h2>
          <p className="y2-end-sub">
            Five minutes. Email to verify. Selling tonight.
          </p>
          <div className="y2-cta-row y2-cta-center">
            <Link to="/signup" className="y2-cta-primary y2-cta-large">
              <span className="y2-cta-shine" aria-hidden="true" />
              <span className="y2-cta-text">Open Free Shop</span>
              <span className="y2-cta-arrow" aria-hidden="true">→</span>
            </Link>
            <Link to="/login" className="y2-cta-glass y2-cta-large">
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="y2-foot">
        <div className="y2-container">
          <div className="y2-foot-grid">
            <div>
              <div className="y2-foot-h">// shop</div>
              <ul>
                <li><Link to="/signup">Open account</Link></li>
                <li><Link to="/login">Sign in</Link></li>
                <li><a href="#plans">Plans</a></li>
                <li><a href="#installed">Installed</a></li>
              </ul>
            </div>
            <div>
              <div className="y2-foot-h">// company</div>
              <ul>
                <li><Link to="/terms">Terms</Link></li>
                <li><Link to="/privacy">Privacy</Link></li>
                <li>hello@sanopos.com</li>
              </ul>
            </div>
            <div>
              <div className="y2-foot-h">// build</div>
              <p>Set in <em>Tilt Warp</em>, <em>Bricolage Grotesque</em>, <em>JetBrains Mono</em>. Composed in Lahore.</p>
            </div>
            <div>
              <div className="y2-foot-h">// edition</div>
              <p>Spring · 26 · Chrome ed.<br />© {year} Sano Merchandise<br />✦ ✦ ✦</p>
            </div>
          </div>
          <div className="y2-foot-tail">
            ✦ ✧ ⋆ &nbsp; thank you for shopping &nbsp; ⋆ ✧ ✦
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Stylesheet ─────────────────────────────────────────────────────────── */

const Y2_STYLES = `
.y2-root {
  --ice: #F0EDFF;
  --ice-2: #E8E2FF;
  --lavender: #A78BFA;
  --lavender-deep: #8B5CF6;
  --electric: #4361EE;
  --pink: #EC4899;
  --pink-soft: #F9A8D4;
  --mint: #6EE7B7;
  --mint-soft: #A0F0D9;
  --ink: #0B0F2A;
  --ink-2: #1F2347;
  --silver: #C7CDE5;
  --silver-2: #DEE0F2;

  --display: "Tilt Warp", "Inter", system-ui, sans-serif;
  --sans: "Bricolage Grotesque", -apple-system, BlinkMacSystemFont, sans-serif;
  --mono: "JetBrains Mono", "SF Mono", Menlo, monospace;

  background: var(--ice);
  color: var(--ink);
  font-family: var(--sans);
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
  overflow-x: hidden;
  position: relative;
}

.y2-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 28px;
  position: relative;
  z-index: 5;
}
@media (max-width: 720px) { .y2-container { padding: 0 18px; } }

/* ── Animated mesh-gradient background ─────────────────────────────── */
.y2-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 0% 0%, rgba(167,139,250,0.45) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 0%, rgba(236,72,153,0.30) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 100%, rgba(110,231,183,0.30) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 100%, rgba(67,97,238,0.30) 0%, transparent 50%),
    var(--ice);
}
.y2-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.45;
  mix-blend-mode: screen;
  animation: y2-float 18s ease-in-out infinite;
}
.y2-blob-1 {
  width: 540px; height: 540px;
  top: -120px; left: -120px;
  background: radial-gradient(circle, var(--lavender) 0%, transparent 70%);
}
.y2-blob-2 {
  width: 420px; height: 420px;
  top: 30%; right: -100px;
  background: radial-gradient(circle, var(--pink) 0%, transparent 70%);
  animation-delay: -6s;
  animation-duration: 22s;
}
.y2-blob-3 {
  width: 480px; height: 480px;
  bottom: 10%; left: 30%;
  background: radial-gradient(circle, var(--mint) 0%, transparent 70%);
  animation-delay: -12s;
  animation-duration: 26s;
}
@keyframes y2-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(40px, -30px) scale(1.06); }
  66% { transform: translate(-30px, 50px) scale(0.96); }
}
.y2-scanlines {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    0deg, transparent 0px, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 3px
  );
  pointer-events: none;
}

/* ── Sparkles ──────────────────────────────────────────────────────── */
.y2-spark {
  position: absolute;
  font-size: var(--sz, 14px);
  color: #FFF;
  text-shadow:
    0 0 8px var(--lavender),
    0 0 16px var(--pink);
  animation: y2-twinkle 2.4s ease-in-out infinite;
  animation-delay: var(--d, 0s);
  z-index: 3;
  pointer-events: none;
  user-select: none;
}
@keyframes y2-twinkle {
  0%, 100% { opacity: 0.2; transform: scale(0.8) rotate(0); }
  50% { opacity: 1; transform: scale(1.2) rotate(180deg); }
}

/* ── Ticker ────────────────────────────────────────────────────────── */
.y2-ticker {
  background: linear-gradient(90deg,
    var(--lavender) 0%, var(--pink) 25%, var(--mint) 50%, var(--electric) 75%, var(--lavender) 100%);
  background-size: 200% 100%;
  animation: y2-flow 8s linear infinite;
  color: white;
  padding: 10px 0;
  overflow: hidden;
  white-space: nowrap;
  position: relative;
  z-index: 10;
  border-bottom: 1px solid rgba(255,255,255,0.4);
}
@keyframes y2-flow {
  from { background-position: 0% 0; }
  to { background-position: 200% 0; }
}
.y2-ticker-track {
  display: inline-flex;
  animation: y2-marq 32s linear infinite;
  font-family: var(--mono);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-shadow: 0 1px 0 rgba(0,0,0,0.25);
}
@keyframes y2-marq { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.y2-ticker-item { display: inline-flex; align-items: center; gap: 24px; padding-right: 24px; }
.y2-ticker-sep { opacity: 0.7; }

/* ── Header ────────────────────────────────────────────────────────── */
.y2-header {
  position: sticky;
  top: 0;
  z-index: 9;
  background: rgba(240,237,255,0.65);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border-bottom: 1px solid rgba(255,255,255,0.45);
  padding: 14px 0;
}
.y2-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.y2-brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--ink); }
.y2-brand-orb {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: conic-gradient(from 0deg,
    var(--lavender), var(--pink), var(--mint), var(--electric), var(--lavender));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(167,139,250,0.45), inset 0 1px 0 rgba(255,255,255,0.6);
  animation: y2-spin 8s linear infinite;
  position: relative;
}
@keyframes y2-spin { to { transform: rotate(360deg); } }
.y2-brand-orb-inner {
  width: 28px;
  height: 28px;
  background: var(--ink);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--display);
  font-weight: 400;
  font-size: 16px;
}
.y2-brand-name {
  font-family: var(--display);
  font-size: 22px;
  letter-spacing: -0.005em;
  color: var(--ink);
}
.y2-brand-meta {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--lavender-deep);
  margin-left: 4px;
}
.y2-nav { display: flex; align-items: center; gap: 26px; }
.y2-nav a {
  font-family: var(--sans);
  font-weight: 500;
  font-size: 15px;
  color: var(--ink);
  text-decoration: none;
  letter-spacing: 0;
  transition: color 0.2s;
}
.y2-nav a:hover { color: var(--electric); }
.y2-nav-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--ink) !important;
  color: white !important;
  padding: 9px 16px;
  border-radius: 999px;
  font-weight: 600 !important;
  transition: all 0.25s;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.5), 0 4px 16px rgba(11,15,42,0.25);
}
.y2-nav-cta:hover {
  background: linear-gradient(135deg, var(--lavender), var(--pink)) !important;
  color: white !important;
  transform: translateY(-1px);
}
.y2-nav-cta-arrow { transition: transform 0.2s; }
.y2-nav-cta:hover .y2-nav-cta-arrow { transform: translateX(2px); }
@media (max-width: 720px) {
  .y2-nav { gap: 14px; }
  .y2-nav a:not(.y2-nav-cta) { display: none; }
  .y2-brand-meta { display: none; }
}

/* ── Hero ──────────────────────────────────────────────────────────── */
.y2-hero { padding: 88px 0 96px; }
.y2-hero-grid {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 64px;
  align-items: center;
}
@media (max-width: 980px) {
  .y2-hero-grid { grid-template-columns: 1fr; gap: 56px; }
}

.y2-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--ink);
  background: rgba(255,255,255,0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.7);
  box-shadow: 0 4px 20px rgba(167,139,250,0.18);
  margin-bottom: 28px;
}
.y2-eyebrow-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--pink);
  box-shadow: 0 0 10px var(--pink);
  animation: y2-pulse 1.6s ease-in-out infinite;
}
@keyframes y2-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}

.y2-hero-title {
  font-family: var(--display);
  font-size: clamp(58px, 9vw, 144px);
  font-weight: 400;
  line-height: 0.95;
  letter-spacing: -0.025em;
  margin: 0 0 28px;
}
.y2-hero-period {
  background: linear-gradient(135deg, var(--pink), var(--lavender));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

/* Chrome text — gradient-clipped with shimmer */
.y2-chrome-text {
  display: inline-block;
  background: linear-gradient(180deg,
    #FFFFFF 0%, var(--silver-2) 30%, var(--silver) 50%, #FFFFFF 70%, var(--silver) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 4px 24px rgba(199,205,229,0.45);
  filter: drop-shadow(0 2px 0 rgba(11,15,42,0.15));
}
.y2-chrome-warp {
  background: linear-gradient(180deg,
    #FFFFFF 0%, var(--silver-2) 30%, var(--lavender) 55%, #FFFFFF 75%, var(--silver) 100%);
  -webkit-background-clip: text;
  background-clip: text;
}

/* Iridescent text — animated rainbow gradient */
.y2-iridescent {
  display: inline-block;
  background: linear-gradient(110deg,
    var(--lavender) 0%, var(--pink) 20%, var(--mint) 40%, var(--electric) 60%,
    var(--lavender) 80%, var(--pink) 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: y2-iridescent 6s linear infinite;
}
@keyframes y2-iridescent {
  from { background-position: 0% 50%; }
  to { background-position: 200% 50%; }
}

.y2-lede {
  font-family: var(--sans);
  font-size: clamp(17px, 1.5vw, 21px);
  line-height: 1.55;
  color: var(--ink-2);
  max-width: 580px;
  margin: 0 0 36px;
  font-weight: 400;
}
.y2-lede strong {
  background: linear-gradient(135deg, var(--lavender-deep), var(--pink));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  font-weight: 700;
}

.y2-cta-row {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.y2-cta-center { justify-content: center; }

.y2-cta-primary {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 15px;
  color: white;
  background: linear-gradient(135deg, var(--ink) 0%, var(--ink-2) 100%);
  padding: 16px 26px;
  border-radius: 999px;
  text-decoration: none;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.4);
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.5) inset,
    0 1px 0 rgba(255,255,255,0.3) inset,
    0 8px 30px rgba(11,15,42,0.30),
    0 2px 6px rgba(11,15,42,0.20);
  transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.y2-cta-large { padding: 20px 34px; font-size: 17px; }
.y2-cta-primary:hover {
  transform: translateY(-2px);
  background: linear-gradient(135deg, var(--lavender-deep) 0%, var(--electric) 100%);
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.6) inset,
    0 12px 40px rgba(139,92,246,0.45),
    0 4px 10px rgba(11,15,42,0.25);
}
.y2-cta-shine {
  position: absolute;
  top: 0;
  left: -100%;
  width: 50%;
  height: 100%;
  background: linear-gradient(90deg,
    transparent, rgba(255,255,255,0.6), transparent);
  animation: y2-shine 3s linear infinite;
  pointer-events: none;
}
@keyframes y2-shine {
  from { left: -100%; }
  to { left: 200%; }
}
.y2-cta-text { position: relative; z-index: 1; }
.y2-cta-arrow { position: relative; z-index: 1; transition: transform 0.2s; }
.y2-cta-primary:hover .y2-cta-arrow { transform: translateX(3px); }

.y2-cta-glass {
  display: inline-flex;
  align-items: center;
  font-family: var(--sans);
  font-weight: 500;
  font-size: 15px;
  color: var(--ink);
  background: rgba(255,255,255,0.45);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  padding: 16px 26px;
  border-radius: 999px;
  text-decoration: none;
  border: 1px solid rgba(255,255,255,0.7);
  transition: all 0.25s;
}
.y2-cta-large.y2-cta-glass { padding: 20px 30px; font-size: 16px; }
.y2-cta-glass:hover {
  background: rgba(255,255,255,0.7);
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(167,139,250,0.20);
}

.y2-hero-orbs {
  display: flex;
  gap: 12px;
  margin-top: 48px;
  flex-wrap: wrap;
}
.y2-orb {
  background: rgba(255,255,255,0.55);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.7);
  border-radius: 28px;
  padding: 18px 22px;
  flex: 1;
  min-width: 130px;
  box-shadow: 0 6px 30px rgba(167,139,250,0.18);
  transition: all 0.3s;
}
.y2-orb:hover { transform: translateY(-3px); box-shadow: 0 10px 40px rgba(167,139,250,0.28); }
.y2-orb-num {
  font-family: var(--display);
  font-weight: 400;
  font-size: 36px;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, var(--lavender-deep), var(--electric));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  line-height: 1;
}
.y2-orb-pink .y2-orb-num { background: linear-gradient(135deg, var(--pink), var(--lavender-deep)); -webkit-background-clip: text; background-clip: text; }
.y2-orb-mint .y2-orb-num { background: linear-gradient(135deg, var(--mint), var(--electric)); -webkit-background-clip: text; background-clip: text; }
.y2-orb-label {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--ink-2);
  margin-top: 6px;
  font-weight: 500;
  text-transform: uppercase;
}

/* ── Hero console ──────────────────────────────────────────────────── */
.y2-hero-art { position: relative; }
.y2-console-glow {
  position: absolute;
  inset: -40px;
  background: radial-gradient(ellipse, rgba(167,139,250,0.5) 0%, transparent 60%);
  filter: blur(40px);
  z-index: 0;
  pointer-events: none;
}
.y2-console {
  position: relative;
  background: rgba(255,255,255,0.55);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-radius: 24px;
  border: 1px solid rgba(255,255,255,0.7);
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.5) inset,
    0 20px 60px rgba(11,15,42,0.20),
    0 6px 16px rgba(11,15,42,0.10);
  z-index: 2;
  overflow: hidden;
  transform: rotate(-1.4deg);
  transition: transform 0.5s ease;
}
.y2-console:hover { transform: rotate(0deg) translateY(-4px); }

.y2-console-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  background: rgba(11,15,42,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.5);
}
.y2-console-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  box-shadow: 0 1px 0 rgba(255,255,255,0.5) inset, 0 0 6px currentColor;
}
.y2-dot-r { background: linear-gradient(135deg, #FF7A85, #DC2626); color: #FF7A85; }
.y2-dot-y { background: linear-gradient(135deg, #FBBF24, #D97706); color: #FBBF24; }
.y2-dot-g { background: linear-gradient(135deg, #6EE7B7, #059669); color: #6EE7B7; }
.y2-console-title {
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--ink-2);
  margin-left: 6px;
}

.y2-console-body { padding: 22px; }
.y2-console-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 6px 0;
  font-family: var(--mono);
  font-size: 13px;
}
.y2-console-key {
  color: var(--ink-2);
  font-weight: 600;
  letter-spacing: 0.06em;
  font-size: 11px;
  text-transform: uppercase;
}
.y2-console-val {
  color: var(--ink);
  font-weight: 500;
  letter-spacing: 0.02em;
}
.y2-console-num {
  font-family: var(--display);
  font-weight: 400;
  font-size: 20px;
  background: linear-gradient(135deg, var(--lavender-deep), var(--pink));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}
.y2-console-row-hot .y2-console-key { color: var(--mint); }
.y2-console-row-hot .y2-console-val {
  color: white;
  background: linear-gradient(135deg, var(--mint), var(--electric));
  padding: 2px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  box-shadow: 0 2px 8px rgba(67,97,238,0.30);
}
.y2-console-rule {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(11,15,42,0.15), transparent);
  margin: 10px 0;
}
.y2-console-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 8px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--ink-2);
}
.y2-console-blink {
  width: 8px;
  height: 14px;
  background: var(--electric);
  animation: y2-blink 1s steps(2) infinite;
  box-shadow: 0 0 6px var(--electric);
}
@keyframes y2-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.1; } }

/* ── Counter strip ─────────────────────────────────────────────────── */
.y2-counter {
  margin: 0 28px 96px;
  background: rgba(255,255,255,0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border-radius: 28px;
  border: 1px solid rgba(255,255,255,0.7);
  box-shadow: 0 10px 40px rgba(167,139,250,0.18);
  padding: 32px 40px;
  max-width: 1224px;
  margin-left: auto;
  margin-right: auto;
  margin-bottom: 96px;
}
@media (max-width: 720px) { .y2-counter { padding: 24px; margin: 0 18px 64px; } }
.y2-counter-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr;
  gap: 32px;
  align-items: center;
  padding: 0;
}
@media (max-width: 720px) { .y2-counter-row { grid-template-columns: 1fr; gap: 18px; } }
.y2-counter-mid { text-align: center; border-left: 1px solid rgba(11,15,42,0.10); border-right: 1px solid rgba(11,15,42,0.10); padding: 0 24px; }
@media (max-width: 720px) { .y2-counter-mid { border: none; padding: 0; } }
.y2-counter-label {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--ink-2);
  margin-bottom: 8px;
  font-weight: 500;
  text-transform: uppercase;
}
.y2-counter-num {
  font-family: var(--display);
  font-weight: 400;
  font-size: clamp(44px, 6vw, 76px);
  letter-spacing: -0.03em;
  line-height: 1;
  background: linear-gradient(135deg, var(--lavender-deep), var(--electric), var(--pink));
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: y2-iridescent 6s linear infinite;
}
.y2-counter-sm { font-size: 0.6em; }
.y2-counter-zero {
  background: linear-gradient(135deg, var(--mint), var(--electric));
  -webkit-background-clip: text;
  background-clip: text;
}

/* ── Section heads ─────────────────────────────────────────────────── */
.y2-section-head { text-align: center; margin-bottom: 56px; }
.y2-section-tag {
  display: inline-block;
  font-family: var(--mono);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--lavender-deep);
  margin-bottom: 14px;
  text-transform: uppercase;
}
.y2-section-title {
  font-family: var(--display);
  font-size: clamp(40px, 6vw, 88px);
  font-weight: 400;
  letter-spacing: -0.025em;
  line-height: 0.98;
  margin: 0 0 16px;
  color: var(--ink);
}
.y2-section-sub {
  font-family: var(--sans);
  font-size: clamp(16px, 1.4vw, 18.5px);
  color: var(--ink-2);
  max-width: 600px;
  margin: 0 auto;
  line-height: 1.55;
}

/* ── Features grid ─────────────────────────────────────────────────── */
.y2-installed { padding: 88px 0; }
.y2-features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 22px;
}
@media (max-width: 880px) { .y2-features-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .y2-features-grid { grid-template-columns: 1fr; } }
.y2-feature {
  position: relative;
  background: rgba(255,255,255,0.5);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-radius: 22px;
  border: 1px solid rgba(255,255,255,0.65);
  padding: 24px 22px 22px;
  box-shadow: 0 8px 32px rgba(167,139,250,0.14);
  transition: all 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
  overflow: hidden;
}
.y2-feature::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent 60%, rgba(255,255,255,0.4) 100%);
  pointer-events: none;
  border-radius: 22px;
}
.y2-feature:hover {
  transform: translateY(-4px);
  box-shadow: 0 14px 50px rgba(167,139,250,0.28);
}
.y2-feature-icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  font-family: var(--display);
  font-weight: 400;
  font-size: 22px;
  color: white;
  box-shadow: 0 4px 16px rgba(11,15,42,0.18), inset 0 1px 0 rgba(255,255,255,0.5);
}
.y2-feature-h1 .y2-feature-icon { background: linear-gradient(135deg, var(--lavender), var(--lavender-deep)); }
.y2-feature-h2 .y2-feature-icon { background: linear-gradient(135deg, var(--pink), var(--lavender-deep)); }
.y2-feature-h3 .y2-feature-icon { background: linear-gradient(135deg, var(--mint), var(--electric)); }
.y2-feature-h4 .y2-feature-icon { background: linear-gradient(135deg, var(--electric), var(--lavender-deep)); }
.y2-feature-h5 .y2-feature-icon { background: linear-gradient(135deg, var(--pink), var(--electric)); }
.y2-feature-h6 .y2-feature-icon { background: linear-gradient(135deg, var(--mint), var(--lavender)); }

.y2-feature-title {
  font-family: var(--display);
  font-size: 22px;
  font-weight: 400;
  margin: 0 0 10px;
  color: var(--ink);
  letter-spacing: -0.01em;
}
.y2-feature-body {
  font-family: var(--sans);
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--ink-2);
  margin: 0 0 18px;
}
.y2-feature-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--lavender-deep);
  font-weight: 600;
  text-transform: uppercase;
  background: rgba(167,139,250,0.10);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(167,139,250,0.25);
}

/* ── Cards / pricing ───────────────────────────────────────────────── */
.y2-plans { padding: 96px 0; }
.y2-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-top: 16px;
}
@media (max-width: 880px) { .y2-cards { grid-template-columns: 1fr; } }
.y2-card {
  position: relative;
  background: rgba(255,255,255,0.6);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border-radius: 32px;
  border: 1px solid rgba(255,255,255,0.7);
  padding: 36px 32px 30px;
  overflow: hidden;
  box-shadow: 0 12px 50px rgba(167,139,250,0.18);
  transition: all 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.y2-card:hover { transform: translateY(-4px); box-shadow: 0 20px 70px rgba(167,139,250,0.30); }

.y2-card-feature {
  background: linear-gradient(135deg, rgba(11,15,42,0.95) 0%, rgba(31,35,71,0.95) 100%);
  color: white;
  border-color: rgba(255,255,255,0.15);
}
.y2-card-stripe {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--lavender), var(--pink), var(--mint), var(--electric));
}
.y2-card-stripe-feature {
  background: linear-gradient(90deg, var(--mint), var(--lavender), var(--pink));
}
.y2-card-ribbon {
  position: absolute;
  top: 24px; right: -42px;
  background: linear-gradient(135deg, var(--lavender-deep), var(--pink));
  color: white;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  font-weight: 700;
  padding: 6px 50px;
  transform: rotate(40deg);
  text-transform: uppercase;
  box-shadow: 0 4px 16px rgba(139,92,246,0.40);
}

.y2-card-meta {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.18em;
  color: var(--lavender-deep);
  font-weight: 600;
  margin-bottom: 8px;
}
.y2-card-meta-feature { color: var(--mint); }
.y2-card-name {
  font-family: var(--display);
  font-size: clamp(48px, 6vw, 72px);
  font-weight: 400;
  margin: 0;
  letter-spacing: -0.025em;
  line-height: 1;
  color: var(--ink);
}
.y2-card-name-feature {
  background: linear-gradient(135deg, white 0%, var(--lavender) 50%, var(--mint) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}
.y2-card-tag {
  font-family: var(--sans);
  font-size: 15.5px;
  color: var(--ink-2);
  margin: 6px 0 22px;
  font-style: italic;
}
.y2-card-tag-feature { color: rgba(255,255,255,0.6); }

.y2-card-price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 22px;
  padding-bottom: 22px;
  border-bottom: 1px solid rgba(11,15,42,0.10);
}
.y2-card-feature .y2-card-price { border-bottom-color: rgba(255,255,255,0.10); }
.y2-card-cur {
  font-family: var(--display);
  font-size: 24px;
  color: var(--ink-2);
}
.y2-card-cur-feature { color: rgba(255,255,255,0.6); }
.y2-card-num {
  font-family: var(--display);
  font-weight: 400;
  font-size: clamp(64px, 8vw, 100px);
  letter-spacing: -0.035em;
  color: var(--ink);
  line-height: 0.9;
}
.y2-card-num-feature {
  background: linear-gradient(135deg, var(--mint), var(--lavender), var(--pink));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}
.y2-card-cad {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--ink-2);
  margin-left: auto;
  text-align: right;
  text-transform: uppercase;
  line-height: 1.5;
}
.y2-card-cad-feature { color: rgba(255,255,255,0.6); }

.y2-card-list {
  list-style: none;
  padding: 0;
  margin: 0 0 28px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.y2-card-list li {
  font-family: var(--sans);
  font-size: 15px;
  color: var(--ink);
  padding-left: 22px;
  position: relative;
}
.y2-card-list-feature li { color: rgba(255,255,255,0.92); }
.y2-card-list li::before {
  content: "✦";
  position: absolute;
  left: 0;
  color: var(--lavender-deep);
  font-size: 13px;
}
.y2-card-list-feature li::before {
  background: linear-gradient(135deg, var(--mint), var(--lavender));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.y2-card-cta {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 15px;
  color: white;
  background: linear-gradient(135deg, var(--lavender-deep) 0%, var(--electric) 100%);
  padding: 16px 22px;
  border-radius: 999px;
  text-decoration: none;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.4);
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.4) inset,
    0 8px 28px rgba(139,92,246,0.40);
  transition: all 0.3s;
}
.y2-card-cta:hover {
  transform: translateY(-2px);
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.5) inset,
    0 12px 40px rgba(139,92,246,0.55);
}
.y2-card-cta-quiet {
  background: rgba(11,15,42,0.06);
  color: var(--ink);
  border-color: rgba(11,15,42,0.15);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.5) inset;
}
.y2-card-cta-quiet:hover {
  background: var(--ink);
  color: white;
  border-color: var(--ink);
  box-shadow: 0 8px 28px rgba(11,15,42,0.30);
}

.y2-card-foot {
  font-family: var(--sans);
  font-style: italic;
  font-size: 13.5px;
  color: rgba(255,255,255,0.55);
  margin: 14px 0 0;
  text-align: center;
}
.y2-card-foot em { color: var(--mint); font-style: italic; font-weight: 500; }

/* ── Couriers ──────────────────────────────────────────────────────── */
.y2-couriers { padding: 96px 0; }
.y2-courier-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 32px;
}
.y2-courier {
  font-family: var(--display);
  font-size: 18px;
  letter-spacing: 0.01em;
  color: var(--ink);
  background: linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.45) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 12px 22px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.7);
  box-shadow: 0 4px 16px rgba(167,139,250,0.18), inset 0 1px 0 rgba(255,255,255,0.6);
  transform: rotate(var(--rot, 0deg));
  transition: all 0.3s;
}
.y2-courier:hover {
  transform: rotate(0deg) translateY(-2px);
  background: linear-gradient(180deg, var(--lavender-deep) 0%, var(--electric) 100%);
  color: white;
  box-shadow: 0 8px 24px rgba(139,92,246,0.45);
}

/* ── Quote orb ─────────────────────────────────────────────────────── */
.y2-quote { padding: 96px 0; }
.y2-quote-orb {
  background: rgba(255,255,255,0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border-radius: 36px;
  border: 1px solid rgba(255,255,255,0.7);
  padding: 48px 48px 40px;
  text-align: center;
  max-width: 880px;
  margin: 0 auto;
  position: relative;
  box-shadow: 0 20px 60px rgba(167,139,250,0.20);
  overflow: hidden;
}
.y2-quote-orb::before {
  content: "";
  position: absolute;
  top: -100px; left: -100px;
  width: 300px; height: 300px;
  background: radial-gradient(circle, var(--pink) 0%, transparent 70%);
  filter: blur(40px);
  opacity: 0.4;
  pointer-events: none;
}
.y2-quote-orb::after {
  content: "";
  position: absolute;
  bottom: -100px; right: -100px;
  width: 300px; height: 300px;
  background: radial-gradient(circle, var(--mint) 0%, transparent 70%);
  filter: blur(40px);
  opacity: 0.4;
  pointer-events: none;
}
.y2-quote-tag {
  display: inline-block;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--lavender-deep);
  background: rgba(167,139,250,0.12);
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(167,139,250,0.25);
  margin-bottom: 22px;
  font-weight: 600;
  position: relative;
}
.y2-quote-text {
  font-family: var(--display);
  font-weight: 400;
  font-size: clamp(22px, 2.6vw, 32px);
  line-height: 1.4;
  color: var(--ink);
  margin: 0 0 22px;
  letter-spacing: -0.012em;
  position: relative;
}
.y2-quote-attr {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  font-family: var(--sans);
  font-size: 14px;
  color: var(--ink-2);
  position: relative;
}
.y2-quote-attr strong { color: var(--ink); font-weight: 600; }
.y2-quote-attr span:nth-child(even) { color: var(--lavender-deep); }

/* ── Coming soon ───────────────────────────────────────────────────── */
.y2-soon { padding: 96px 0; }
.y2-soon-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-top: 32px;
}
@media (max-width: 720px) { .y2-soon-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .y2-soon-grid { grid-template-columns: 1fr; } }
.y2-soon-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255,255,255,0.5);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.65);
  border-radius: 16px;
  padding: 16px 20px;
  transition: all 0.25s;
  box-shadow: 0 4px 20px rgba(167,139,250,0.10);
}
.y2-soon-card:hover {
  transform: translateY(-2px);
  background: rgba(255,255,255,0.7);
  box-shadow: 0 8px 28px rgba(167,139,250,0.25);
}
.y2-soon-icon {
  font-family: var(--display);
  color: var(--lavender-deep);
  font-size: 18px;
}
.y2-soon-name {
  font-family: var(--display);
  font-size: 18px;
  color: var(--ink);
  flex: 1;
  letter-spacing: -0.005em;
}
.y2-soon-tag {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ink-2);
  font-weight: 500;
  text-transform: uppercase;
  background: rgba(11,15,42,0.06);
  padding: 4px 9px;
  border-radius: 999px;
}

/* ── End CTA ───────────────────────────────────────────────────────── */
.y2-end {
  padding: 128px 0;
  text-align: center;
  position: relative;
}
.y2-end-spark {
  font-family: var(--display);
  font-size: 56px;
  background: linear-gradient(135deg, var(--lavender-deep), var(--pink), var(--mint));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  margin-bottom: 14px;
  animation: y2-twinkle 3s ease-in-out infinite;
}
.y2-end-title {
  font-family: var(--display);
  font-size: clamp(56px, 9vw, 144px);
  font-weight: 400;
  letter-spacing: -0.03em;
  line-height: 1;
  margin: 0 0 18px;
}
.y2-end-sub {
  font-family: var(--sans);
  font-size: clamp(17px, 1.5vw, 21px);
  color: var(--ink-2);
  margin: 0 0 36px;
}

/* ── Footer ────────────────────────────────────────────────────────── */
.y2-foot {
  padding: 56px 0 36px;
  background: rgba(255,255,255,0.4);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255,255,255,0.6);
}
.y2-foot-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
  padding-bottom: 28px;
  border-bottom: 1px solid rgba(11,15,42,0.10);
}
@media (max-width: 720px) { .y2-foot-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .y2-foot-grid { grid-template-columns: 1fr; } }
.y2-foot-h {
  font-family: var(--mono);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--lavender-deep);
  margin-bottom: 14px;
  text-transform: uppercase;
}
.y2-foot p, .y2-foot ul {
  font-family: var(--sans);
  font-size: 14px;
  color: var(--ink-2);
  line-height: 1.65;
  margin: 0;
}
.y2-foot p em { color: var(--lavender-deep); font-style: italic; font-weight: 500; }
.y2-foot ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.y2-foot a {
  color: var(--ink);
  text-decoration: none;
  transition: color 0.2s;
}
.y2-foot a:hover { color: var(--lavender-deep); }
.y2-foot-tail {
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.16em;
  color: var(--lavender-deep);
  text-align: center;
  margin-top: 22px;
  font-weight: 500;
}

@media (prefers-reduced-motion: reduce) {
  .y2-blob, .y2-spark, .y2-eyebrow-dot, .y2-iridescent, .y2-counter-num,
  .y2-cta-shine, .y2-ticker, .y2-ticker-track, .y2-brand-orb, .y2-end-spark,
  .y2-console-blink {
    animation: none !important;
  }
  .y2-console { transform: none; }
}
`;
