import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Showroom / premium-tech landing — preview at /preview/landing-showroom
 *
 * Concept: Linear/Vercel-tier dark refined SaaS, but with a warm-amber
 * accent instead of the purple-blue cliché. Product-first hero (CSS-built
 * POS dashboard mockup with floating annotation chips). Inter Tight +
 * Instrument Serif italic + Geist Mono. Same ground truth from PRs 1–9.
 */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600;700;800&family=Instrument+Serif:ital@0;1&family=Geist+Mono:wght@400;500;600&display=swap";

const FEATURES = [
  {
    kicker: "Counter",
    title: "A POS that doesn't slow down at rush hour.",
    body: "Barcode scanning, split-tender, returns and exchanges, parked sales, customer-facing display. Every action mapped to a F-key. The cashier never has to think.",
    bullets: ["F1–F10 shortcuts", "Offline sale queue", "Customer-facing display", "PIN re-auth mid-checkout"],
  },
  {
    kicker: "Compliance",
    title: "FBR, posted at the moment of sale.",
    body: "Real-time IRN with a retry queue. HS-code inheritance per category, surfaced as a tax-rate lookup. Stop thinking about compliance.",
    bullets: ["Real-time IRN", "Retry queue with backoff", "Category-level HS codes", "Tax-rate lookup"],
  },
  {
    kicker: "Books",
    title: "The ledger lives in the same window.",
    body: "P&L, balance sheet, cash flow, journal entries, AP/AR, post-dated cheques. No QuickBooks export. No Xero subscription. The books close on Friday.",
    bullets: ["Chart of accounts", "Journal + ledger", "AP/AR aging", "Closing in a sitting"],
  },
];

const STATS = [
  { num: "67+", label: "Reports", sub: "sales · stock · payroll · books" },
  { num: "13", label: "Couriers", sub: "leopards · tcs · postex · …" },
  { num: "11", label: "RFM segments", sub: "champions → at-risk" },
  { num: "0", label: "Feature locks", sub: "free or pro · same software" },
];

const AMENITIES = [
  ["Stock & movement", "Per-outlet stock, transfers, kits, serial tracking, dead-stock reports."],
  ["Purchasing", "PO with multi-level approvals, partial GRN, scanned receiving, supplier ledger."],
  ["Customer ledger", "Wallet, tiered loyalty, points transfer, RFM segmentation, blacklisting."],
  ["Reports", "Sixty-seven tabs. AI panel that answers in plain language. CSV everywhere."],
  ["Hardware", "USB scanners, ESC/POS thermal, network TCP/IP printing — standard kit."],
  ["Channels", "Shopify, WooCommerce, and Daraz stock kept in lockstep with the counter."],
  ["Offline", "Sale queue persists locally, syncs when the line returns. Outages stop being events."],
  ["Workforce", "Attendance with PIN kiosk, leave, payroll export. Shifts and cash drawer reconciled."],
];

const COMING_SOON = ["Salon & Spa", "Clinic & Pharmacy", "Restaurant & Café", "Rentals", "Education", "Veterinary"];

/* ─── CSS-built POS dashboard mockup ────────────────────────────────────── */

function ProductMockup() {
  return (
    <div className="sh-product">
      <div className="sh-product-glow" aria-hidden="true" />
      <div className="sh-product-frame">
        <div className="sh-product-bar">
          <div className="sh-product-dots">
            <span className="sh-dot sh-dot-r" />
            <span className="sh-dot sh-dot-y" />
            <span className="sh-dot sh-dot-g" />
          </div>
          <div className="sh-product-url">
            <span className="sh-product-url-lock">⏻</span>
            sanopos.com / counter
          </div>
          <div className="sh-product-bar-right">
            <span className="sh-product-status">
              <span className="sh-product-led" /> live
            </span>
          </div>
        </div>

        <div className="sh-product-body">
          <aside className="sh-side">
            <div className="sh-side-brand">
              <div className="sh-side-mark">S</div>
              <div>
                <div className="sh-side-shop">Maison Khaadi</div>
                <div className="sh-side-meta">Outlet 01 · Lahore</div>
              </div>
            </div>
            <nav className="sh-side-nav">
              <div className="sh-side-section">workspace</div>
              <a className="sh-side-item sh-side-active">▦ Counter</a>
              <a className="sh-side-item">◰ Stock</a>
              <a className="sh-side-item">⊟ Orders</a>
              <a className="sh-side-item">⊕ Customers</a>
              <a className="sh-side-item">◐ Reports</a>
              <div className="sh-side-section">books</div>
              <a className="sh-side-item">⌗ Accounting</a>
              <a className="sh-side-item">⊞ Purchasing</a>
            </nav>
            <div className="sh-side-foot">
              <div className="sh-side-shift">
                <div className="sh-side-shift-label">shift · open</div>
                <div className="sh-side-shift-time">9:14 → 17:00</div>
              </div>
            </div>
          </aside>

          <main className="sh-main">
            <div className="sh-main-row">
              <div className="sh-main-h">Counter</div>
              <div className="sh-main-keys">
                <span className="sh-key">F2</span>
                <span className="sh-key-label">discount</span>
                <span className="sh-key">F4</span>
                <span className="sh-key-label">customer</span>
                <span className="sh-key">F9</span>
                <span className="sh-key-label">checkout</span>
              </div>
            </div>

            <div className="sh-cards">
              <div className="sh-tile">
                <div className="sh-tile-label">today</div>
                <div className="sh-tile-num">₨ 887,200</div>
                <div className="sh-tile-meta">+12.4% <span>vs yesterday</span></div>
                <svg className="sh-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
                  <path d="M0,22 L10,18 L20,20 L30,15 L40,12 L50,16 L60,8 L70,10 L80,5 L90,8 L100,3"
                    stroke="var(--sh-amber)" strokeWidth="1.5" fill="none" />
                  <path d="M0,22 L10,18 L20,20 L30,15 L40,12 L50,16 L60,8 L70,10 L80,5 L90,8 L100,3 L100,28 L0,28 Z"
                    fill="url(#sh-sparkfill)" />
                  <defs>
                    <linearGradient id="sh-sparkfill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="var(--sh-amber)" stopOpacity="0.35" />
                      <stop offset="1" stopColor="var(--sh-amber)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="sh-tile">
                <div className="sh-tile-label">transactions</div>
                <div className="sh-tile-num">184</div>
                <div className="sh-tile-meta">avg ₨ 4,820</div>
                <div className="sh-bars">
                  {[40, 55, 72, 65, 80, 95, 88, 70].map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <div className="sh-tile">
                <div className="sh-tile-label">FBR · 184/184</div>
                <div className="sh-tile-num sh-tile-num-mint">All posted</div>
                <div className="sh-tile-meta">retry queue · 0</div>
                <div className="sh-rows">
                  <div className="sh-rows-r"><span>IRN 7000007D9</span><span className="sh-mint">✓</span></div>
                  <div className="sh-rows-r"><span>IRN 7000007D8</span><span className="sh-mint">✓</span></div>
                  <div className="sh-rows-r"><span>IRN 7000007D7</span><span className="sh-mint">✓</span></div>
                </div>
              </div>
            </div>

            <div className="sh-grid">
              <div className="sh-orders">
                <div className="sh-orders-h">
                  <span>Recent sales</span>
                  <span className="sh-orders-meta">live · auto-refresh</span>
                </div>
                <div className="sh-orders-row sh-orders-row-head">
                  <span>BILL</span>
                  <span>CUSTOMER</span>
                  <span>ITEMS</span>
                  <span>TOTAL</span>
                </div>
                <div className="sh-orders-row">
                  <span className="sh-orders-id">#7841</span>
                  <span>Sara M.</span>
                  <span>3</span>
                  <span className="sh-orders-amt">₨ 9,855</span>
                </div>
                <div className="sh-orders-row">
                  <span className="sh-orders-id">#7840</span>
                  <span>Walk-in</span>
                  <span>1</span>
                  <span className="sh-orders-amt">₨ 3,200</span>
                </div>
                <div className="sh-orders-row">
                  <span className="sh-orders-id">#7839</span>
                  <span>Bilal A.</span>
                  <span>5</span>
                  <span className="sh-orders-amt">₨ 18,200</span>
                </div>
                <div className="sh-orders-row">
                  <span className="sh-orders-id">#7838</span>
                  <span>Aliya R.</span>
                  <span>2</span>
                  <span className="sh-orders-amt">₨ 5,400</span>
                </div>
              </div>
              <div className="sh-cart">
                <div className="sh-cart-h">Cart · #7842</div>
                <div className="sh-cart-row"><span>Sapphire Kurta · L</span><span>3,200</span></div>
                <div className="sh-cart-row"><span>Khaadi Lawn · M</span><span>4,950</span></div>
                <div className="sh-cart-row"><span>Sana Safinaz Dupatta</span><span>2,200</span></div>
                <div className="sh-cart-rule" />
                <div className="sh-cart-row sh-cart-row-faint"><span>Subtotal</span><span>10,350</span></div>
                <div className="sh-cart-row sh-cart-row-faint"><span>SPRING10</span><span>−1,035</span></div>
                <div className="sh-cart-rule" />
                <div className="sh-cart-row sh-cart-total"><span>Total · PKR</span><span>9,315</span></div>
                <button className="sh-cart-btn" type="button">
                  F9 &nbsp;·&nbsp; Charge ₨ 9,315
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Floating annotation chips */}
      <div className="sh-chip sh-chip-1">
        <div className="sh-chip-dot" />
        <div>
          <div className="sh-chip-title">F-key shortcuts</div>
          <div className="sh-chip-body">Every counter action mapped to F1–F10</div>
        </div>
      </div>
      <div className="sh-chip sh-chip-2">
        <div className="sh-chip-dot sh-chip-dot-mint" />
        <div>
          <div className="sh-chip-title">Live FBR posting</div>
          <div className="sh-chip-body">Real-time IRN, retry queue handles failures</div>
        </div>
      </div>
      <div className="sh-chip sh-chip-3">
        <div className="sh-chip-dot" />
        <div>
          <div className="sh-chip-title">Cart auto-prices</div>
          <div className="sh-chip-body">Customer + outlet price lists evaluated live</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function LandingShowroom() {
  const [year] = useState(() => new Date().getFullYear());
  const fontInjected = useRef(false);

  useEffect(() => {
    if (fontInjected.current) return;
    fontInjected.current = true;
    if (!document.querySelector('link[data-sh-font="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      link.setAttribute("data-sh-font", "1");
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="sh-root">
      <style>{SH_STYLES}</style>

      {/* Background atmosphere */}
      <div className="sh-bg" aria-hidden="true">
        <div className="sh-bg-grad" />
        <div className="sh-bg-grid" />
      </div>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="sh-header">
        <div className="sh-container sh-header-row">
          <Link to="/" className="sh-brand">
            <span className="sh-brand-mark">S</span>
            <span className="sh-brand-name">SanoPOS</span>
            <span className="sh-brand-tag">retail edition</span>
          </Link>
          <nav className="sh-nav">
            <a href="#product">Product</a>
            <a href="#features">Features</a>
            <a href="#plans">Plans</a>
            <a href="#field">Customers</a>
            <Link to="/login" className="sh-nav-cta">
              <span>Sign in</span>
              <span className="sh-nav-cta-arrow">↗</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="sh-hero">
        <div className="sh-container">
          <div className="sh-hero-eyebrow">
            <span className="sh-eyebrow-led" /> &nbsp; Spring · 2026 release
          </div>
          <h1 className="sh-hero-headline">
            The point of sale,<br />
            built <span className="sh-italic">for retail.</span>
          </h1>
          <p className="sh-hero-lede">
            SanoPOS is the back-office and counter system for Pakistani retailers —
            <strong> FBR-ready, offline-tolerant, and free, forever, for your first shop</strong>.
            Sixty-seven reports, accounting in the same window, zero feature locks.
          </p>
          <div className="sh-hero-cta">
            <Link to="/signup" className="sh-cta-primary">
              <span>Open a free shop</span>
              <span className="sh-cta-arrow" aria-hidden="true">→</span>
            </Link>
            <Link to="/login" className="sh-cta-quiet">
              I have a shop · Sign in
            </Link>
          </div>
          <div className="sh-hero-fine">
            Free <span>·</span> 1 outlet · 3 staff · 100 products
            &nbsp; <span className="sh-fine-bullet">·</span> &nbsp;
            Pro <span>·</span> ₨ 8,000 / month / outlet
          </div>
        </div>

        <div className="sh-container sh-hero-product" id="product">
          <ProductMockup />
        </div>
      </section>

      {/* ── Stats strip ────────────────────────────────────────────── */}
      <section className="sh-stats">
        <div className="sh-container">
          <div className="sh-stats-grid">
            {STATS.map((s) => (
              <div className="sh-stat" key={s.label}>
                <div className="sh-stat-num">{s.num}</div>
                <div className="sh-stat-label">{s.label}</div>
                <div className="sh-stat-sub">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Spotlight features ─────────────────────────────────────── */}
      <section className="sh-spots" id="features">
        <div className="sh-container">
          <header className="sh-section-head">
            <div className="sh-section-tag">— Why SanoPOS</div>
            <h2 className="sh-section-title">
              Built for the way retailers <span className="sh-italic">actually</span> run a shop.
            </h2>
            <p className="sh-section-sub">
              Three things SanoPOS treats as table-stakes that the field still
              charges extra for.
            </p>
          </header>

          <div className="sh-spot-list">
            {FEATURES.map((f, i) => (
              <article className={`sh-spot ${i % 2 === 1 ? "sh-spot-flip" : ""}`} key={f.kicker}>
                <div className="sh-spot-copy">
                  <div className="sh-spot-kicker">— {f.kicker}</div>
                  <h3 className="sh-spot-title">{f.title}</h3>
                  <p className="sh-spot-body">{f.body}</p>
                  <ul className="sh-spot-list-bullets">
                    {f.bullets.map((b) => (
                      <li key={b}><span className="sh-spot-tick">→</span>{b}</li>
                    ))}
                  </ul>
                </div>
                <div className="sh-spot-art">
                  <SpotArt index={i} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Amenities (everything-in-one-window grid) ──────────────── */}
      <section className="sh-amen">
        <div className="sh-container">
          <header className="sh-section-head">
            <div className="sh-section-tag">— Everything in one window</div>
            <h2 className="sh-section-title">
              No add-ons. <span className="sh-italic">No enterprise tier.</span>
            </h2>
            <p className="sh-section-sub">
              Every line below is included on every plan — Free or Pro, same software.
            </p>
          </header>
          <div className="sh-amen-grid">
            {AMENITIES.map(([t, b], i) => (
              <article className="sh-amen-card" key={t}>
                <div className="sh-amen-num">{String(i + 1).padStart(2, "0")}</div>
                <h4 className="sh-amen-title">{t}</h4>
                <p className="sh-amen-body">{b}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────── */}
      <section className="sh-plans" id="plans">
        <div className="sh-container">
          <header className="sh-section-head">
            <div className="sh-section-tag">— Plans</div>
            <h2 className="sh-section-title">
              Start free. <span className="sh-italic">Stay free.</span>
            </h2>
            <p className="sh-section-sub">
              Pro is paid per outlet, monthly. Add additional outlets one at a time.
            </p>
          </header>
          <div className="sh-plans-grid">
            <article className="sh-plan">
              <div className="sh-plan-head">
                <h3 className="sh-plan-name">Free</h3>
                <div className="sh-plan-tag">— for shops finding their feet</div>
              </div>
              <div className="sh-plan-price">
                <span className="sh-plan-cur">₨</span>
                <span className="sh-plan-num">0</span>
                <span className="sh-plan-cad">forever<br />not a trial</span>
              </div>
              <ul className="sh-plan-list">
                <li><span>→</span>One outlet</li>
                <li><span>→</span>Up to three staff</li>
                <li><span>→</span>Up to one hundred products</li>
                <li><span>→</span>Every retail feature, no locks</li>
                <li><span>→</span>FBR digital invoicing</li>
                <li><span>→</span>Offline sale queue</li>
                <li><span>→</span>Community support</li>
              </ul>
              <Link to="/signup" className="sh-plan-cta sh-plan-cta-quiet">
                Open free shop
                <span aria-hidden="true">→</span>
              </Link>
            </article>

            <article className="sh-plan sh-plan-feature">
              <div className="sh-plan-ribbon">— for shops with scale</div>
              <div className="sh-plan-head">
                <h3 className="sh-plan-name">Pro</h3>
                <div className="sh-plan-tag">— when you've outgrown Free</div>
              </div>
              <div className="sh-plan-price">
                <span className="sh-plan-cur">₨</span>
                <span className="sh-plan-num sh-plan-num-feature">8,000</span>
                <span className="sh-plan-cad">per month<br />per outlet</span>
              </div>
              <ul className="sh-plan-list">
                <li><span>→</span>Unlimited staff</li>
                <li><span>→</span>Unlimited products</li>
                <li><span>→</span>Multi-outlet + stock transfers</li>
                <li><span>→</span>Context-aware pricing</li>
                <li><span>→</span>AI insights panel</li>
                <li><span>→</span>Email + WhatsApp support</li>
                <li><span>→</span>Cancel from the dashboard</li>
              </ul>
              <Link to="/signup" className="sh-plan-cta">
                Begin on Free, upgrade later
                <span aria-hidden="true">→</span>
              </Link>
              <p className="sh-plan-foot">
                Add additional outlets one at a time, from <em>/billing</em>.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ── Testimonial ────────────────────────────────────────────── */}
      <section className="sh-quote" id="field">
        <div className="sh-container">
          <div className="sh-quote-tag">— Field report</div>
          <blockquote className="sh-quote-text">
            <span className="sh-quote-mark">"</span>
            We had been paying a Karachi vendor by the feature.
            SanoPOS gave us FBR, multi-outlet, and the books{" "}
            <span className="sh-italic">on the first day</span>.
            Closing used to take a Saturday. It now takes an hour.
          </blockquote>
          <div className="sh-quote-attr">
            <strong>Bilal A.</strong>
            <span>·</span>
            <span>three-outlet apparel chain</span>
            <span>·</span>
            <span>Lahore</span>
          </div>
        </div>
      </section>

      {/* ── Coming soon ────────────────────────────────────────────── */}
      <section className="sh-soon">
        <div className="sh-container">
          <header className="sh-section-head">
            <div className="sh-section-tag">— Roadmap</div>
            <h2 className="sh-section-title">
              Retail today. <span className="sh-italic">More this year.</span>
            </h2>
            <p className="sh-section-sub">
              Public launch is for retail. Other presets are already built and
              opening in waves through the year.
            </p>
          </header>
          <div className="sh-soon-grid">
            {COMING_SOON.map((it) => (
              <div className="sh-soon-card" key={it}>
                <span className="sh-soon-name">{it}</span>
                <span className="sh-soon-tag">in preview</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── End CTA ────────────────────────────────────────────────── */}
      <section className="sh-end">
        <div className="sh-container sh-end-inner">
          <h2 className="sh-end-title">
            Open a <span className="sh-italic">free</span> shop.
          </h2>
          <p className="sh-end-sub">
            Five minutes. Email to verify. Selling tonight.
          </p>
          <div className="sh-hero-cta sh-end-cta">
            <Link to="/signup" className="sh-cta-primary sh-cta-large">
              <span>Begin</span>
              <span className="sh-cta-arrow" aria-hidden="true">→</span>
            </Link>
            <Link to="/login" className="sh-cta-quiet">
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="sh-foot">
        <div className="sh-container">
          <div className="sh-foot-grid">
            <div className="sh-foot-brand">
              <div className="sh-foot-mark">S</div>
              <div className="sh-foot-brand-name">SanoPOS</div>
              <p>The point of sale built for Pakistani retail. Composed in Lahore.</p>
            </div>
            <div>
              <div className="sh-foot-h">Product</div>
              <ul>
                <li><a href="#features">Features</a></li>
                <li><a href="#plans">Plans</a></li>
                <li><a href="#field">Customers</a></li>
                <li><Link to="/signup">Open account</Link></li>
              </ul>
            </div>
            <div>
              <div className="sh-foot-h">Company</div>
              <ul>
                <li><Link to="/login">Sign in</Link></li>
                <li><Link to="/terms">Terms</Link></li>
                <li><Link to="/privacy">Privacy</Link></li>
                <li>hello@sanopos.com</li>
              </ul>
            </div>
            <div>
              <div className="sh-foot-h">Edition</div>
              <p>Spring 2026 · v0.1<br />© {year} Sano Merchandise<br />All rights reserved.</p>
            </div>
          </div>
          <div className="sh-foot-tail">
            <span>SanoPOS</span>
            <span>·</span>
            <span>Composed in Lahore</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Spotlight art ─────────────────────────────────────────────────────── */

function SpotArt({ index }) {
  if (index === 0) {
    return (
      <div className="sh-art sh-art-counter">
        <div className="sh-art-keys">
          {[
            { k: "F1", l: "Help" },
            { k: "F2", l: "Discount" },
            { k: "F3", l: "Park" },
            { k: "F4", l: "Customer" },
            { k: "F5", l: "Recall" },
            { k: "F8", l: "Remove" },
            { k: "F9", l: "Checkout", hot: true },
            { k: "F10", l: "Clear" },
          ].map((row) => (
            <div className={`sh-art-key ${row.hot ? "sh-art-key-hot" : ""}`} key={row.k}>
              <span className="sh-art-key-k">{row.k}</span>
              <span className="sh-art-key-l">{row.l}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="sh-art sh-art-fbr">
        <div className="sh-art-fbr-head">
          <span className="sh-art-fbr-led" />
          <span>FBR · digital invoicing</span>
          <span className="sh-art-fbr-200">200 OK</span>
        </div>
        <div className="sh-art-fbr-rule" />
        <div className="sh-art-fbr-row"><span>IRN 7000007D9</span><span className="sh-mint">posted</span></div>
        <div className="sh-art-fbr-row"><span>IRN 7000007D8</span><span className="sh-mint">posted</span></div>
        <div className="sh-art-fbr-row"><span>IRN 7000007D7</span><span className="sh-amber">retry · 1/5</span></div>
        <div className="sh-art-fbr-row"><span>IRN 7000007D6</span><span className="sh-mint">posted</span></div>
        <div className="sh-art-fbr-row"><span>IRN 7000007D5</span><span className="sh-mint">posted</span></div>
        <div className="sh-art-fbr-rule" />
        <div className="sh-art-fbr-foot">queue depth · 1 &nbsp; · &nbsp; success · 99.7%</div>
      </div>
    );
  }
  return (
    <div className="sh-art sh-art-books">
      <div className="sh-art-books-tabs">
        <span className="sh-art-tab sh-art-tab-active">P&L</span>
        <span className="sh-art-tab">Balance</span>
        <span className="sh-art-tab">Cash flow</span>
        <span className="sh-art-tab">Journal</span>
      </div>
      <div className="sh-art-books-grid">
        <div className="sh-art-books-row sh-art-books-h"><span>Account</span><span>Mar</span><span>Apr</span></div>
        <div className="sh-art-books-row"><span>Revenue</span><span>2,418,000</span><span className="sh-amber">2,840,200</span></div>
        <div className="sh-art-books-row"><span>COGS</span><span>(1,210,000)</span><span>(1,392,800)</span></div>
        <div className="sh-art-books-row sh-art-books-rule"><span>Gross profit</span><span>1,208,000</span><span>1,447,400</span></div>
        <div className="sh-art-books-row"><span>Operating</span><span>(680,000)</span><span>(712,500)</span></div>
        <div className="sh-art-books-row sh-art-books-bold"><span>Net income</span><span>528,000</span><span className="sh-mint">734,900</span></div>
      </div>
    </div>
  );
}

/* ─── Stylesheet ─────────────────────────────────────────────────────────── */

const SH_STYLES = `
.sh-root {
  --sh-bg: #08090C;
  --sh-bg-2: #0E1014;
  --sh-card: #15161B;
  --sh-card-2: #1B1D24;
  --sh-border: #26272D;
  --sh-border-2: #34363D;
  --sh-text: #F2F2F4;
  --sh-text-2: #B8BAC0;
  --sh-text-3: #7A7C84;
  --sh-text-4: #5A5C64;
  --sh-amber: #F5A623;
  --sh-amber-2: #FBA94C;
  --sh-amber-soft: rgba(245,166,35,0.12);
  --sh-mint: #62E3A1;
  --sh-rose: #F4A6CD;

  --sans: "Inter Tight", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --serif: "Instrument Serif", Georgia, "Times New Roman", serif;
  --mono: "Geist Mono", "JetBrains Mono", "SF Mono", Menlo, monospace;

  background: var(--sh-bg);
  color: var(--sh-text);
  font-family: var(--sans);
  font-feature-settings: "ss03", "cv11";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
  overflow-x: hidden;
  font-weight: 400;
  letter-spacing: -0.005em;
}

.sh-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.sh-bg-grad {
  position: absolute;
  inset: -10%;
  background:
    radial-gradient(ellipse 60% 40% at 50% 0%, rgba(245,166,35,0.10) 0%, transparent 60%),
    radial-gradient(ellipse 80% 50% at 100% 0%, rgba(98,227,161,0.06) 0%, transparent 50%);
}
.sh-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, black 30%, transparent 90%);
  -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, black 30%, transparent 90%);
}

.sh-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 28px;
  position: relative;
  z-index: 2;
}
@media (max-width: 720px) { .sh-container { padding: 0 18px; } }

.sh-italic {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 400;
  color: var(--sh-amber);
  letter-spacing: 0.005em;
}
.sh-mint { color: var(--sh-mint); }
.sh-amber { color: var(--sh-amber); }

/* ── Header ────────────────────────────────────────────────────────── */
.sh-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(8,9,12,0.72);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border-bottom: 1px solid var(--sh-border);
}
.sh-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  gap: 24px;
}
.sh-brand { display: inline-flex; align-items: baseline; gap: 10px; text-decoration: none; color: var(--sh-text); }
.sh-brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--sh-amber), var(--sh-amber-2));
  color: var(--sh-bg);
  font-weight: 700;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(245,166,35,0.30);
  font-family: var(--sans);
  align-self: center;
}
.sh-brand-name {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 17px;
  letter-spacing: -0.015em;
}
.sh-brand-tag {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--sh-text-3);
  letter-spacing: 0.04em;
}
.sh-nav { display: flex; align-items: center; gap: 24px; }
.sh-nav a {
  font-family: var(--sans);
  font-weight: 500;
  font-size: 14px;
  color: var(--sh-text-2);
  text-decoration: none;
  transition: color 0.15s;
  letter-spacing: -0.005em;
}
.sh-nav a:hover { color: var(--sh-text); }
.sh-nav-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--sh-text) !important;
  color: var(--sh-bg) !important;
  padding: 8px 14px;
  border-radius: 8px;
  font-weight: 600 !important;
  font-size: 13.5px !important;
  transition: all 0.18s;
}
.sh-nav-cta:hover {
  background: var(--sh-amber) !important;
  color: var(--sh-bg) !important;
}
.sh-nav-cta-arrow { transition: transform 0.18s; }
.sh-nav-cta:hover .sh-nav-cta-arrow { transform: translate(2px, -2px); }
@media (max-width: 720px) {
  .sh-nav { gap: 14px; }
  .sh-nav a:not(.sh-nav-cta) { display: none; }
  .sh-brand-tag { display: none; }
}

/* ── Hero ──────────────────────────────────────────────────────────── */
.sh-hero { padding: 96px 0 48px; text-align: center; }
.sh-hero-eyebrow {
  display: inline-flex;
  align-items: center;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--sh-text-2);
  background: rgba(245,166,35,0.06);
  border: 1px solid rgba(245,166,35,0.20);
  padding: 6px 14px;
  border-radius: 999px;
  margin-bottom: 32px;
  font-weight: 500;
}
.sh-eyebrow-led {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sh-amber);
  box-shadow: 0 0 8px var(--sh-amber);
  animation: sh-pulse 2s ease-in-out infinite;
}
@keyframes sh-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.sh-hero-headline {
  font-family: var(--sans);
  font-weight: 600;
  font-size: clamp(46px, 7.2vw, 96px);
  letter-spacing: -0.04em;
  line-height: 1.02;
  margin: 0 0 28px;
  color: var(--sh-text);
}
.sh-hero-headline .sh-italic {
  font-size: 1.04em;
  letter-spacing: -0.015em;
}

.sh-hero-lede {
  font-family: var(--sans);
  font-size: clamp(17px, 1.5vw, 20px);
  line-height: 1.55;
  color: var(--sh-text-2);
  max-width: 640px;
  margin: 0 auto 40px;
  font-weight: 400;
  letter-spacing: -0.005em;
}
.sh-hero-lede strong {
  color: var(--sh-text);
  font-weight: 500;
}

.sh-hero-cta {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 28px;
}

.sh-cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 15px;
  color: var(--sh-bg);
  background: var(--sh-text);
  padding: 13px 22px;
  border-radius: 10px;
  text-decoration: none;
  transition: all 0.18s;
  letter-spacing: -0.005em;
  box-shadow: 0 1px 0 rgba(255,255,255,0.10) inset, 0 8px 24px rgba(0,0,0,0.40);
}
.sh-cta-primary:hover {
  background: var(--sh-amber);
  transform: translateY(-1px);
  box-shadow: 0 1px 0 rgba(255,255,255,0.20) inset, 0 12px 32px rgba(245,166,35,0.40);
}
.sh-cta-large { padding: 16px 28px; font-size: 16px; }
.sh-cta-arrow { transition: transform 0.18s; }
.sh-cta-primary:hover .sh-cta-arrow { transform: translateX(3px); }

.sh-cta-quiet {
  font-family: var(--sans);
  font-weight: 500;
  font-size: 14.5px;
  color: var(--sh-text-2);
  text-decoration: none;
  padding: 13px 16px;
  border-radius: 10px;
  transition: all 0.18s;
  letter-spacing: -0.005em;
}
.sh-cta-quiet:hover { color: var(--sh-text); background: rgba(255,255,255,0.04); }

.sh-hero-fine {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--sh-text-3);
  letter-spacing: 0.02em;
  font-weight: 500;
}
.sh-hero-fine span:not(.sh-fine-bullet) { color: var(--sh-text); }
.sh-fine-bullet { color: var(--sh-amber); }

/* ── Product mockup ────────────────────────────────────────────────── */
.sh-hero-product { margin-top: 64px; perspective: 2000px; position: relative; }
.sh-product { position: relative; max-width: 1180px; margin: 0 auto; }
.sh-product-glow {
  position: absolute;
  inset: -60px -10% -40px -10%;
  background:
    radial-gradient(ellipse 60% 50% at 50% 50%, rgba(245,166,35,0.18) 0%, transparent 60%),
    radial-gradient(ellipse 40% 40% at 30% 80%, rgba(98,227,161,0.10) 0%, transparent 60%);
  filter: blur(20px);
  pointer-events: none;
  z-index: 0;
}
.sh-product-frame {
  position: relative;
  z-index: 1;
  background: var(--sh-card);
  border: 1px solid var(--sh-border);
  border-radius: 14px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.04) inset,
    0 30px 80px rgba(0,0,0,0.50),
    0 8px 24px rgba(0,0,0,0.30);
  transform: rotateX(2deg);
  transform-origin: center top;
}
@media (max-width: 720px) { .sh-product-frame { transform: none; } }

.sh-product-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--sh-bg-2);
  border-bottom: 1px solid var(--sh-border);
  gap: 16px;
}
.sh-product-dots { display: flex; gap: 6px; }
.sh-dot {
  width: 11px; height: 11px;
  border-radius: 50%;
}
.sh-dot-r { background: #FF5F57; }
.sh-dot-y { background: #FEBC2E; }
.sh-dot-g { background: #28C840; }
.sh-product-url {
  flex: 1;
  background: var(--sh-card-2);
  color: var(--sh-text-2);
  font-family: var(--mono);
  font-size: 12px;
  padding: 5px 14px;
  border-radius: 6px;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--sh-border);
}
.sh-product-url-lock { color: var(--sh-mint); }
.sh-product-bar-right { font-family: var(--mono); font-size: 11.5px; color: var(--sh-text-3); }
.sh-product-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--sh-text-2);
  background: rgba(98,227,161,0.08);
  border: 1px solid rgba(98,227,161,0.20);
  padding: 3px 10px;
  border-radius: 999px;
}
.sh-product-led {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--sh-mint);
  box-shadow: 0 0 6px var(--sh-mint);
  animation: sh-pulse 1.4s ease-in-out infinite;
}

.sh-product-body {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 480px;
}
@media (max-width: 880px) {
  .sh-product-body { grid-template-columns: 1fr; }
  .sh-side { display: none; }
}

.sh-side {
  background: var(--sh-bg-2);
  border-right: 1px solid var(--sh-border);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
}
.sh-side-brand { display: flex; align-items: center; gap: 10px; padding: 0 4px 18px; border-bottom: 1px solid var(--sh-border); }
.sh-side-mark {
  width: 28px; height: 28px;
  border-radius: 7px;
  background: linear-gradient(135deg, var(--sh-amber), var(--sh-amber-2));
  color: var(--sh-bg);
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sh-side-shop { font-family: var(--sans); font-weight: 600; font-size: 13.5px; color: var(--sh-text); letter-spacing: -0.005em; }
.sh-side-meta { font-family: var(--mono); font-size: 10.5px; color: var(--sh-text-3); margin-top: 2px; }
.sh-side-nav { padding: 14px 0; flex: 1; }
.sh-side-section {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--sh-text-4);
  padding: 10px 8px 6px;
  text-transform: uppercase;
  font-weight: 600;
}
.sh-side-item {
  display: block;
  font-family: var(--sans);
  font-size: 13px;
  color: var(--sh-text-2);
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
  letter-spacing: -0.005em;
}
.sh-side-item:hover { background: var(--sh-card-2); color: var(--sh-text); }
.sh-side-active {
  background: rgba(245,166,35,0.10);
  color: var(--sh-amber) !important;
  box-shadow: inset 2px 0 0 var(--sh-amber);
}
.sh-side-foot { padding: 10px 0 0; border-top: 1px solid var(--sh-border); }
.sh-side-shift {
  background: var(--sh-card);
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--sh-border);
}
.sh-side-shift-label { font-family: var(--mono); font-size: 10px; color: var(--sh-text-3); letter-spacing: 0.06em; }
.sh-side-shift-time { font-family: var(--mono); font-weight: 600; font-size: 13px; color: var(--sh-mint); margin-top: 2px; }

.sh-main { padding: 20px 22px; }
.sh-main-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.sh-main-h {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 17px;
  color: var(--sh-text);
  letter-spacing: -0.015em;
}
.sh-main-keys {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--sh-text-3);
}
.sh-key {
  background: var(--sh-card-2);
  color: var(--sh-text);
  padding: 3px 7px;
  border-radius: 4px;
  border: 1px solid var(--sh-border);
  font-weight: 600;
}
.sh-key-label { margin-right: 8px; }
@media (max-width: 720px) { .sh-main-keys { display: none; } }

.sh-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
@media (max-width: 720px) { .sh-cards { grid-template-columns: 1fr; } }
.sh-tile {
  background: var(--sh-bg-2);
  border: 1px solid var(--sh-border);
  border-radius: 10px;
  padding: 14px;
  position: relative;
  overflow: hidden;
}
.sh-tile-label { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.08em; color: var(--sh-text-3); text-transform: uppercase; font-weight: 600; }
.sh-tile-num {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 22px;
  color: var(--sh-text);
  margin: 6px 0 4px;
  letter-spacing: -0.02em;
}
.sh-tile-num-mint { color: var(--sh-mint); }
.sh-tile-meta {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--sh-amber);
  font-weight: 600;
}
.sh-tile-meta span { color: var(--sh-text-3); margin-left: 6px; font-weight: 400; }
.sh-spark { position: absolute; right: 0; bottom: 0; width: 60%; height: 28px; opacity: 0.85; }
.sh-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  margin-top: 8px;
  height: 28px;
}
.sh-bars span {
  flex: 1;
  background: var(--sh-amber);
  opacity: 0.8;
  border-radius: 2px 2px 0 0;
  min-height: 4px;
}
.sh-rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
}
.sh-rows-r {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--sh-text-3);
}

.sh-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 12px;
}
@media (max-width: 720px) { .sh-grid { grid-template-columns: 1fr; } }

.sh-orders {
  background: var(--sh-bg-2);
  border: 1px solid var(--sh-border);
  border-radius: 10px;
  overflow: hidden;
}
.sh-orders-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--sh-border);
  font-family: var(--sans);
  font-weight: 600;
  font-size: 13.5px;
  color: var(--sh-text);
  letter-spacing: -0.01em;
}
.sh-orders-meta { font-family: var(--mono); font-size: 10.5px; color: var(--sh-text-3); font-weight: 500; letter-spacing: 0.04em; }
.sh-orders-row {
  display: grid;
  grid-template-columns: 80px 1fr 60px 100px;
  gap: 8px;
  padding: 9px 14px;
  font-family: var(--sans);
  font-size: 13px;
  color: var(--sh-text-2);
  border-bottom: 1px solid var(--sh-border);
  align-items: baseline;
  letter-spacing: -0.005em;
}
.sh-orders-row:last-child { border-bottom: none; }
.sh-orders-row-head {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--sh-text-3);
  text-transform: uppercase;
  font-weight: 600;
}
.sh-orders-id { font-family: var(--mono); color: var(--sh-text-3); font-size: 12px; font-weight: 500; }
.sh-orders-amt { color: var(--sh-text); font-family: var(--mono); font-weight: 500; text-align: right; }

.sh-cart {
  background: var(--sh-bg-2);
  border: 1px solid var(--sh-border);
  border-radius: 10px;
  padding: 14px;
}
.sh-cart-h {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 13.5px;
  color: var(--sh-text);
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--sh-border);
  letter-spacing: -0.01em;
}
.sh-cart-row {
  display: flex;
  justify-content: space-between;
  font-family: var(--sans);
  font-size: 12.5px;
  color: var(--sh-text-2);
  padding: 4px 0;
  letter-spacing: -0.005em;
}
.sh-cart-row span:last-child { font-family: var(--mono); color: var(--sh-text); font-weight: 500; }
.sh-cart-row-faint { color: var(--sh-text-3); }
.sh-cart-row-faint span:last-child { color: var(--sh-text-3); }
.sh-cart-rule { height: 1px; background: var(--sh-border); margin: 8px 0; }
.sh-cart-total {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 14.5px;
  color: var(--sh-text);
}
.sh-cart-total span:last-child { color: var(--sh-amber); font-size: 17px; }
.sh-cart-btn {
  width: 100%;
  margin-top: 12px;
  padding: 11px;
  background: var(--sh-amber);
  color: var(--sh-bg);
  border: none;
  border-radius: 8px;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 13.5px;
  cursor: pointer;
  letter-spacing: -0.005em;
  box-shadow: 0 4px 14px rgba(245,166,35,0.30);
}

/* Floating annotation chips */
.sh-chip {
  position: absolute;
  background: var(--sh-card);
  border: 1px solid var(--sh-border-2);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  z-index: 3;
  max-width: 240px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.40);
  animation: sh-bob 6s ease-in-out infinite;
}
.sh-chip-1 { top: 12%; left: -3%; animation-delay: 0s; }
.sh-chip-2 { top: 48%; right: -4%; animation-delay: -2s; }
.sh-chip-3 { bottom: 8%; left: -4%; animation-delay: -4s; }
@media (max-width: 980px) { .sh-chip { display: none; } }
@keyframes sh-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
.sh-chip-dot {
  width: 9px; height: 9px;
  border-radius: 50%;
  background: var(--sh-amber);
  box-shadow: 0 0 8px var(--sh-amber);
  margin-top: 5px;
  flex-shrink: 0;
}
.sh-chip-dot-mint { background: var(--sh-mint); box-shadow: 0 0 8px var(--sh-mint); }
.sh-chip-title {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 13px;
  color: var(--sh-text);
  letter-spacing: -0.01em;
}
.sh-chip-body {
  font-family: var(--sans);
  font-size: 12px;
  color: var(--sh-text-3);
  margin-top: 2px;
  line-height: 1.45;
}

/* ── Stats ─────────────────────────────────────────────────────────── */
.sh-stats { padding: 96px 0 80px; }
.sh-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border-top: 1px solid var(--sh-border);
  border-bottom: 1px solid var(--sh-border);
}
@media (max-width: 720px) { .sh-stats-grid { grid-template-columns: repeat(2, 1fr); } }
.sh-stat {
  padding: 32px 28px;
  border-right: 1px solid var(--sh-border);
}
.sh-stat:last-child { border-right: none; }
@media (max-width: 720px) {
  .sh-stat { border-right: 1px solid var(--sh-border); border-bottom: 1px solid var(--sh-border); }
  .sh-stat:nth-child(2n) { border-right: none; }
  .sh-stat:nth-last-child(-n+2) { border-bottom: none; }
}
.sh-stat-num {
  font-family: var(--sans);
  font-weight: 600;
  font-size: clamp(40px, 4.6vw, 56px);
  letter-spacing: -0.035em;
  line-height: 1;
  color: var(--sh-text);
  margin-bottom: 14px;
}
.sh-stat-label {
  font-family: var(--sans);
  font-size: 14px;
  color: var(--sh-text);
  font-weight: 500;
  margin-bottom: 4px;
  letter-spacing: -0.01em;
}
.sh-stat-sub {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--sh-text-3);
  letter-spacing: 0.02em;
}

/* ── Section heads ─────────────────────────────────────────────────── */
.sh-section-head { text-align: center; margin-bottom: 64px; max-width: 720px; margin-left: auto; margin-right: auto; }
.sh-section-tag {
  display: inline-block;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--sh-amber);
  margin-bottom: 14px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.sh-section-title {
  font-family: var(--sans);
  font-weight: 600;
  font-size: clamp(32px, 4.4vw, 56px);
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: var(--sh-text);
  margin: 0 0 16px;
}
.sh-section-sub {
  font-family: var(--sans);
  font-size: clamp(15.5px, 1.3vw, 18px);
  color: var(--sh-text-2);
  margin: 0;
  line-height: 1.55;
  letter-spacing: -0.005em;
}

/* ── Spotlights ────────────────────────────────────────────────────── */
.sh-spots { padding: 96px 0; }
.sh-spot-list { display: flex; flex-direction: column; gap: 96px; }
.sh-spot {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 64px;
  align-items: center;
}
.sh-spot-flip { grid-template-columns: 1.1fr 1fr; }
.sh-spot-flip .sh-spot-copy { order: 2; }
@media (max-width: 880px) {
  .sh-spot, .sh-spot-flip { grid-template-columns: 1fr; gap: 36px; }
  .sh-spot-flip .sh-spot-copy { order: unset; }
}
.sh-spot-kicker {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--sh-amber);
  letter-spacing: 0.02em;
  margin-bottom: 14px;
}
.sh-spot-title {
  font-family: var(--sans);
  font-weight: 600;
  font-size: clamp(28px, 3.2vw, 40px);
  letter-spacing: -0.025em;
  line-height: 1.12;
  color: var(--sh-text);
  margin: 0 0 18px;
}
.sh-spot-body {
  font-family: var(--sans);
  font-size: 16.5px;
  line-height: 1.6;
  color: var(--sh-text-2);
  margin: 0 0 24px;
  letter-spacing: -0.005em;
}
.sh-spot-list-bullets {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 22px;
}
@media (max-width: 540px) { .sh-spot-list-bullets { grid-template-columns: 1fr; } }
.sh-spot-list-bullets li {
  font-family: var(--sans);
  font-size: 14.5px;
  color: var(--sh-text);
  display: flex;
  gap: 10px;
  align-items: baseline;
  letter-spacing: -0.005em;
}
.sh-spot-tick {
  color: var(--sh-amber);
  font-weight: 500;
  font-family: var(--mono);
}

.sh-spot-art { display: flex; align-items: center; justify-content: center; }
.sh-art {
  background: var(--sh-card);
  border: 1px solid var(--sh-border);
  border-radius: 14px;
  padding: 22px;
  width: 100%;
  max-width: 460px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.40);
  position: relative;
  overflow: hidden;
}
.sh-art::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at top right, rgba(245,166,35,0.05), transparent 60%);
  pointer-events: none;
}
.sh-art-keys {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  position: relative;
}
.sh-art-key {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--sh-bg-2);
  border: 1px solid var(--sh-border);
  border-radius: 8px;
}
.sh-art-key-hot {
  background: rgba(245,166,35,0.12);
  border-color: rgba(245,166,35,0.30);
}
.sh-art-key-k {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--sh-text);
  background: var(--sh-card-2);
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--sh-border);
}
.sh-art-key-hot .sh-art-key-k { color: var(--sh-amber); border-color: rgba(245,166,35,0.30); }
.sh-art-key-l {
  font-family: var(--sans);
  font-size: 13px;
  color: var(--sh-text-2);
  letter-spacing: -0.005em;
}
.sh-art-key-hot .sh-art-key-l { color: var(--sh-text); font-weight: 500; }

.sh-art-fbr-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 14px;
  color: var(--sh-text);
  margin-bottom: 14px;
  letter-spacing: -0.01em;
}
.sh-art-fbr-led {
  width: 8px; height: 8px;
  background: var(--sh-mint);
  border-radius: 50%;
  box-shadow: 0 0 6px var(--sh-mint);
}
.sh-art-fbr-200 {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 11px;
  background: rgba(98,227,161,0.12);
  border: 1px solid rgba(98,227,161,0.25);
  color: var(--sh-mint);
  padding: 3px 8px;
  border-radius: 999px;
}
.sh-art-fbr-rule { height: 1px; background: var(--sh-border); margin: 12px 0; }
.sh-art-fbr-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--sh-text-2);
  padding: 5px 0;
}
.sh-art-fbr-foot {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--sh-text-3);
  margin-top: 10px;
}

.sh-art-books-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--sh-border);
  margin-bottom: 14px;
}
.sh-art-tab {
  font-family: var(--sans);
  font-size: 12.5px;
  color: var(--sh-text-3);
  padding: 8px 12px;
  letter-spacing: -0.005em;
}
.sh-art-tab-active {
  color: var(--sh-amber);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--sh-amber);
}
.sh-art-books-grid { display: flex; flex-direction: column; gap: 4px; }
.sh-art-books-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: 10px;
  padding: 8px 0;
  font-family: var(--sans);
  font-size: 12.5px;
  color: var(--sh-text-2);
  letter-spacing: -0.005em;
}
.sh-art-books-row span:not(:first-child) { font-family: var(--mono); text-align: right; color: var(--sh-text); }
.sh-art-books-h {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--sh-text-3);
  text-transform: uppercase;
  font-weight: 600;
}
.sh-art-books-h span:not(:first-child) { font-family: var(--mono); color: var(--sh-text-3); font-size: 10.5px; }
.sh-art-books-rule { border-top: 1px solid var(--sh-border); padding-top: 12px; margin-top: 4px; }
.sh-art-books-bold { font-weight: 600; font-size: 13.5px; color: var(--sh-text); padding-top: 6px; border-top: 1px solid var(--sh-border); margin-top: 4px; }

/* ── Amenities grid ────────────────────────────────────────────────── */
.sh-amen { padding: 96px 0; background: rgba(255,255,255,0.012); border-top: 1px solid var(--sh-border); border-bottom: 1px solid var(--sh-border); }
.sh-amen-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border-top: 1px solid var(--sh-border);
  border-left: 1px solid var(--sh-border);
}
@media (max-width: 980px) { .sh-amen-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .sh-amen-grid { grid-template-columns: 1fr; } }
.sh-amen-card {
  padding: 28px 26px;
  border-right: 1px solid var(--sh-border);
  border-bottom: 1px solid var(--sh-border);
  transition: background 0.18s;
}
.sh-amen-card:hover { background: rgba(245,166,35,0.04); }
.sh-amen-num {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--sh-amber);
  letter-spacing: 0.06em;
  margin-bottom: 12px;
  font-weight: 600;
}
.sh-amen-title {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 17px;
  letter-spacing: -0.015em;
  margin: 0 0 8px;
  color: var(--sh-text);
}
.sh-amen-body {
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.55;
  color: var(--sh-text-2);
  margin: 0;
  letter-spacing: -0.005em;
}

/* ── Plans ─────────────────────────────────────────────────────────── */
.sh-plans { padding: 96px 0; }
.sh-plans-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
@media (max-width: 880px) { .sh-plans-grid { grid-template-columns: 1fr; } }
.sh-plan {
  background: var(--sh-card);
  border: 1px solid var(--sh-border);
  border-radius: 16px;
  padding: 32px 28px;
  position: relative;
  display: flex;
  flex-direction: column;
}
.sh-plan-feature {
  background: linear-gradient(180deg, var(--sh-card) 0%, var(--sh-bg-2) 100%);
  border-color: rgba(245,166,35,0.30);
  box-shadow: 0 0 0 1px rgba(245,166,35,0.10), 0 24px 60px rgba(245,166,35,0.10);
}
.sh-plan-ribbon {
  position: absolute;
  top: 16px;
  right: 20px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--sh-amber);
  letter-spacing: 0.04em;
  font-weight: 600;
}
.sh-plan-head { margin-bottom: 22px; }
.sh-plan-name {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 28px;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
  color: var(--sh-text);
}
.sh-plan-tag {
  font-family: var(--sans);
  font-size: 14px;
  color: var(--sh-text-3);
  letter-spacing: -0.005em;
}
.sh-plan-price {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 18px 0;
  border-top: 1px solid var(--sh-border);
  border-bottom: 1px solid var(--sh-border);
  margin-bottom: 22px;
}
.sh-plan-cur { font-family: var(--sans); font-size: 22px; color: var(--sh-text-3); font-weight: 500; }
.sh-plan-num {
  font-family: var(--sans);
  font-weight: 600;
  font-size: clamp(48px, 6vw, 64px);
  letter-spacing: -0.04em;
  color: var(--sh-text);
  line-height: 1;
}
.sh-plan-num-feature { color: var(--sh-amber); }
.sh-plan-cad {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--sh-text-3);
  margin-left: auto;
  text-align: right;
  letter-spacing: 0.04em;
  line-height: 1.5;
}
.sh-plan-list {
  list-style: none;
  padding: 0;
  margin: 0 0 24px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sh-plan-list li {
  font-family: var(--sans);
  font-size: 14.5px;
  color: var(--sh-text);
  display: flex;
  gap: 10px;
  align-items: baseline;
  letter-spacing: -0.005em;
}
.sh-plan-list li span {
  color: var(--sh-amber);
  font-family: var(--mono);
  font-weight: 500;
}
.sh-plan-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 14.5px;
  padding: 13px 18px;
  border-radius: 10px;
  text-decoration: none;
  transition: all 0.18s;
  letter-spacing: -0.005em;
}
.sh-plan-feature .sh-plan-cta {
  background: var(--sh-amber);
  color: var(--sh-bg);
  box-shadow: 0 8px 24px rgba(245,166,35,0.30);
}
.sh-plan-feature .sh-plan-cta:hover {
  background: var(--sh-amber-2);
  transform: translateY(-1px);
  box-shadow: 0 12px 32px rgba(245,166,35,0.45);
}
.sh-plan-cta-quiet {
  background: rgba(255,255,255,0.06);
  color: var(--sh-text);
  border: 1px solid var(--sh-border-2);
}
.sh-plan-cta-quiet:hover {
  background: rgba(255,255,255,0.10);
}
.sh-plan-foot {
  font-family: var(--sans);
  font-size: 13px;
  color: var(--sh-text-3);
  text-align: center;
  margin: 14px 0 0;
  letter-spacing: -0.005em;
}
.sh-plan-foot em { color: var(--sh-amber); font-style: italic; font-family: var(--serif); font-size: 14px; }

/* ── Quote ─────────────────────────────────────────────────────────── */
.sh-quote {
  padding: 120px 0;
  text-align: center;
  background:
    radial-gradient(ellipse 60% 50% at 50% 50%, rgba(245,166,35,0.06) 0%, transparent 60%);
  border-top: 1px solid var(--sh-border);
  border-bottom: 1px solid var(--sh-border);
}
.sh-quote-tag {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--sh-amber);
  margin-bottom: 22px;
  letter-spacing: 0.04em;
}
.sh-quote-text {
  font-family: var(--sans);
  font-weight: 500;
  font-size: clamp(22px, 2.6vw, 32px);
  line-height: 1.4;
  color: var(--sh-text);
  max-width: 880px;
  margin: 0 auto 22px;
  letter-spacing: -0.02em;
  position: relative;
}
.sh-quote-mark {
  font-family: var(--serif);
  color: var(--sh-amber);
  font-size: 1.2em;
  margin-right: 4px;
  font-style: italic;
}
.sh-quote-attr {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  font-family: var(--sans);
  font-size: 14.5px;
  color: var(--sh-text-3);
  letter-spacing: -0.005em;
}
.sh-quote-attr strong { color: var(--sh-text); font-weight: 600; }

/* ── Soon ──────────────────────────────────────────────────────────── */
.sh-soon { padding: 96px 0; }
.sh-soon-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 16px;
}
@media (max-width: 720px) { .sh-soon-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .sh-soon-grid { grid-template-columns: 1fr; } }
.sh-soon-card {
  background: var(--sh-card);
  border: 1px solid var(--sh-border);
  border-radius: 12px;
  padding: 18px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  transition: all 0.18s;
}
.sh-soon-card:hover {
  border-color: rgba(245,166,35,0.30);
  background: var(--sh-card-2);
}
.sh-soon-name {
  font-family: var(--sans);
  font-weight: 500;
  font-size: 15.5px;
  color: var(--sh-text);
  letter-spacing: -0.015em;
}
.sh-soon-tag {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--sh-text-3);
  letter-spacing: 0.04em;
  background: var(--sh-bg-2);
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--sh-border);
}

/* ── End ───────────────────────────────────────────────────────────── */
.sh-end { padding: 128px 0; text-align: center; }
.sh-end-title {
  font-family: var(--sans);
  font-weight: 600;
  font-size: clamp(48px, 7vw, 88px);
  letter-spacing: -0.035em;
  line-height: 1;
  margin: 0 0 16px;
  color: var(--sh-text);
}
.sh-end-sub {
  font-family: var(--sans);
  font-size: clamp(17px, 1.5vw, 21px);
  color: var(--sh-text-2);
  margin: 0 0 36px;
  letter-spacing: -0.005em;
}
.sh-end-cta { justify-content: center; }

/* ── Footer ────────────────────────────────────────────────────────── */
.sh-foot { padding: 64px 0 36px; border-top: 1px solid var(--sh-border); background: var(--sh-bg-2); }
.sh-foot-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 48px;
  padding-bottom: 36px;
  border-bottom: 1px solid var(--sh-border);
}
@media (max-width: 720px) { .sh-foot-grid { grid-template-columns: repeat(2, 1fr); gap: 32px; } }
@media (max-width: 480px) { .sh-foot-grid { grid-template-columns: 1fr; } }
.sh-foot-brand { display: flex; flex-direction: column; gap: 12px; }
.sh-foot-mark {
  width: 32px; height: 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--sh-amber), var(--sh-amber-2));
  color: var(--sh-bg);
  font-weight: 700;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sh-foot-brand-name {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 17px;
  color: var(--sh-text);
  letter-spacing: -0.015em;
}
.sh-foot-brand p {
  font-family: var(--sans);
  font-size: 14px;
  color: var(--sh-text-3);
  margin: 0;
  max-width: 280px;
  line-height: 1.55;
  letter-spacing: -0.005em;
}
.sh-foot-h {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 13px;
  color: var(--sh-text);
  margin-bottom: 14px;
  letter-spacing: -0.01em;
}
.sh-foot p, .sh-foot ul {
  font-family: var(--sans);
  font-size: 14px;
  color: var(--sh-text-3);
  line-height: 1.7;
  margin: 0;
  letter-spacing: -0.005em;
}
.sh-foot ul { list-style: none; padding: 0; }
.sh-foot a {
  color: var(--sh-text-2);
  text-decoration: none;
  transition: color 0.15s;
}
.sh-foot a:hover { color: var(--sh-text); }
.sh-foot-tail {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--sh-text-3);
  letter-spacing: 0.02em;
}

@media (prefers-reduced-motion: reduce) {
  .sh-eyebrow-led, .sh-product-led, .sh-art-fbr-led, .sh-chip { animation: none; }
}
`;
