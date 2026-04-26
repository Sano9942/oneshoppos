import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Soft-luxury / boutique landing — preview at /preview/landing-luxury
 *
 * Concept: a boutique hotel's stationery, not a SaaS landing page.
 * Refined serif display, generous whitespace, a single oxblood accent and
 * muted gold hairlines. Positioning is honest to PRs 1–9: Free is permanent,
 * Retail-only at public launch, Pro priced per outlet.
 *
 * Self-contained: own fonts, own theme, no Tailwind theme dependency.
 */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=Manrope:wght@300;400;500;600;700&family=Italiana&display=swap";

const INCLUSIONS = [
  ["Counter & receipts", "Barcode scan, split tender, returns & exchanges, customer-facing display."],
  ["Stock & movement", "Per-outlet stock, transfers, kits, serial tracking, dead-stock reports."],
  ["Purchasing", "PO with multi-level approvals, partial GRN, scanned receiving, supplier payables."],
  ["Books, in window", "P&L, balance sheet, cash flow, journals, AP/AR, post-dated cheques."],
  ["Customer ledger", "Wallet, tiered loyalty, points transfer, eleven-segment RFM, blacklisting."],
  ["Sixty-seven reports", "Sales, stock, payroll, accounting. Plus an in-app analyst that answers in plain language."],
  ["FBR digital invoicing", "Real-time IRN with retry queue. HS-code inheritance per category."],
  ["Offline tolerance", "Sale queue persists locally, synchronises on its own when the line returns."],
  ["Channels & couriers", "Shopify and WooCommerce stock sync. Thirteen Pakistan courier integrations."],
  ["Hardware", "USB scanners, ESC/POS thermal printers, network TCP/IP printing — standard kit."],
];

const COMING_SOON = [
  "Salon & Spa",
  "Clinic & Pharmacy",
  "Restaurant & Café",
  "Rentals",
  "Education",
  "Veterinary",
];

/* ─── A refined "daily statement" card — boutique-tailor invoice ───────── */

function StatementCard() {
  return (
    <article className="lx-stmt" aria-label="Daily statement preview">
      <div className="lx-stmt-frame">
        <header className="lx-stmt-head">
          <div className="lx-stmt-mark">S.</div>
          <div className="lx-stmt-meta">
            <div className="lx-stmt-shop">Maison Khaadi · Lahore</div>
            <div className="lx-stmt-sub">Daily statement · Outlet 01</div>
          </div>
        </header>

        <div className="lx-stmt-rule" />

        <dl className="lx-stmt-rows">
          <div className="lx-stmt-row">
            <dt>Transactions</dt>
            <dd>184</dd>
          </div>
          <div className="lx-stmt-row">
            <dt>Average bill</dt>
            <dd>₨ 4,820</dd>
          </div>
          <div className="lx-stmt-row">
            <dt>Returns</dt>
            <dd>3</dd>
          </div>
          <div className="lx-stmt-row">
            <dt>Wallet credited</dt>
            <dd>₨ 18,400</dd>
          </div>
        </dl>

        <div className="lx-stmt-rule" />

        <div className="lx-stmt-total">
          <span className="lx-stmt-total-l">Net sales · PKR</span>
          <span className="lx-stmt-total-v">887,200</span>
        </div>

        <div className="lx-stmt-rule lx-stmt-rule-dot" />

        <div className="lx-stmt-fbr">
          <div>
            <div className="lx-stmt-mini">FBR · Posted</div>
            <div className="lx-stmt-irn">IRN 7000007D9 · 184/184</div>
          </div>
          <div className="lx-stmt-seal" aria-hidden="true">
            <span>F · B · R</span>
          </div>
        </div>

        <footer className="lx-stmt-foot">
          composed in Lahore · sanopos.com
        </footer>
      </div>
    </article>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function LandingLuxury() {
  const [year] = useState(() => new Date().getFullYear());
  const fontInjected = useRef(false);

  useEffect(() => {
    if (fontInjected.current) return;
    fontInjected.current = true;
    if (!document.querySelector('link[data-lx-font="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      link.setAttribute("data-lx-font", "1");
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="lx-root">
      <style>{LX_STYLES}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="lx-header">
        <div className="lx-container lx-header-row">
          <Link to="/" className="lx-brand">
            <span className="lx-brand-mono">S.</span>
            <span className="lx-brand-name">SanoPOS</span>
            <span className="lx-brand-tag">— Lahore —</span>
          </Link>
          <nav className="lx-nav">
            <a href="#included">Included</a>
            <a href="#memberships">Memberships</a>
            <a href="#assurances">Assurances</a>
            <Link to="/login" className="lx-nav-link lx-nav-link-action">
              Sign in
            </Link>
          </nav>
        </div>
        <div className="lx-rule lx-rule-gold" />
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="lx-hero">
        <div className="lx-hero-glow" aria-hidden="true" />
        <div className="lx-container lx-hero-grid">
          <div className="lx-hero-copy">
            <p className="lx-eyebrow">
              <span className="lx-eyebrow-dash">—</span> Spring Édition · MMXXVI
            </p>

            <h1 className="lx-hero-headline">
              <span className="lx-h-line lx-h-1">A point of sale,</span>
              <span className="lx-h-line lx-h-2">composed with</span>
              <span className="lx-h-line lx-h-3"><em>care.</em></span>
            </h1>

            <p className="lx-lede">
              SanoPOS is the back-office and counter system for Pakistani
              retailers — <strong>FBR-ready, offline-tolerant, and
              free, forever, for shops on their feet</strong>. No trial
              clock. No locks. Upgrade only when the shop has outgrown it.
            </p>

            <div className="lx-cta-row">
              <Link to="/signup" className="lx-cta-primary">
                <span>Open an account</span>
                <span className="lx-cta-rule" aria-hidden="true" />
              </Link>
              <Link to="/login" className="lx-cta-quiet">
                Already a member · Sign in
              </Link>
            </div>

            <p className="lx-fineprint">
              Free plan — 1 outlet · up to 3 staff · up to 100 products. No
              card required. Email verification, then a five-minute setup.
            </p>
          </div>

          <aside className="lx-hero-art">
            <StatementCard />
            <p className="lx-art-cap">
              <em>Plate I.</em> &nbsp;A daily statement, drawn from one
              afternoon at a fictional Lahore boutique.
            </p>
          </aside>
        </div>
      </section>

      {/* ── Brief / philosophy ──────────────────────────────────────── */}
      <section className="lx-brief">
        <div className="lx-container">
          <p className="lx-brief-text">
            We have, for some years, watched small retailers in Pakistan pay
            month upon month for software that asks more of them than it
            gives. <em>SanoPOS</em> is the answer to a question we kept
            hearing in side conversations: <em>could the books, the counter,
            and the law be kept in one window — and could the price be
            honest?</em>
          </p>
          <p className="lx-brief-attr">— A note from the founders</p>
        </div>
      </section>

      {/* ── Memberships (pricing) ───────────────────────────────────── */}
      <section className="lx-memberships" id="memberships">
        <div className="lx-container">
          <header className="lx-section-head">
            <p className="lx-section-eyebrow">— Memberships —</p>
            <h2 className="lx-section-title">
              Two ways to <em>keep shop</em>.
            </h2>
            <p className="lx-section-sub">
              Free is permanent. Pro is per outlet, paid monthly, and
              extensible one outlet at a time.
            </p>
          </header>

          <div className="lx-cards">
            {/* ── Free card ─────────────────────────────────────── */}
            <article className="lx-card">
              <div className="lx-card-frame">
                <header className="lx-card-head">
                  <span className="lx-card-roman">№ I</span>
                  <h3 className="lx-card-name">Free</h3>
                  <p className="lx-card-tagline">For shops finding their feet.</p>
                </header>

                <div className="lx-card-rule" />

                <div className="lx-card-price">
                  <span className="lx-card-cur">₨</span>
                  <span className="lx-card-num">0</span>
                  <span className="lx-card-cad">forever</span>
                </div>

                <p className="lx-card-honest">
                  Not a trial. Not a teaser. Permanent.
                </p>

                <div className="lx-card-rule" />

                <ul className="lx-card-list">
                  <li><span className="lx-tick" aria-hidden="true">✶</span>One outlet</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Up to three staff</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Up to one hundred products</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Every retail feature, no locks</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>FBR digital invoicing</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Offline sale queue</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Community support</li>
                </ul>

                <Link to="/signup" className="lx-card-cta lx-card-cta-quiet">
                  Open a free account
                  <span className="lx-card-cta-arrow" aria-hidden="true">→</span>
                </Link>
              </div>
            </article>

            {/* ── Pro card ──────────────────────────────────────── */}
            <article className="lx-card lx-card-feature">
              <div className="lx-card-ribbon">
                <span>For shops with scale</span>
              </div>
              <div className="lx-card-frame">
                <header className="lx-card-head">
                  <span className="lx-card-roman">№ II</span>
                  <h3 className="lx-card-name"><em>Pro</em></h3>
                  <p className="lx-card-tagline">When the shop has outgrown the Free plan.</p>
                </header>

                <div className="lx-card-rule" />

                <div className="lx-card-price">
                  <span className="lx-card-cur">₨</span>
                  <span className="lx-card-num lx-card-num-feature">8,000</span>
                  <span className="lx-card-cad">per month, per outlet</span>
                </div>

                <p className="lx-card-honest">
                  Add additional outlets, one at a time, from inside the app.
                </p>

                <div className="lx-card-rule" />

                <ul className="lx-card-list">
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Unlimited staff</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Unlimited products</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Multi-outlet, with stock transfers</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Context-aware pricing & visibility</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>AI insights panel</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Email & WhatsApp support</li>
                  <li><span className="lx-tick" aria-hidden="true">✶</span>Cancel from the dashboard</li>
                </ul>

                <Link to="/signup" className="lx-card-cta">
                  Open an account
                  <span className="lx-card-cta-arrow" aria-hidden="true">→</span>
                </Link>
                <p className="lx-card-foot">
                  Begin on Free, upgrade from <em>/billing</em> when ready.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ── Included (amenities sheet) ──────────────────────────────── */}
      <section className="lx-included" id="included">
        <div className="lx-container">
          <header className="lx-section-head">
            <p className="lx-section-eyebrow">— Amenities —</p>
            <h2 className="lx-section-title">
              What is <em>included</em>, on every plan.
            </h2>
            <p className="lx-section-sub">
              No paid add-ons. No enterprise tier. Every line below is yours
              from the first sign-in.
            </p>
          </header>

          <div className="lx-amen">
            {INCLUSIONS.map(([t, b], i) => (
              <article className="lx-amen-row" key={t}>
                <span className="lx-amen-num">{String(i + 1).padStart(2, "0")}.</span>
                <div className="lx-amen-body">
                  <h4 className="lx-amen-title">{t}</h4>
                  <p className="lx-amen-text">{b}</p>
                </div>
                <span className="lx-amen-rule" aria-hidden="true" />
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Assurances (Pakistan-first credentials) ─────────────────── */}
      <section className="lx-assurances" id="assurances">
        <div className="lx-container">
          <header className="lx-section-head">
            <p className="lx-section-eyebrow">— Assurances —</p>
            <h2 className="lx-section-title">
              Built <em>here</em>, with the law and the line in mind.
            </h2>
          </header>

          <div className="lx-assure-grid">
            <div className="lx-assure">
              <div className="lx-assure-icon" aria-hidden="true">§</div>
              <h4 className="lx-assure-title">FBR Digital Invoicing</h4>
              <p>Real-time IRN with retry queue. HS-code inheritance per category, surfaced as a tax-rate lookup.</p>
            </div>
            <div className="lx-assure">
              <div className="lx-assure-icon" aria-hidden="true">₨</div>
              <h4 className="lx-assure-title">Pakistani Rupee, native</h4>
              <p>PKR formatting, denomination cash drawer, and a tender flow built for the way Pakistani shops actually pay.</p>
            </div>
            <div className="lx-assure">
              <div className="lx-assure-icon" aria-hidden="true">⌘</div>
              <h4 className="lx-assure-title">Thirteen courier partners</h4>
              <p>Leopards, TCS, BlueEx, Postex, Trax, Rider, Swyft, Bykea, MNP, Pakpost, DHL, FedEx, CallCourier.</p>
            </div>
            <div className="lx-assure">
              <div className="lx-assure-icon" aria-hidden="true">⊕</div>
              <h4 className="lx-assure-title">Reliability stack</h4>
              <p>Cloudflare, Sentry, UptimeRobot. Five-minute pings, structured logs, error tracking on the house.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Letter / testimonial ────────────────────────────────────── */}
      <section className="lx-letter">
        <div className="lx-container">
          <p className="lx-letter-head">
            <span className="lx-letter-orn">❦</span>
          </p>
          <blockquote className="lx-letter-quote">
            "We had been paying a Karachi vendor by the feature. SanoPOS gave
            us FBR, multi-outlet, and the books on the first day. Closing
            used to take a Saturday. It now takes an hour."
          </blockquote>
          <p className="lx-letter-attr">
            <span>Bilal A.</span>
            <span className="lx-letter-em">·</span>
            <span>three-outlet apparel chain</span>
            <span className="lx-letter-em">·</span>
            <span>Lahore</span>
          </p>
        </div>
      </section>

      {/* ── By invitation (coming-soon industries) ──────────────────── */}
      <section className="lx-invite">
        <div className="lx-container">
          <header className="lx-section-head">
            <p className="lx-section-eyebrow">— By invitation —</p>
            <h2 className="lx-section-title-sm">
              <em>Salon, clinic, restaurant — and others — to follow.</em>
            </h2>
            <p className="lx-section-sub">
              SanoPOS at public launch is for retail. The presets below are
              already implemented in our preview builds and will be opened in
              order, beginning later this year. Write to us if you would like
              an early seat.
            </p>
          </header>

          <ul className="lx-invite-list">
            {COMING_SOON.map((it) => (
              <li key={it}>
                <span className="lx-invite-mark">◦</span>
                {it}
                <span className="lx-invite-tag">in preview</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── End / CTA ───────────────────────────────────────────────── */}
      <section className="lx-end">
        <div className="lx-container lx-end-inner">
          <h2 className="lx-end-title">
            Open a <em>free</em> account.
          </h2>
          <p className="lx-end-sub">
            Five minutes. An email to confirm. The shop, on the same evening.
          </p>
          <div className="lx-cta-row lx-cta-center">
            <Link to="/signup" className="lx-cta-primary lx-cta-large">
              <span>Begin</span>
              <span className="lx-cta-rule" aria-hidden="true" />
            </Link>
            <Link to="/login" className="lx-cta-quiet">
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer (colophon) ───────────────────────────────────────── */}
      <footer className="lx-foot">
        <div className="lx-container">
          <div className="lx-rule lx-rule-gold" />
          <div className="lx-foot-grid">
            <div>
              <div className="lx-foot-h">— Colophon —</div>
              <p>
                Set in <em>Cormorant Garamond</em>, <em>Italiana</em>, and
                <em> Manrope</em>. Composed in Lahore.
                <br /><br />
                <strong>SanoPOS</strong> is a registered product of Sano
                Merchandise.
              </p>
            </div>
            <div>
              <div className="lx-foot-h">— Pages —</div>
              <ul>
                <li><a href="#included">Amenities</a></li>
                <li><a href="#memberships">Memberships</a></li>
                <li><a href="#assurances">Assurances</a></li>
              </ul>
            </div>
            <div>
              <div className="lx-foot-h">— Desk —</div>
              <ul>
                <li><Link to="/login">Sign in</Link></li>
                <li><Link to="/signup">Open an account</Link></li>
                <li><Link to="/terms">Terms</Link></li>
                <li><Link to="/privacy">Privacy</Link></li>
              </ul>
            </div>
            <div>
              <div className="lx-foot-h">— Édition —</div>
              <p>
                Spring · MMXXVI<br />
                Lahore<br />
                © {year} Sano Merchandise.
              </p>
            </div>
          </div>
          <p className="lx-foot-orn">❦</p>
        </div>
      </footer>
    </div>
  );
}

/* ─── Stylesheet ─────────────────────────────────────────────────────────── */

const LX_STYLES = `
.lx-root {
  --linen: #F8F4ED;
  --linen-2: #F1EBE0;
  --ivory: #FAF7F1;
  --ink: #1F1A14;
  --ink-2: #4A4239;
  --ink-soft: #756D60;
  --rule: #2F271F;
  --gold: #B8964F;
  --gold-soft: #DCC592;
  --oxblood: #7A2E2A;
  --oxblood-soft: #B97B73;
  --rose: #E8DCD0;

  --serif: "Cormorant Garamond", Georgia, "Times New Roman", serif;
  --display: "Italiana", "Cormorant Garamond", serif;
  --sans: "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

  background: var(--linen);
  color: var(--ink);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
  overflow-x: hidden;
  font-weight: 400;
}

/* paper grain */
.lx-root::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.04;
  z-index: 1;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  mix-blend-mode: multiply;
}
.lx-root > * { position: relative; z-index: 2; }

.lx-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 32px;
}
@media (max-width: 720px) { .lx-container { padding: 0 22px; } }

.lx-rule {
  height: 1px;
  background: var(--rule);
  width: 100%;
  opacity: 0.85;
}
.lx-rule-gold {
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--gold) 12%, var(--gold) 88%, transparent 100%);
  opacity: 0.9;
}

/* ── Header ──────────────────────────────────────────────────────────── */
.lx-header { padding: 24px 0 18px; }
.lx-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18px;
  gap: 24px;
}
.lx-brand {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  text-decoration: none;
  color: var(--ink);
}
.lx-brand-mono {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 500;
  font-size: 22px;
  color: var(--oxblood);
  line-height: 1;
}
.lx-brand-name {
  font-family: var(--display);
  font-size: 22px;
  letter-spacing: 0.04em;
  color: var(--ink);
}
.lx-brand-tag {
  font-family: var(--serif);
  font-style: italic;
  font-size: 13px;
  color: var(--ink-soft);
  letter-spacing: 0.02em;
}
.lx-nav {
  display: flex;
  align-items: center;
  gap: 28px;
}
.lx-nav a, .lx-nav-link {
  font-family: var(--serif);
  font-size: 16px;
  color: var(--ink);
  text-decoration: none;
  letter-spacing: 0.02em;
  transition: color 0.2s;
  position: relative;
}
.lx-nav a::after, .lx-nav-link::after {
  content: "";
  position: absolute;
  bottom: -3px;
  left: 0;
  height: 1px;
  width: 0;
  background: var(--oxblood);
  transition: width 0.25s ease;
}
.lx-nav a:hover { color: var(--oxblood); }
.lx-nav a:hover::after, .lx-nav-link:hover::after { width: 100%; }
.lx-nav-link-action {
  border: 1px solid var(--ink);
  padding: 8px 18px;
  letter-spacing: 0.04em;
  font-size: 14px;
  transition: all 0.2s;
}
.lx-nav-link-action:hover {
  background: var(--ink);
  color: var(--linen) !important;
}
.lx-nav-link-action::after { display: none; }
@media (max-width: 720px) {
  .lx-nav { gap: 14px; }
  .lx-nav a:not(.lx-nav-link-action) { display: none; }
  .lx-brand-tag { display: none; }
}

/* ── Hero ────────────────────────────────────────────────────────────── */
.lx-hero {
  position: relative;
  padding: 88px 0 112px;
  overflow: hidden;
}
.lx-hero-glow {
  position: absolute;
  inset: -80px -100px auto auto;
  width: 720px;
  height: 720px;
  background: radial-gradient(closest-side, rgba(184,150,79,0.18), transparent 70%);
  filter: blur(20px);
  pointer-events: none;
  animation: lx-glow 12s ease-in-out infinite alternate;
}
@keyframes lx-glow {
  from { opacity: 0.7; transform: translate(0, 0); }
  to   { opacity: 1.0; transform: translate(-40px, 30px); }
}
.lx-hero-grid {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 72px;
  align-items: center;
}
@media (max-width: 980px) {
  .lx-hero-grid { grid-template-columns: 1fr; gap: 56px; }
}

.lx-eyebrow {
  font-family: var(--serif);
  font-style: italic;
  font-size: 15px;
  color: var(--oxblood);
  letter-spacing: 0.04em;
  margin: 0 0 28px;
  font-weight: 400;
  display: flex;
  align-items: center;
  gap: 10px;
}
.lx-eyebrow-dash {
  display: inline-block;
  width: 28px;
  height: 1px;
  background: var(--oxblood);
}
.lx-eyebrow-dash::after { content: ""; display: none; }

.lx-hero-headline {
  font-family: var(--display);
  font-weight: 400;
  font-size: clamp(48px, 7.4vw, 104px);
  line-height: 0.98;
  letter-spacing: -0.012em;
  color: var(--ink);
  margin: 0 0 32px;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.lx-h-line {
  display: block;
  opacity: 0;
  transform: translateY(14px);
  animation: lx-rise 0.85s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}
.lx-h-1 { animation-delay: 0.05s; }
.lx-h-2 { animation-delay: 0.30s; padding-left: 1.6em; }
.lx-h-3 { animation-delay: 0.55s; padding-left: 0.4em; }
.lx-h-3 em {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 400;
  color: var(--oxblood);
}
@keyframes lx-rise {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

.lx-lede {
  font-family: var(--serif);
  font-size: clamp(18px, 1.6vw, 22px);
  line-height: 1.55;
  color: var(--ink-2);
  max-width: 580px;
  margin: 0 0 36px;
  font-weight: 400;
  opacity: 0;
  animation: lx-rise 0.8s ease 0.7s forwards;
}
.lx-lede strong { color: var(--ink); font-weight: 500; }

.lx-cta-row {
  display: flex;
  gap: 28px;
  align-items: center;
  flex-wrap: wrap;
  opacity: 0;
  animation: lx-rise 0.8s ease 0.85s forwards;
}
.lx-cta-center { justify-content: center; }

.lx-cta-primary {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  font-family: var(--display);
  font-size: 22px;
  letter-spacing: 0.05em;
  color: var(--ink);
  text-decoration: none;
  padding: 4px 0;
  position: relative;
  cursor: pointer;
}
.lx-cta-large { font-size: 26px; }
.lx-cta-primary span:first-child { line-height: 1; }
.lx-cta-rule {
  display: block;
  height: 1px;
  width: 100%;
  background: var(--oxblood);
  transform-origin: left center;
  transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.lx-cta-primary:hover { color: var(--oxblood); }
.lx-cta-primary:hover .lx-cta-rule { transform: scaleX(1.08); background: var(--oxblood); }

.lx-cta-quiet {
  font-family: var(--serif);
  font-style: italic;
  font-size: 16px;
  color: var(--ink-2);
  text-decoration: none;
  letter-spacing: 0.01em;
  border-bottom: 1px solid transparent;
  transition: all 0.25s;
}
.lx-cta-quiet:hover {
  color: var(--oxblood);
  border-bottom-color: var(--oxblood);
}

.lx-fineprint {
  font-family: var(--serif);
  font-style: italic;
  font-size: 14.5px;
  color: var(--ink-soft);
  margin: 22px 0 0;
  max-width: 540px;
  opacity: 0;
  animation: lx-rise 0.8s ease 1.0s forwards;
}

/* ── Statement card ──────────────────────────────────────────────────── */
.lx-hero-art {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  opacity: 0;
  animation: lx-rise 1s ease 0.4s forwards;
}
.lx-stmt {
  width: 360px;
  max-width: 100%;
  filter:
    drop-shadow(0 30px 60px rgba(31,26,20,0.16))
    drop-shadow(0 8px 18px rgba(31,26,20,0.10));
  transform: rotate(1.4deg);
  transition: transform 0.5s ease;
}
.lx-stmt:hover { transform: rotate(0deg) translateY(-3px); }
.lx-stmt-frame {
  background: linear-gradient(180deg, var(--ivory) 0%, #F4ECDB 100%);
  padding: 30px 30px 26px;
  position: relative;
  border: 1px solid rgba(184,150,79,0.45);
}
.lx-stmt-frame::before, .lx-stmt-frame::after {
  content: "";
  position: absolute;
  left: 12px; right: 12px;
  height: 1px;
  background: var(--gold);
  opacity: 0.55;
}
.lx-stmt-frame::before { top: 12px; }
.lx-stmt-frame::after { bottom: 12px; }

.lx-stmt-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.lx-stmt-mark {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 500;
  font-size: 36px;
  color: var(--oxblood);
  line-height: 1;
  border: 1px solid var(--gold);
  padding: 6px 12px;
}
.lx-stmt-shop {
  font-family: var(--display);
  font-size: 16px;
  letter-spacing: 0.04em;
  color: var(--ink);
}
.lx-stmt-sub {
  font-family: var(--serif);
  font-style: italic;
  font-size: 13px;
  color: var(--ink-soft);
  margin-top: 2px;
}
.lx-stmt-rule {
  height: 1px;
  background: var(--gold);
  opacity: 0.5;
  margin: 14px 0;
}
.lx-stmt-rule-dot {
  background: none;
  border-top: 1px dashed var(--ink-soft);
  height: 0;
  opacity: 0.55;
}
.lx-stmt-rows { margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.lx-stmt-row {
  display: flex;
  justify-content: space-between;
  font-family: var(--serif);
  font-size: 15px;
  color: var(--ink-2);
}
.lx-stmt-row dt { font-style: italic; margin: 0; }
.lx-stmt-row dd { margin: 0; font-weight: 500; color: var(--ink); }

.lx-stmt-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 0 6px;
}
.lx-stmt-total-l {
  font-family: var(--serif);
  font-style: italic;
  font-size: 14px;
  color: var(--ink-soft);
  letter-spacing: 0.04em;
}
.lx-stmt-total-v {
  font-family: var(--display);
  font-size: 28px;
  letter-spacing: 0.02em;
  color: var(--ink);
}

.lx-stmt-fbr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 12px 0 6px;
}
.lx-stmt-mini {
  font-family: var(--sans);
  font-size: 9.5px;
  letter-spacing: 0.16em;
  color: var(--gold);
  font-weight: 600;
  text-transform: uppercase;
  margin-bottom: 3px;
}
.lx-stmt-irn {
  font-family: var(--serif);
  font-size: 13px;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.lx-stmt-seal {
  width: 52px;
  height: 52px;
  border: 1px solid var(--gold);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--display);
  font-size: 9px;
  letter-spacing: 0.18em;
  color: var(--gold);
  position: relative;
}
.lx-stmt-seal::before {
  content: "";
  position: absolute;
  inset: 4px;
  border: 1px solid var(--gold);
  border-radius: 50%;
  opacity: 0.5;
}

.lx-stmt-foot {
  font-family: var(--serif);
  font-style: italic;
  font-size: 11.5px;
  text-align: center;
  color: var(--ink-soft);
  letter-spacing: 0.06em;
  margin-top: 10px;
}

.lx-art-cap {
  font-family: var(--serif);
  font-style: italic;
  font-size: 13.5px;
  color: var(--ink-soft);
  text-align: center;
  max-width: 320px;
  line-height: 1.5;
  margin: 0;
}

/* ── Brief ──────────────────────────────────────────────────────────── */
.lx-brief {
  padding: 96px 0;
  text-align: center;
}
.lx-brief-text {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 300;
  font-size: clamp(22px, 2.6vw, 32px);
  line-height: 1.5;
  color: var(--ink);
  max-width: 880px;
  margin: 0 auto 22px;
  letter-spacing: -0.005em;
}
.lx-brief-text em {
  font-style: italic;
  color: var(--oxblood);
  font-weight: 400;
}
.lx-brief-attr {
  font-family: var(--serif);
  font-style: italic;
  font-size: 14.5px;
  color: var(--ink-soft);
  margin: 0;
  letter-spacing: 0.04em;
}

/* ── Section heads ──────────────────────────────────────────────────── */
.lx-section-head {
  text-align: center;
  margin-bottom: 64px;
}
.lx-section-eyebrow {
  font-family: var(--serif);
  font-style: italic;
  font-size: 15px;
  color: var(--oxblood);
  margin: 0 0 14px;
  letter-spacing: 0.06em;
}
.lx-section-title {
  font-family: var(--display);
  font-size: clamp(34px, 5vw, 64px);
  font-weight: 400;
  letter-spacing: -0.012em;
  line-height: 1.05;
  color: var(--ink);
  margin: 0 0 18px;
}
.lx-section-title em {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 400;
  color: var(--oxblood);
}
.lx-section-title-sm {
  font-family: var(--display);
  font-size: clamp(26px, 3.2vw, 38px);
  font-weight: 400;
  letter-spacing: -0.008em;
  line-height: 1.15;
  color: var(--ink);
  margin: 0 0 18px;
}
.lx-section-title-sm em {
  font-family: var(--serif);
  font-style: italic;
  color: var(--oxblood);
}
.lx-section-sub {
  font-family: var(--serif);
  font-size: clamp(16px, 1.4vw, 18.5px);
  font-style: italic;
  color: var(--ink-2);
  max-width: 640px;
  margin: 0 auto;
  line-height: 1.55;
}

/* ── Memberships / pricing ──────────────────────────────────────────── */
.lx-memberships {
  padding: 96px 0;
  background: var(--linen-2);
  border-top: 1px solid rgba(184,150,79,0.35);
  border-bottom: 1px solid rgba(184,150,79,0.35);
}
.lx-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  margin-top: 48px;
}
@media (max-width: 880px) {
  .lx-cards { grid-template-columns: 1fr; gap: 28px; }
}
.lx-card { position: relative; }
.lx-card-frame {
  background: var(--ivory);
  padding: 46px 42px 40px;
  border: 1px solid var(--gold);
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.lx-card-frame::before {
  content: "";
  position: absolute;
  inset: 8px;
  border: 1px solid var(--gold);
  opacity: 0.45;
  pointer-events: none;
}
.lx-card-feature .lx-card-frame {
  background: linear-gradient(180deg, var(--ivory) 0%, #F4E9D6 100%);
  border-color: var(--oxblood);
}
.lx-card-feature .lx-card-frame::before { border-color: var(--oxblood); opacity: 0.35; }

.lx-card-ribbon {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--oxblood);
  color: var(--ivory);
  padding: 6px 18px;
  font-family: var(--serif);
  font-style: italic;
  font-size: 13px;
  letter-spacing: 0.06em;
  z-index: 3;
}

.lx-card-head { margin-bottom: 18px; }
.lx-card-roman {
  font-family: var(--serif);
  font-style: italic;
  font-size: 14px;
  color: var(--gold);
  letter-spacing: 0.18em;
  font-weight: 500;
  display: block;
  margin-bottom: 8px;
}
.lx-card-name {
  font-family: var(--display);
  font-size: clamp(40px, 5vw, 56px);
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1;
  color: var(--ink);
  margin: 0;
}
.lx-card-name em {
  font-family: var(--serif);
  font-style: italic;
  color: var(--oxblood);
  font-weight: 400;
}
.lx-card-tagline {
  font-family: var(--serif);
  font-style: italic;
  font-size: 16px;
  color: var(--ink-soft);
  margin: 8px 0 0;
}

.lx-card-rule {
  height: 1px;
  background: var(--gold);
  opacity: 0.4;
  margin: 22px 0;
}

.lx-card-price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.lx-card-cur {
  font-family: var(--display);
  font-size: 22px;
  color: var(--ink-2);
}
.lx-card-num {
  font-family: var(--display);
  font-size: clamp(56px, 7vw, 88px);
  font-weight: 400;
  line-height: 1;
  color: var(--ink);
  letter-spacing: -0.025em;
}
.lx-card-num-feature { color: var(--oxblood); }
.lx-card-cad {
  font-family: var(--serif);
  font-style: italic;
  font-size: 15.5px;
  color: var(--ink-soft);
  margin-left: auto;
  text-align: right;
}

.lx-card-honest {
  font-family: var(--serif);
  font-style: italic;
  font-size: 14.5px;
  color: var(--ink-soft);
  margin: 14px 0 0;
}

.lx-card-list {
  list-style: none;
  padding: 0;
  margin: 0 0 32px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  flex: 1;
}
.lx-card-list li {
  font-family: var(--serif);
  font-size: 16.5px;
  color: var(--ink);
  display: flex;
  gap: 12px;
  align-items: baseline;
  letter-spacing: 0.005em;
}
.lx-tick {
  color: var(--oxblood);
  font-size: 13px;
  flex-shrink: 0;
}

.lx-card-cta {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--display);
  font-size: 18px;
  letter-spacing: 0.04em;
  color: var(--ivory);
  background: var(--oxblood);
  padding: 16px 22px;
  text-decoration: none;
  transition: all 0.25s;
  border: 1px solid var(--oxblood);
}
.lx-card-cta:hover {
  background: var(--ink);
  border-color: var(--ink);
}
.lx-card-cta-quiet {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--ink);
}
.lx-card-cta-quiet:hover {
  background: var(--ink);
  color: var(--ivory);
}
.lx-card-cta-arrow {
  transition: transform 0.25s;
  font-size: 16px;
}
.lx-card-cta:hover .lx-card-cta-arrow { transform: translateX(4px); }

.lx-card-foot {
  font-family: var(--serif);
  font-style: italic;
  font-size: 13.5px;
  color: var(--ink-soft);
  margin: 14px 0 0;
  text-align: center;
}
.lx-card-foot em { color: var(--oxblood); font-style: italic; }

/* ── Amenities ──────────────────────────────────────────────────────── */
.lx-included { padding: 112px 0; }
.lx-amen {
  display: flex;
  flex-direction: column;
  margin-top: 32px;
  border-top: 1px solid rgba(184,150,79,0.35);
}
.lx-amen-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 32px;
  padding: 26px 0;
  border-bottom: 1px solid rgba(184,150,79,0.35);
  align-items: baseline;
  position: relative;
  transition: background 0.25s;
}
.lx-amen-row:hover { background: rgba(184,150,79,0.05); }
@media (max-width: 720px) {
  .lx-amen-row { grid-template-columns: 60px 1fr; gap: 18px; }
}
.lx-amen-num {
  font-family: var(--display);
  font-size: 24px;
  color: var(--gold);
  letter-spacing: 0.02em;
  font-weight: 400;
}
.lx-amen-title {
  font-family: var(--display);
  font-size: clamp(22px, 2.4vw, 28px);
  font-weight: 400;
  letter-spacing: -0.005em;
  margin: 0 0 6px;
  color: var(--ink);
}
.lx-amen-text {
  font-family: var(--serif);
  font-style: italic;
  font-size: 17px;
  line-height: 1.5;
  color: var(--ink-2);
  margin: 0;
  max-width: 64ch;
}

/* ── Assurances ─────────────────────────────────────────────────────── */
.lx-assurances {
  padding: 96px 0;
  background: var(--linen-2);
  border-top: 1px solid rgba(184,150,79,0.35);
  border-bottom: 1px solid rgba(184,150,79,0.35);
}
.lx-assure-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 36px;
  margin-top: 32px;
}
@media (max-width: 980px) { .lx-assure-grid { grid-template-columns: repeat(2, 1fr); gap: 32px; } }
@media (max-width: 540px) { .lx-assure-grid { grid-template-columns: 1fr; } }
.lx-assure { text-align: center; }
.lx-assure-icon {
  font-family: var(--display);
  font-size: 38px;
  color: var(--oxblood);
  border: 1px solid var(--gold);
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  border-radius: 50%;
  line-height: 1;
}
.lx-assure-title {
  font-family: var(--display);
  font-size: 19px;
  font-weight: 400;
  letter-spacing: -0.005em;
  margin: 0 0 10px;
  color: var(--ink);
}
.lx-assure p {
  font-family: var(--serif);
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink-2);
  margin: 0;
  font-style: italic;
}

/* ── Letter / testimonial ───────────────────────────────────────────── */
.lx-letter {
  padding: 120px 0;
  text-align: center;
}
.lx-letter-orn {
  font-family: var(--serif);
  font-size: 28px;
  color: var(--gold);
  display: inline-block;
  margin-bottom: 30px;
}
.lx-letter-quote {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 300;
  font-size: clamp(22px, 2.8vw, 34px);
  line-height: 1.45;
  color: var(--ink);
  max-width: 880px;
  margin: 0 auto 24px;
  letter-spacing: -0.008em;
}
.lx-letter-attr {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
  font-family: var(--serif);
  font-size: 15px;
  color: var(--ink-soft);
  font-style: italic;
}
.lx-letter-attr span:first-child {
  color: var(--ink);
  font-weight: 500;
  font-style: normal;
}
.lx-letter-em { color: var(--gold); }

/* ── By invitation ──────────────────────────────────────────────────── */
.lx-invite {
  padding: 96px 0;
  background: var(--linen-2);
  border-top: 1px solid rgba(184,150,79,0.35);
}
.lx-invite-list {
  list-style: none;
  padding: 0;
  margin: 32px auto 0;
  max-width: 720px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px 36px;
}
@media (max-width: 540px) { .lx-invite-list { grid-template-columns: 1fr; } }
.lx-invite-list li {
  font-family: var(--display);
  font-size: 22px;
  color: var(--ink);
  display: flex;
  align-items: baseline;
  gap: 12px;
  border-bottom: 1px dotted var(--gold);
  padding: 8px 0;
  letter-spacing: 0.01em;
}
.lx-invite-mark { color: var(--oxblood); }
.lx-invite-tag {
  font-family: var(--serif);
  font-style: italic;
  font-size: 12.5px;
  color: var(--ink-soft);
  margin-left: auto;
  letter-spacing: 0.04em;
}

/* ── End / CTA ──────────────────────────────────────────────────────── */
.lx-end {
  padding: 128px 0;
  text-align: center;
}
.lx-end-title {
  font-family: var(--display);
  font-size: clamp(46px, 7vw, 96px);
  font-weight: 400;
  letter-spacing: -0.018em;
  line-height: 1;
  margin: 0 0 18px;
  color: var(--ink);
}
.lx-end-title em {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 400;
  color: var(--oxblood);
}
.lx-end-sub {
  font-family: var(--serif);
  font-style: italic;
  font-size: clamp(17px, 1.6vw, 21px);
  color: var(--ink-2);
  margin: 0 0 36px;
}

/* ── Footer ─────────────────────────────────────────────────────────── */
.lx-foot {
  background: var(--linen);
  padding: 36px 0 56px;
}
.lx-foot-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 40px;
  padding: 36px 0 24px;
}
@media (max-width: 720px) { .lx-foot-grid { grid-template-columns: repeat(2, 1fr); gap: 32px; } }
@media (max-width: 480px) { .lx-foot-grid { grid-template-columns: 1fr; } }
.lx-foot-h {
  font-family: var(--serif);
  font-style: italic;
  font-size: 14px;
  letter-spacing: 0.06em;
  color: var(--oxblood);
  margin-bottom: 14px;
}
.lx-foot p, .lx-foot ul {
  font-family: var(--serif);
  font-size: 15px;
  color: var(--ink-2);
  line-height: 1.65;
  margin: 0;
}
.lx-foot p em { font-style: italic; color: var(--ink); }
.lx-foot p strong { font-weight: 500; color: var(--ink); }
.lx-foot ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lx-foot a {
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: all 0.2s;
}
.lx-foot a:hover {
  color: var(--oxblood);
  border-bottom-color: var(--oxblood);
}
.lx-foot-orn {
  text-align: center;
  font-family: var(--serif);
  font-size: 22px;
  color: var(--gold);
  margin: 22px 0 0;
}

/* ── Reduced motion ─────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .lx-h-line, .lx-lede, .lx-cta-row, .lx-fineprint, .lx-hero-art {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .lx-hero-glow { animation: none; }
  .lx-stmt { transform: none; }
}
`;
