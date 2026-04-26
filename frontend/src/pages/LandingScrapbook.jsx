import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Hand-drawn / scrapbook landing — preview at /preview/landing-scrapbook
 *
 * Concept: a shopkeeper's daybook. Notebook paper with faint blue rules and
 * a red margin, washi-tape banners, sticky notes, marker headlines, highlighter
 * strokes, hand-drawn squiggles + arrows. Ground truth from PRs 1–9.
 */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&family=Patrick+Hand&family=Patrick+Hand+SC&family=Permanent+Marker&family=Reenie+Beanie&display=swap";

const DAYBOOK_ENTRIES = [
  {
    color: "yellow",
    tilt: -2.5,
    title: "Counter & receipts",
    body: "Barcode scan, split tender, returns, F1–F10 shortcuts. The cashier never has to think.",
  },
  {
    color: "pink",
    tilt: 1.6,
    title: "FBR digital invoicing",
    body: "Real-time posting with retry queue. HS-code inheritance per category. Stop thinking about compliance.",
  },
  {
    color: "blue",
    tilt: -1.4,
    title: "Books, in-window",
    body: "P&L, balance sheet, cash flow, journals, AP/AR. No QuickBooks. No Xero. The books close on Friday.",
  },
  {
    color: "yellow",
    tilt: 2.2,
    title: "Customer ledger",
    body: "Wallet, tiered loyalty, points transfer, eleven-segment RFM. The shop's regulars, by the numbers.",
  },
  {
    color: "pink",
    tilt: -2,
    title: "Sixty-seven reports",
    body: "Sales, stock, payroll, accounting. Plus an in-app analyst that answers in plain language.",
  },
  {
    color: "blue",
    tilt: 1.8,
    title: "Offline-tolerant",
    body: "Sale queue persists locally, syncs when the line returns. Outages stop being events.",
  },
];

const COURIERS = [
  { c: "Leopards", color: "yellow", tilt: -3 },
  { c: "TCS", color: "pink", tilt: 2 },
  { c: "BlueEx", color: "blue", tilt: -1.5 },
  { c: "Postex", color: "yellow", tilt: 1.8 },
  { c: "Trax", color: "pink", tilt: -2.5 },
  { c: "Rider", color: "blue", tilt: 2.2 },
  { c: "Swyft", color: "yellow", tilt: -2 },
  { c: "Bykea", color: "pink", tilt: 1.4 },
  { c: "MNP", color: "blue", tilt: -1.8 },
  { c: "Pakpost", color: "yellow", tilt: 2.4 },
  { c: "DHL", color: "pink", tilt: -1.6 },
  { c: "FedEx", color: "blue", tilt: 1.9 },
  { c: "CallCourier", color: "yellow", tilt: -2.3 },
];

const COMING_SOON = ["Salon & Spa", "Clinic & Pharmacy", "Restaurant & Café", "Rentals", "Education", "Veterinary"];

/* ─── Hand-drawn SVG primitives ─────────────────────────────────────────── */

function Underline({ wobble = 1, color = "var(--sb-red)", width = "100%" }) {
  return (
    <svg className="sb-underline" viewBox="0 0 200 12" preserveAspectRatio="none" style={{ width }} aria-hidden="true">
      <path
        d={`M 4 ${6 + wobble} Q 30 ${2 - wobble} 60 ${7 + wobble} T 120 ${4 - wobble} Q 150 ${9 + wobble} 196 ${5 - wobble}`}
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function HighlightStroke({ children, color = "var(--sb-yellow)" }) {
  return (
    <span className="sb-hl" style={{ "--sb-hl": color }}>
      {children}
    </span>
  );
}

function HandArrow({ rotation = 0, scale = 1, color = "var(--sb-red)" }) {
  return (
    <svg
      width={120 * scale}
      height={80 * scale}
      viewBox="0 0 120 80"
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-hidden="true"
    >
      <path
        d="M 6 14 Q 28 8 50 22 Q 72 36 88 58 Q 96 70 104 66"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 96 56 L 104 66 L 92 70"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function HandCheck({ color = "var(--sb-red)" }) {
  return (
    <svg width="20" height="18" viewBox="0 0 20 18" aria-hidden="true">
      <path
        d="M 3 9 Q 6 11 8 14 Q 12 6 17 3"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function Squiggle({ color = "var(--sb-ink-soft)" }) {
  return (
    <svg className="sb-squig" viewBox="0 0 240 16" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M 4 8 Q 16 2 28 8 T 52 8 T 76 8 T 100 8 T 124 8 T 148 8 T 172 8 T 196 8 T 220 8 T 236 8"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function HandStar({ color = "var(--sb-red)", size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M 10 2 L 12 8 L 18 8.5 L 13 12.5 L 14.5 18 L 10 14.5 L 5.5 18 L 7 12.5 L 2 8.5 L 8 8 Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function CoffeeRing({ top, left, size = 90, opacity = 0.22 }) {
  return (
    <div
      className="sb-coffee"
      style={{
        top, left,
        width: size,
        height: size,
        opacity,
      }}
      aria-hidden="true"
    />
  );
}

function WashiTape({ top, left, right, rotation = 0, color = "pink", width = 120 }) {
  return (
    <div
      className={`sb-tape sb-tape-${color}`}
      style={{ top, left, right, width, transform: `rotate(${rotation}deg)` }}
      aria-hidden="true"
    />
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */

export default function LandingScrapbook() {
  const [year] = useState(() => new Date().getFullYear());
  const fontInjected = useRef(false);

  useEffect(() => {
    if (fontInjected.current) return;
    fontInjected.current = true;
    if (!document.querySelector('link[data-sb-font="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      link.setAttribute("data-sb-font", "1");
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="sb-root">
      <style>{SB_STYLES}</style>

      {/* Notebook page background — rules + red margin */}
      <div className="sb-paper" aria-hidden="true">
        <div className="sb-margin" />
      </div>

      {/* ── Top sticky note ────────────────────────────────────────── */}
      <div className="sb-pinned-bar">
        <div className="sb-pinned-note">
          <HandStar size={14} color="var(--sb-red)" />
          <span>Free forever — pinned to the corkboard</span>
          <HandStar size={14} color="var(--sb-red)" />
        </div>
      </div>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="sb-header">
        <div className="sb-container sb-header-row">
          <Link to="/" className="sb-brand">
            <span className="sb-brand-mark">S.</span>
            <span className="sb-brand-name">SanoPOS</span>
            <span className="sb-brand-tag">— a shopkeeper's daybook</span>
          </Link>
          <nav className="sb-nav">
            <a href="#daybook">Daybook</a>
            <a href="#plans">Plans</a>
            <a href="#field">Field</a>
            <Link to="/login" className="sb-nav-cta">
              <span>Sign in</span>
              <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
                <path d="M 1 6 L 13 6 M 9 2 L 13 6 L 9 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero — notebook page with sticky notes ─────────────────── */}
      <section className="sb-hero">
        <div className="sb-container sb-hero-inner">
          <CoffeeRing top="20px" left="68%" size={110} opacity={0.18} />

          <div className="sb-eyebrow">
            <Squiggle color="var(--sb-red-soft)" />
            <span>Spring · 2026 · Lahore</span>
            <Squiggle color="var(--sb-red-soft)" />
          </div>

          <h1 className="sb-hero-title">
            <span className="sb-h-line">A shopkeeper's</span>
            <span className="sb-h-line">
              <HighlightStroke color="var(--sb-yellow-hl)">daybook</HighlightStroke>,
            </span>
            <span className="sb-h-line">
              <span className="sb-marker">that&nbsp;rings up sales.</span>
            </span>
          </h1>

          <Underline wobble={1.2} width="220px" />

          <p className="sb-lede">
            SanoPOS is the back-office and counter system for Pakistani retailers.
            <strong> Free, forever, for the first shop.</strong> FBR-ready, offline-tolerant,
            sixty-seven reports, and the books — all in one window. No card.
            No trial. No locks.
          </p>

          <div className="sb-cta-row">
            <Link to="/signup" className="sb-cta-primary">
              <span>Open a free shop</span>
              <span className="sb-cta-arrow" aria-hidden="true">→</span>
            </Link>
            <div className="sb-cta-arrow-doodle" aria-hidden="true">
              <HandArrow rotation={-15} scale={0.85} color="var(--sb-red)" />
              <span className="sb-cta-arrow-label">— it's really free!</span>
            </div>
            <Link to="/login" className="sb-cta-quiet">
              I have a shop · Sign in
            </Link>
          </div>

          <div className="sb-fineprint">
            <span className="sb-fine-marker">★</span>
            Free <em>= 1 outlet · 3 staff · 100 products</em>
            <span className="sb-fine-marker">·</span>
            Pro <em>= ₨ 8,000 / month / outlet</em>
            <span className="sb-fine-marker">★</span>
          </div>

          {/* Sticky-note pinned to the page */}
          <aside className="sb-sticky sb-sticky-yellow sb-sticky-hero">
            <div className="sb-sticky-tape" aria-hidden="true" />
            <div className="sb-sticky-doodle" aria-hidden="true">
              <HandStar size={16} color="var(--sb-red)" />
            </div>
            <p className="sb-sticky-text">
              <em>Free</em> isn't a trial.<br />
              It stays free.<br />
              <span>— promise!</span>
            </p>
          </aside>
        </div>
      </section>

      {/* ── A note from the desk (philosophy) ──────────────────────── */}
      <section className="sb-note">
        <div className="sb-container">
          <div className="sb-note-paper">
            <WashiTape top="-14px" left="40%" rotation={-4} color="pink" width={100} />
            <div className="sb-note-head">
              <span className="sb-note-from">— a note from the desk</span>
              <span className="sb-note-date">apr · 2026</span>
            </div>
            <p className="sb-note-body">
              We watched, for some years, small retailers in Pakistan paying month
              upon month for software that asked more of them than it gave.
              <em> SanoPOS</em> is the reply to a question we kept hearing in side
              conversations: <strong>could the books, the counter, and the law be
              kept in one window — and could the price be honest?</strong>
            </p>
            <div className="sb-note-sign">
              <span>— with love from</span>
              <span className="sb-note-name">the SanoPOS desk</span>
              <span>·</span>
              <span>Lahore</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Daybook entries (features as scrapbook cards) ──────────── */}
      <section className="sb-daybook" id="daybook">
        <div className="sb-container">
          <header className="sb-section-head">
            <div className="sb-section-eyebrow">
              <Squiggle color="var(--sb-red-soft)" />
              <span>— pages from the daybook —</span>
              <Squiggle color="var(--sb-red-soft)" />
            </div>
            <h2 className="sb-section-title">
              <span className="sb-marker">Six things</span> on every plan.
            </h2>
            <p className="sb-section-sub">
              Free or Pro, same software. Every line below is yours from the first
              sign-in.
            </p>
          </header>

          <div className="sb-cards">
            {DAYBOOK_ENTRIES.map((e, i) => (
              <article
                className={`sb-card sb-card-${e.color}`}
                key={i}
                style={{ "--tilt": `${e.tilt}deg` }}
              >
                <div className="sb-card-tape" aria-hidden="true" />
                <div className="sb-card-num">№ {String(i + 1).padStart(2, "0")}</div>
                <h3 className="sb-card-title">{e.title}</h3>
                <Underline wobble={0.8} width="80px" color="var(--sb-red)" />
                <p className="sb-card-body">{e.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Plans (two notebook pages) ─────────────────────────────── */}
      <section className="sb-plans" id="plans">
        <div className="sb-container">
          <header className="sb-section-head">
            <div className="sb-section-eyebrow">
              <Squiggle color="var(--sb-red-soft)" />
              <span>— two pages, two plans —</span>
              <Squiggle color="var(--sb-red-soft)" />
            </div>
            <h2 className="sb-section-title">
              Free is <span className="sb-marker">forever</span>.<br />
              Pro is <em>per outlet</em>.
            </h2>
          </header>

          <div className="sb-plans-grid">
            <article className="sb-plan">
              <WashiTape top="-12px" left="32%" rotation={-3} color="yellow" width={140} />
              <div className="sb-plan-head">
                <span className="sb-plan-tab">— plan one —</span>
                <h3 className="sb-plan-name">Free</h3>
                <p className="sb-plan-tagline">For shops finding their feet.</p>
              </div>
              <div className="sb-plan-rule">
                <Squiggle color="var(--sb-ink-soft)" />
              </div>
              <div className="sb-plan-price">
                <span className="sb-plan-cur">₨</span>
                <span className="sb-plan-num">0</span>
                <div className="sb-plan-cad">
                  <em>forever</em>
                  <span>not a trial.</span>
                </div>
              </div>
              <div className="sb-plan-rule">
                <Squiggle color="var(--sb-ink-soft)" />
              </div>
              <ul className="sb-plan-list">
                <li><HandCheck /> One outlet</li>
                <li><HandCheck /> Up to three staff</li>
                <li><HandCheck /> Up to one hundred products</li>
                <li><HandCheck /> Every retail feature, no locks</li>
                <li><HandCheck /> FBR digital invoicing</li>
                <li><HandCheck /> Offline sale queue</li>
                <li><HandCheck /> Community support</li>
              </ul>
              <Link to="/signup" className="sb-plan-cta sb-plan-cta-quiet">
                Open free shop
                <span aria-hidden="true">→</span>
              </Link>
            </article>

            <article className="sb-plan sb-plan-feature">
              <WashiTape top="-12px" left="34%" rotation={3} color="pink" width={140} />
              <div className="sb-plan-ribbon">
                <HandStar color="var(--sb-red)" size={14} />
                <span>for shops with scale</span>
                <HandStar color="var(--sb-red)" size={14} />
              </div>
              <div className="sb-plan-head">
                <span className="sb-plan-tab">— plan two —</span>
                <h3 className="sb-plan-name"><em>Pro</em></h3>
                <p className="sb-plan-tagline">When you've outgrown the Free plan.</p>
              </div>
              <div className="sb-plan-rule">
                <Squiggle color="var(--sb-ink-soft)" />
              </div>
              <div className="sb-plan-price">
                <span className="sb-plan-cur">₨</span>
                <span className="sb-plan-num sb-plan-num-feature">8,000</span>
                <div className="sb-plan-cad">
                  <em>/ month</em>
                  <span>per outlet.</span>
                </div>
              </div>
              <div className="sb-plan-rule">
                <Squiggle color="var(--sb-ink-soft)" />
              </div>
              <ul className="sb-plan-list">
                <li><HandCheck /> Unlimited staff</li>
                <li><HandCheck /> Unlimited products</li>
                <li><HandCheck /> Multi-outlet + transfers</li>
                <li><HandCheck /> Context-aware pricing</li>
                <li><HandCheck /> AI insights panel</li>
                <li><HandCheck /> Email + WhatsApp support</li>
                <li><HandCheck /> Cancel from the dashboard</li>
              </ul>
              <Link to="/signup" className="sb-plan-cta">
                Begin on Free, upgrade later
                <span aria-hidden="true">→</span>
              </Link>
              <p className="sb-plan-foot">
                <em>p.s.</em> add additional outlets one at a time, from <span>/billing</span>.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ── Couriers as corkboard sticky notes ──────────────────────── */}
      <section className="sb-couriers" id="field">
        <div className="sb-container">
          <header className="sb-section-head">
            <div className="sb-section-eyebrow">
              <Squiggle color="var(--sb-red-soft)" />
              <span>— pinned to the corkboard —</span>
              <Squiggle color="var(--sb-red-soft)" />
            </div>
            <h2 className="sb-section-title">
              <em>Thirteen couriers,</em> wired in.
            </h2>
            <p className="sb-section-sub">
              Label printing, tracking, COD reconciliation — all from inside the dashboard.
            </p>
          </header>

          <div className="sb-courier-board">
            <CoffeeRing top="-12px" left="58%" size={70} opacity={0.18} />
            {COURIERS.map((c, i) => (
              <span
                key={c.c}
                className={`sb-courier sb-courier-${c.color}`}
                style={{ "--tilt": `${c.tilt}deg` }}
              >
                <span className="sb-courier-pin" aria-hidden="true" />
                {c.c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonial — polaroid + handwritten card ──────────────── */}
      <section className="sb-quote">
        <div className="sb-container">
          <div className="sb-quote-grid">
            <div className="sb-polaroid">
              <WashiTape top="-12px" left="-12px" rotation={-12} color="blue" width={70} />
              <WashiTape top="-12px" right="-8px" rotation={14} color="yellow" width={70} />
              <div className="sb-polaroid-photo">
                <div className="sb-polaroid-shop">
                  <div className="sb-polaroid-bldg" aria-hidden="true" />
                  <div className="sb-polaroid-sign">KHAADI · LAHORE</div>
                </div>
              </div>
              <p className="sb-polaroid-cap">— bilal's outlet, gulberg, '26</p>
            </div>

            <div className="sb-quote-card">
              <CoffeeRing top="20px" left="80%" size={66} opacity={0.18} />
              <div className="sb-quote-tag">— a field report</div>
              <blockquote className="sb-quote-text">
                "We had been paying a Karachi vendor by the feature.
                SanoPOS gave us FBR, multi-outlet, and the books{" "}
                <HighlightStroke color="var(--sb-yellow-hl)">on the first day</HighlightStroke>.
                Closing used to take a Saturday. It now takes an hour."
              </blockquote>
              <Underline wobble={1} width="180px" />
              <div className="sb-quote-attr">
                <strong>— Bilal A.</strong>
                <span>three-outlet apparel chain</span>
                <span>·</span>
                <span>Lahore</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Coming soon as sticky stack ────────────────────────────── */}
      <section className="sb-soon">
        <div className="sb-container">
          <header className="sb-section-head">
            <div className="sb-section-eyebrow">
              <Squiggle color="var(--sb-red-soft)" />
              <span>— shipping later this year —</span>
              <Squiggle color="var(--sb-red-soft)" />
            </div>
            <h2 className="sb-section-title">
              <em>Retail today.</em><br />
              The rest, <span className="sb-marker">on the way.</span>
            </h2>
            <p className="sb-section-sub">
              Public launch is for retail. Other presets are already painted in
              the back office, opening in waves.
            </p>
          </header>
          <div className="sb-soon-grid">
            {COMING_SOON.map((it, i) => (
              <div
                key={it}
                className={`sb-soon-card sb-soon-${["yellow", "pink", "blue"][i % 3]}`}
                style={{ "--tilt": `${[(-2.4), 1.6, -1.8, 2.2, -1.5, 1.4][i]}deg` }}
              >
                <span className="sb-soon-pin" aria-hidden="true" />
                <span className="sb-soon-name">{it}</span>
                <span className="sb-soon-tag">in preview</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── End CTA ────────────────────────────────────────────────── */}
      <section className="sb-end">
        <div className="sb-container sb-end-inner">
          <CoffeeRing top="40px" left="14%" size={70} opacity={0.16} />
          <CoffeeRing top="80px" left="78%" size={90} opacity={0.18} />
          <div className="sb-end-doodle" aria-hidden="true">
            <HandArrow rotation={20} scale={1.1} color="var(--sb-red)" />
          </div>
          <h2 className="sb-end-title">
            Open a <span className="sb-marker">free</span> shop.
          </h2>
          <p className="sb-end-sub">
            Five minutes. An email to confirm. Your shop, ringing up sales tonight.
          </p>
          <div className="sb-cta-row sb-cta-center">
            <Link to="/signup" className="sb-cta-primary sb-cta-large">
              <span>Begin</span>
              <span className="sb-cta-arrow" aria-hidden="true">→</span>
            </Link>
            <Link to="/login" className="sb-cta-quiet">
              I already have an account
            </Link>
          </div>
          <p className="sb-end-fine">
            <em>p.s.</em> this whole page was made by hand in Lahore. <span>thanks for reading.</span>
          </p>
        </div>
      </section>

      {/* ── Footer (back of the notebook) ──────────────────────────── */}
      <footer className="sb-foot">
        <div className="sb-container">
          <div className="sb-foot-rule">
            <Squiggle color="var(--sb-ink-soft)" />
          </div>
          <div className="sb-foot-grid">
            <div>
              <div className="sb-foot-h">— back-of-the-book —</div>
              <p>
                Set in <em>Caveat</em>, <em>Patrick Hand</em>, <em>Permanent Marker</em>,
                and <em>Reenie Beanie</em>. Drawn by hand in Lahore.
              </p>
              <p><strong>SanoPOS</strong> is a registered product of Sano Merchandise.</p>
            </div>
            <div>
              <div className="sb-foot-h">— pages —</div>
              <ul>
                <li><a href="#daybook">Daybook</a></li>
                <li><a href="#plans">Plans</a></li>
                <li><a href="#field">Field</a></li>
              </ul>
            </div>
            <div>
              <div className="sb-foot-h">— desk —</div>
              <ul>
                <li><Link to="/login">Sign in</Link></li>
                <li><Link to="/signup">Open an account</Link></li>
                <li><Link to="/terms">Terms</Link></li>
                <li><Link to="/privacy">Privacy</Link></li>
              </ul>
            </div>
            <div>
              <div className="sb-foot-h">— edition —</div>
              <p>
                Spring · 2026 · Lahore<br />
                © {year} Sano Merchandise.<br />
                <span className="sb-foot-mark">★ ★ ★</span>
              </p>
            </div>
          </div>
          <p className="sb-foot-tail">
            <span>★</span>&nbsp; thanks for thumbing through &nbsp;<span>★</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ─── Stylesheet ─────────────────────────────────────────────────────────── */

const SB_STYLES = `
.sb-root {
  --sb-cream: #FBF7EC;
  --sb-cream-2: #F4EAD5;
  --sb-paper: #FFFCF3;
  --sb-rule: #BFD2EE;
  --sb-rule-soft: #D9E5F4;
  --sb-margin: #E8A3A3;
  --sb-ink: #1C2845;
  --sb-ink-2: #36456B;
  --sb-ink-soft: #6B7891;
  --sb-red: #D14E3D;
  --sb-red-soft: #E8867A;
  --sb-yellow: #FFEB99;
  --sb-yellow-hl: rgba(248, 216, 92, 0.55);
  --sb-pink: #FFB8C8;
  --sb-blue: #A8D5E2;
  --sb-tape-pink: #F4B6C8;
  --sb-tape-blue: #A0CFE8;
  --sb-tape-yellow: #F8DD84;

  --hand: "Caveat", cursive;
  --print: "Patrick Hand", cursive;
  --print-sc: "Patrick Hand SC", cursive;
  --marker: "Permanent Marker", cursive;
  --marg: "Reenie Beanie", cursive;

  background: var(--sb-cream);
  color: var(--sb-ink);
  font-family: var(--print);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
  overflow-x: hidden;
  font-size: 17px;
  line-height: 1.55;
  position: relative;
}

/* paper grain */
.sb-root::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.06;
  z-index: 1;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  mix-blend-mode: multiply;
}

/* notebook paper rules + red margin */
.sb-paper {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image: repeating-linear-gradient(
    transparent 0px,
    transparent 31px,
    var(--sb-rule-soft) 31px,
    var(--sb-rule-soft) 32px
  );
  opacity: 0.5;
}
.sb-margin {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 80px;
  width: 1.5px;
  background: var(--sb-margin);
  opacity: 0.55;
}
@media (max-width: 720px) { .sb-margin { left: 30px; } }

.sb-root > *:not(.sb-paper) { position: relative; z-index: 2; }

.sb-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 36px;
}
@media (max-width: 720px) { .sb-container { padding: 0 22px; } }

/* ── Coffee rings ───────────────────────────────────────────────────── */
.sb-coffee {
  position: absolute;
  border-radius: 50%;
  background:
    radial-gradient(circle at center,
      transparent 50%,
      rgba(139, 90, 60, 0.65) 51%,
      rgba(139, 90, 60, 0.35) 56%,
      transparent 60%),
    radial-gradient(circle at 35% 40%,
      transparent 70%,
      rgba(139, 90, 60, 0.18) 75%,
      transparent 90%);
  pointer-events: none;
  z-index: 1;
}

/* ── Washi tape ─────────────────────────────────────────────────────── */
.sb-tape {
  position: absolute;
  height: 22px;
  pointer-events: none;
  z-index: 4;
  box-shadow: 0 2px 6px rgba(28, 40, 69, 0.18);
  border-left: 1px dashed rgba(0,0,0,0.10);
  border-right: 1px dashed rgba(0,0,0,0.10);
}
.sb-tape-pink {
  background: var(--sb-tape-pink);
  background-image: repeating-linear-gradient(45deg,
    var(--sb-tape-pink) 0 8px, rgba(255,255,255,0.4) 8px 12px);
  opacity: 0.85;
}
.sb-tape-blue {
  background: var(--sb-tape-blue);
  background-image: repeating-linear-gradient(135deg,
    var(--sb-tape-blue) 0 8px, rgba(255,255,255,0.4) 8px 12px);
  opacity: 0.85;
}
.sb-tape-yellow {
  background: var(--sb-tape-yellow);
  background-image: repeating-linear-gradient(45deg,
    var(--sb-tape-yellow) 0 6px, rgba(255,255,255,0.5) 6px 10px);
  opacity: 0.85;
}

/* ── Hand-drawn primitives ──────────────────────────────────────────── */
.sb-underline { display: block; margin: 4px auto; height: 12px; }
.sb-squig { width: 240px; height: 12px; opacity: 0.5; }
.sb-hl {
  background: linear-gradient(180deg, transparent 30%, var(--sb-hl, var(--sb-yellow-hl)) 30%, var(--sb-hl, var(--sb-yellow-hl)) 88%, transparent 88%);
  padding: 0 6px;
  display: inline;
  border-radius: 2px;
}
.sb-marker {
  font-family: var(--marker);
  font-weight: 400;
  color: var(--sb-red);
  letter-spacing: 0.005em;
}

/* ── Pinned bar ─────────────────────────────────────────────────────── */
.sb-pinned-bar {
  display: flex;
  justify-content: center;
  padding: 22px 0 0;
}
.sb-pinned-note {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: var(--sb-yellow);
  font-family: var(--hand);
  font-size: 18px;
  color: var(--sb-ink);
  padding: 8px 22px 10px;
  transform: rotate(-1deg);
  box-shadow: 0 4px 10px rgba(28, 40, 69, 0.12);
  position: relative;
}
.sb-pinned-note::before, .sb-pinned-note::after {
  content: "";
  position: absolute;
  top: -10px;
  width: 30px;
  height: 16px;
  background: var(--sb-tape-pink);
  background-image: repeating-linear-gradient(45deg,
    var(--sb-tape-pink) 0 6px, rgba(255,255,255,0.5) 6px 9px);
  opacity: 0.85;
  box-shadow: 0 2px 4px rgba(28,40,69,0.18);
}
.sb-pinned-note::before { left: 12%; transform: rotate(-12deg); }
.sb-pinned-note::after { right: 12%; transform: rotate(8deg); }

/* ── Header ─────────────────────────────────────────────────────────── */
.sb-header { padding: 22px 0 18px; }
.sb-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.sb-brand { display: inline-flex; align-items: baseline; gap: 8px; text-decoration: none; color: var(--sb-ink); }
.sb-brand-mark {
  font-family: var(--marker);
  font-size: 32px;
  color: var(--sb-red);
  line-height: 1;
}
.sb-brand-name {
  font-family: var(--hand);
  font-weight: 700;
  font-size: 30px;
  color: var(--sb-ink);
  letter-spacing: 0.005em;
  line-height: 1;
}
.sb-brand-tag {
  font-family: var(--marg);
  font-size: 18px;
  color: var(--sb-ink-soft);
  margin-left: 4px;
}
.sb-nav { display: flex; align-items: center; gap: 26px; }
.sb-nav a {
  font-family: var(--hand);
  font-weight: 600;
  font-size: 20px;
  color: var(--sb-ink);
  text-decoration: none;
  transition: color 0.15s;
  position: relative;
}
.sb-nav a:hover { color: var(--sb-red); }
.sb-nav a:not(.sb-nav-cta)::after {
  content: "";
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 0;
  height: 2px;
  background: var(--sb-red);
  border-radius: 2px;
  transition: width 0.25s;
}
.sb-nav a:not(.sb-nav-cta):hover::after { width: 100%; }
.sb-nav-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--sb-ink) !important;
  color: var(--sb-cream) !important;
  padding: 8px 18px;
  border-radius: 999px;
  transition: background 0.18s;
  box-shadow: 2px 3px 0 var(--sb-red);
}
.sb-nav-cta:hover { background: var(--sb-red) !important; box-shadow: 2px 3px 0 var(--sb-ink); }
@media (max-width: 720px) {
  .sb-nav { gap: 14px; }
  .sb-nav a:not(.sb-nav-cta) { display: none; }
  .sb-brand-tag { display: none; }
}

/* ── Hero ───────────────────────────────────────────────────────────── */
.sb-hero { padding: 64px 0 96px; position: relative; }
.sb-hero-inner { position: relative; max-width: 880px; }
.sb-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-family: var(--marg);
  font-size: 22px;
  color: var(--sb-red);
  margin-bottom: 22px;
}
.sb-eyebrow .sb-squig { width: 60px; }

.sb-hero-title {
  font-family: var(--hand);
  font-weight: 700;
  font-size: clamp(54px, 9vw, 124px);
  line-height: 0.92;
  letter-spacing: -0.005em;
  color: var(--sb-ink);
  margin: 0 0 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sb-h-line { display: inline-block; }
.sb-hero-title .sb-marker {
  font-size: 0.92em;
  letter-spacing: -0.01em;
  display: inline-block;
  padding: 0 4px;
}

.sb-lede {
  font-family: var(--print);
  font-size: clamp(18px, 1.5vw, 22px);
  line-height: 1.6;
  color: var(--sb-ink);
  max-width: 680px;
  margin: 22px 0 30px;
  letter-spacing: 0.005em;
}
.sb-lede strong {
  font-family: var(--hand);
  font-weight: 700;
  color: var(--sb-red);
  font-size: 1.05em;
}

.sb-cta-row {
  display: flex;
  gap: 24px;
  align-items: center;
  flex-wrap: wrap;
}
.sb-cta-center { justify-content: center; }

.sb-cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-family: var(--hand);
  font-weight: 700;
  font-size: 24px;
  color: var(--sb-cream);
  background: var(--sb-ink);
  padding: 14px 28px 16px;
  text-decoration: none;
  border-radius: 36px;
  transition: all 0.2s;
  box-shadow: 4px 4px 0 var(--sb-red);
  letter-spacing: 0.01em;
}
.sb-cta-large { font-size: 28px; padding: 18px 36px 20px; }
.sb-cta-primary:hover {
  background: var(--sb-red);
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0 var(--sb-ink);
}
.sb-cta-arrow {
  display: inline-block;
  font-family: var(--hand);
  transition: transform 0.2s;
}
.sb-cta-primary:hover .sb-cta-arrow { transform: translateX(4px); }

.sb-cta-arrow-doodle {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sb-cta-arrow-label {
  font-family: var(--marg);
  font-size: 22px;
  color: var(--sb-red);
}

.sb-cta-quiet {
  font-family: var(--hand);
  font-weight: 600;
  font-size: 22px;
  color: var(--sb-ink-2);
  text-decoration: none;
  border-bottom: 2px dashed var(--sb-ink-soft);
  padding: 0 4px 2px;
  transition: all 0.2s;
}
.sb-cta-quiet:hover {
  color: var(--sb-red);
  border-bottom-color: var(--sb-red);
}

.sb-fineprint {
  margin-top: 32px;
  font-family: var(--marg);
  font-size: 22px;
  color: var(--sb-ink-2);
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.sb-fineprint span:first-letter { color: var(--sb-red); }
.sb-fineprint em {
  font-family: var(--print);
  font-style: italic;
  font-size: 17px;
  color: var(--sb-ink);
}
.sb-fine-marker { color: var(--sb-red); }

/* Sticky note pinned to hero */
.sb-sticky-hero {
  position: absolute;
  top: 56px;
  right: -40px;
  width: 180px;
}
@media (max-width: 980px) {
  .sb-sticky-hero { position: static; margin-top: 28px; right: 0; }
}
.sb-sticky {
  position: relative;
  padding: 22px 18px 18px;
  transform: rotate(4deg);
  box-shadow: 4px 6px 12px rgba(28, 40, 69, 0.14);
  font-family: var(--hand);
  font-size: 20px;
  line-height: 1.4;
  color: var(--sb-ink);
}
.sb-sticky-yellow { background: var(--sb-yellow); }
.sb-sticky-pink { background: var(--sb-pink); }
.sb-sticky-blue { background: var(--sb-blue); }
.sb-sticky-tape {
  position: absolute;
  top: -10px;
  left: 30%;
  width: 60px;
  height: 18px;
  background: var(--sb-tape-pink);
  background-image: repeating-linear-gradient(45deg,
    var(--sb-tape-pink) 0 8px, rgba(255,255,255,0.5) 8px 12px);
  transform: rotate(-6deg);
  box-shadow: 0 2px 4px rgba(28,40,69,0.18);
  opacity: 0.85;
}
.sb-sticky-doodle { position: absolute; top: 8px; right: 12px; }
.sb-sticky-text { margin: 0; }
.sb-sticky-text em {
  font-family: var(--marker);
  color: var(--sb-red);
  font-style: normal;
  font-size: 1.15em;
}
.sb-sticky-text span {
  font-family: var(--marg);
  font-size: 18px;
  color: var(--sb-ink-2);
  display: block;
  margin-top: 6px;
}

/* ── Note from the desk ─────────────────────────────────────────────── */
.sb-note { padding: 64px 0; }
.sb-note-paper {
  background: var(--sb-paper);
  padding: 36px 40px 30px;
  max-width: 760px;
  margin: 0 auto;
  position: relative;
  box-shadow: 0 8px 30px rgba(28,40,69,0.10), 0 2px 6px rgba(28,40,69,0.05);
  border: 1px solid rgba(28,40,69,0.06);
  transform: rotate(-0.6deg);
  background-image: repeating-linear-gradient(
    transparent 0px, transparent 27px,
    var(--sb-rule-soft) 27px, var(--sb-rule-soft) 28px
  );
  background-size: 100% 28px;
  background-position: 0 18px;
}
.sb-note-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 14px;
}
.sb-note-from {
  font-family: var(--marg);
  font-size: 26px;
  color: var(--sb-red);
}
.sb-note-date {
  font-family: var(--marg);
  font-size: 20px;
  color: var(--sb-ink-soft);
}
.sb-note-body {
  font-family: var(--hand);
  font-size: 22px;
  line-height: 1.55;
  color: var(--sb-ink);
  margin: 0 0 22px;
}
.sb-note-body em { font-family: var(--marker); font-size: 1.08em; color: var(--sb-red); font-style: normal; }
.sb-note-body strong {
  font-family: var(--hand);
  font-weight: 700;
  color: var(--sb-ink);
  background: linear-gradient(180deg, transparent 60%, var(--sb-yellow-hl) 60%, var(--sb-yellow-hl) 92%, transparent 92%);
  padding: 0 4px;
}
.sb-note-sign {
  font-family: var(--marg);
  font-size: 22px;
  color: var(--sb-ink-2);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}
.sb-note-name { color: var(--sb-red); }

/* ── Section heads ──────────────────────────────────────────────────── */
.sb-section-head { text-align: center; margin-bottom: 56px; }
.sb-section-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--marg);
  font-size: 22px;
  color: var(--sb-red);
  margin-bottom: 14px;
}
.sb-section-eyebrow .sb-squig { width: 50px; }
.sb-section-title {
  font-family: var(--hand);
  font-weight: 700;
  font-size: clamp(40px, 5.4vw, 72px);
  letter-spacing: -0.005em;
  line-height: 1.05;
  color: var(--sb-ink);
  margin: 0 0 16px;
}
.sb-section-title em {
  font-family: var(--print);
  font-style: italic;
  color: var(--sb-red);
}
.sb-section-title .sb-marker { font-size: 0.9em; padding: 0 4px; }
.sb-section-sub {
  font-family: var(--print);
  font-size: 19px;
  color: var(--sb-ink-2);
  max-width: 580px;
  margin: 0 auto;
  line-height: 1.55;
}

/* ── Daybook cards ──────────────────────────────────────────────────── */
.sb-daybook { padding: 80px 0 96px; }
.sb-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
}
@media (max-width: 880px) { .sb-cards { grid-template-columns: repeat(2, 1fr); gap: 24px; } }
@media (max-width: 540px) { .sb-cards { grid-template-columns: 1fr; } }

.sb-card {
  position: relative;
  padding: 32px 28px 28px;
  transform: rotate(var(--tilt, 0deg));
  box-shadow: 4px 6px 14px rgba(28,40,69,0.12);
  transition: all 0.3s ease;
  min-height: 220px;
}
.sb-card:hover { transform: rotate(0deg) translateY(-4px); box-shadow: 6px 10px 20px rgba(28,40,69,0.16); }
.sb-card-yellow { background: var(--sb-yellow); }
.sb-card-pink { background: var(--sb-pink); }
.sb-card-blue { background: var(--sb-blue); }
.sb-card-tape {
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%) rotate(-3deg);
  width: 70px;
  height: 18px;
  background: var(--sb-tape-yellow);
  background-image: repeating-linear-gradient(45deg,
    var(--sb-tape-yellow) 0 8px, rgba(255,255,255,0.5) 8px 12px);
  opacity: 0.85;
  box-shadow: 0 2px 4px rgba(28,40,69,0.18);
}
.sb-card-pink .sb-card-tape { background: var(--sb-tape-blue); background-image: repeating-linear-gradient(135deg, var(--sb-tape-blue) 0 8px, rgba(255,255,255,0.5) 8px 12px); }
.sb-card-blue .sb-card-tape { background: var(--sb-tape-pink); background-image: repeating-linear-gradient(45deg, var(--sb-tape-pink) 0 8px, rgba(255,255,255,0.5) 8px 12px); }

.sb-card-num {
  font-family: var(--marker);
  font-size: 16px;
  color: var(--sb-red);
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}
.sb-card-title {
  font-family: var(--hand);
  font-weight: 700;
  font-size: 30px;
  margin: 0 0 4px;
  color: var(--sb-ink);
  letter-spacing: -0.005em;
  line-height: 1.05;
}
.sb-card-body {
  font-family: var(--print);
  font-size: 17px;
  line-height: 1.5;
  color: var(--sb-ink-2);
  margin: 14px 0 0;
}

/* ── Plans ──────────────────────────────────────────────────────────── */
.sb-plans { padding: 96px 0; }
.sb-plans-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 36px;
  margin-top: 32px;
}
@media (max-width: 880px) { .sb-plans-grid { grid-template-columns: 1fr; gap: 48px; } }

.sb-plan {
  background: var(--sb-paper);
  padding: 36px 36px 32px;
  position: relative;
  box-shadow: 4px 6px 16px rgba(28,40,69,0.12);
  transform: rotate(-0.4deg);
  background-image: repeating-linear-gradient(
    transparent 0px, transparent 27px,
    var(--sb-rule-soft) 27px, var(--sb-rule-soft) 28px
  );
  background-size: 100% 28px;
  background-position: 0 22px;
  border: 1px solid rgba(28,40,69,0.05);
  transition: all 0.3s;
}
.sb-plan:hover { transform: rotate(0deg) translateY(-4px); box-shadow: 6px 10px 22px rgba(28,40,69,0.18); }
.sb-plan-feature { transform: rotate(0.6deg); }

.sb-plan-ribbon {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  font-family: var(--marker);
  font-size: 14px;
  color: var(--sb-red);
  margin-bottom: 16px;
  letter-spacing: 0.04em;
}
.sb-plan-tab {
  font-family: var(--marg);
  font-size: 20px;
  color: var(--sb-ink-soft);
}
.sb-plan-name {
  font-family: var(--hand);
  font-weight: 700;
  font-size: clamp(56px, 7vw, 80px);
  line-height: 1;
  margin: 4px 0 6px;
  color: var(--sb-ink);
  letter-spacing: -0.01em;
}
.sb-plan-name em {
  font-family: var(--marker);
  color: var(--sb-red);
  font-style: normal;
  font-size: 0.95em;
}
.sb-plan-tagline {
  font-family: var(--print);
  font-size: 17px;
  color: var(--sb-ink-2);
  margin: 0;
  font-style: italic;
}
.sb-plan-rule { margin: 18px 0; }
.sb-plan-rule .sb-squig { width: 100%; height: 12px; opacity: 0.45; }

.sb-plan-price {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.sb-plan-cur {
  font-family: var(--hand);
  font-size: 32px;
  color: var(--sb-ink-2);
}
.sb-plan-num {
  font-family: var(--marker);
  font-size: clamp(64px, 8vw, 100px);
  color: var(--sb-ink);
  line-height: 1;
  letter-spacing: -0.02em;
}
.sb-plan-num-feature { color: var(--sb-red); }
.sb-plan-cad {
  margin-left: auto;
  text-align: right;
  font-family: var(--hand);
  font-size: 20px;
  color: var(--sb-ink-2);
  line-height: 1.3;
}
.sb-plan-cad em {
  display: block;
  color: var(--sb-red);
  font-style: normal;
  font-weight: 700;
  font-size: 22px;
}
.sb-plan-cad span {
  font-family: var(--marg);
  font-size: 18px;
  color: var(--sb-ink-soft);
}

.sb-plan-list {
  list-style: none;
  padding: 0;
  margin: 0 0 28px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sb-plan-list li {
  font-family: var(--hand);
  font-weight: 500;
  font-size: 21px;
  color: var(--sb-ink);
  display: flex;
  align-items: center;
  gap: 12px;
  letter-spacing: 0.005em;
}

.sb-plan-cta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--hand);
  font-weight: 700;
  font-size: 22px;
  background: var(--sb-red);
  color: var(--sb-cream);
  padding: 12px 24px;
  border-radius: 30px;
  text-decoration: none;
  transition: all 0.2s;
  box-shadow: 3px 4px 0 var(--sb-ink);
}
.sb-plan-cta:hover {
  background: var(--sb-ink);
  transform: translate(-2px, -2px);
  box-shadow: 5px 6px 0 var(--sb-red);
}
.sb-plan-cta-quiet {
  background: var(--sb-ink);
  color: var(--sb-cream);
  box-shadow: 3px 4px 0 var(--sb-red);
}
.sb-plan-cta-quiet:hover {
  background: var(--sb-red);
  box-shadow: 5px 6px 0 var(--sb-ink);
}
.sb-plan-foot {
  font-family: var(--marg);
  font-size: 20px;
  color: var(--sb-ink-soft);
  margin: 14px 0 0;
}
.sb-plan-foot em { color: var(--sb-red); font-style: normal; }
.sb-plan-foot span {
  font-family: var(--print);
  font-style: italic;
  color: var(--sb-ink);
  font-size: 17px;
}

/* ── Couriers corkboard ─────────────────────────────────────────────── */
.sb-couriers { padding: 96px 0; }
.sb-courier-board {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
  padding: 36px;
  background:
    repeating-linear-gradient(45deg,
      rgba(180,140,90,0.08) 0 6px,
      rgba(180,140,90,0.04) 6px 12px),
    rgba(180,140,90,0.10);
  border-radius: 12px;
  box-shadow: inset 0 0 0 6px rgba(180,140,90,0.20),
              inset 0 0 0 8px rgba(120,80,40,0.30);
}
.sb-courier {
  position: relative;
  font-family: var(--hand);
  font-weight: 600;
  font-size: 22px;
  padding: 14px 22px 12px;
  transform: rotate(var(--tilt, 0deg));
  box-shadow: 3px 4px 8px rgba(28,40,69,0.20);
  transition: all 0.25s;
  color: var(--sb-ink);
  letter-spacing: 0.005em;
  cursor: default;
}
.sb-courier:hover { transform: rotate(0deg) translateY(-3px); box-shadow: 4px 8px 14px rgba(28,40,69,0.28); }
.sb-courier-yellow { background: var(--sb-yellow); }
.sb-courier-pink { background: var(--sb-pink); }
.sb-courier-blue { background: var(--sb-blue); }
.sb-courier-pin {
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 12px;
  height: 12px;
  background: radial-gradient(circle at 35% 30%, #FFB7B7 0%, var(--sb-red) 60%, #8A2A1F 100%);
  border-radius: 50%;
  box-shadow: 0 2px 3px rgba(28,40,69,0.30);
}

/* ── Quote / polaroid ───────────────────────────────────────────────── */
.sb-quote { padding: 96px 0; }
.sb-quote-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 56px;
  align-items: center;
  max-width: 920px;
  margin: 0 auto;
}
@media (max-width: 720px) { .sb-quote-grid { grid-template-columns: 1fr; gap: 40px; justify-items: center; } }

.sb-polaroid {
  position: relative;
  background: white;
  padding: 12px 12px 56px;
  box-shadow: 4px 6px 16px rgba(28,40,69,0.18);
  transform: rotate(-3deg);
  width: 240px;
}
.sb-polaroid-photo {
  width: 100%;
  aspect-ratio: 1;
  background: linear-gradient(180deg, #C3A98A 0%, #8B6F4E 100%);
  position: relative;
  overflow: hidden;
}
.sb-polaroid-shop {
  position: absolute;
  inset: 30% 15% 0;
  display: flex;
  flex-direction: column;
}
.sb-polaroid-bldg {
  flex: 1;
  background: linear-gradient(180deg, #5E3924 0%, #3D2316 100%);
  position: relative;
}
.sb-polaroid-bldg::before {
  content: "";
  position: absolute;
  inset: 30% 20% 30%;
  background: repeating-linear-gradient(90deg,
    #1F0E07 0 6px, transparent 6px 12px,
    #1F0E07 12px 18px, transparent 18px 24px);
}
.sb-polaroid-sign {
  position: absolute;
  top: 18%;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--marker);
  font-size: 14px;
  color: var(--sb-yellow);
  background: var(--sb-red);
  padding: 4px 10px;
  white-space: nowrap;
  letter-spacing: 0.04em;
  box-shadow: 0 2px 4px rgba(0,0,0,0.30);
}
.sb-polaroid-cap {
  font-family: var(--hand);
  font-size: 19px;
  color: var(--sb-ink-2);
  text-align: center;
  margin: 16px 0 0;
}

.sb-quote-card {
  position: relative;
  background: var(--sb-paper);
  padding: 28px 32px 26px;
  box-shadow: 0 4px 16px rgba(28,40,69,0.10);
  transform: rotate(0.8deg);
  background-image: repeating-linear-gradient(
    transparent 0px, transparent 27px,
    var(--sb-rule-soft) 27px, var(--sb-rule-soft) 28px
  );
  background-size: 100% 28px;
  background-position: 0 18px;
}
.sb-quote-tag {
  font-family: var(--marg);
  font-size: 22px;
  color: var(--sb-red);
  margin-bottom: 12px;
}
.sb-quote-text {
  font-family: var(--hand);
  font-weight: 500;
  font-size: clamp(22px, 2.4vw, 30px);
  line-height: 1.4;
  color: var(--sb-ink);
  margin: 0 0 12px;
}
.sb-quote-attr {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-family: var(--marg);
  font-size: 22px;
  color: var(--sb-ink-2);
  margin-top: 14px;
}
.sb-quote-attr strong { color: var(--sb-red); font-weight: 400; }

/* ── Coming soon ────────────────────────────────────────────────────── */
.sb-soon { padding: 96px 0; }
.sb-soon-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 22px;
  margin-top: 32px;
}
@media (max-width: 720px) { .sb-soon-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .sb-soon-grid { grid-template-columns: 1fr; } }
.sb-soon-card {
  position: relative;
  padding: 22px 22px 20px;
  text-align: center;
  transform: rotate(var(--tilt, 0deg));
  box-shadow: 3px 5px 10px rgba(28,40,69,0.14);
  transition: all 0.25s;
}
.sb-soon-card:hover { transform: rotate(0deg) translateY(-3px); box-shadow: 4px 8px 16px rgba(28,40,69,0.20); }
.sb-soon-yellow { background: var(--sb-yellow); }
.sb-soon-pink { background: var(--sb-pink); }
.sb-soon-blue { background: var(--sb-blue); }
.sb-soon-pin {
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 12px;
  height: 12px;
  background: radial-gradient(circle at 35% 30%, #FFB7B7 0%, var(--sb-red) 60%, #8A2A1F 100%);
  border-radius: 50%;
  box-shadow: 0 2px 3px rgba(28,40,69,0.30);
}
.sb-soon-name {
  display: block;
  font-family: var(--hand);
  font-weight: 700;
  font-size: 26px;
  color: var(--sb-ink);
  letter-spacing: -0.005em;
}
.sb-soon-tag {
  font-family: var(--marg);
  font-size: 19px;
  color: var(--sb-red);
  margin-top: 4px;
  display: block;
}

/* ── End CTA ────────────────────────────────────────────────────────── */
.sb-end {
  padding: 128px 0;
  text-align: center;
  position: relative;
}
.sb-end-inner { position: relative; max-width: 780px; margin: 0 auto; }
.sb-end-doodle {
  position: absolute;
  top: 30px;
  right: 12%;
}
@media (max-width: 720px) { .sb-end-doodle { display: none; } }
.sb-end-title {
  font-family: var(--hand);
  font-weight: 700;
  font-size: clamp(56px, 8vw, 104px);
  line-height: 1;
  margin: 0 0 18px;
  color: var(--sb-ink);
  letter-spacing: -0.005em;
}
.sb-end-title .sb-marker { font-size: 0.92em; padding: 0 6px; }
.sb-end-sub {
  font-family: var(--print);
  font-size: clamp(18px, 1.4vw, 22px);
  color: var(--sb-ink-2);
  margin: 0 0 36px;
}
.sb-end-fine {
  font-family: var(--marg);
  font-size: 22px;
  color: var(--sb-ink-soft);
  margin: 32px 0 0;
}
.sb-end-fine em { color: var(--sb-red); font-style: normal; }
.sb-end-fine span { color: var(--sb-ink); font-family: var(--hand); }

/* ── Footer ─────────────────────────────────────────────────────────── */
.sb-foot { padding: 56px 0 36px; }
.sb-foot-rule { margin-bottom: 24px; }
.sb-foot-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 32px;
  padding-bottom: 24px;
}
@media (max-width: 720px) { .sb-foot-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .sb-foot-grid { grid-template-columns: 1fr; } }
.sb-foot-h {
  font-family: var(--marg);
  font-size: 22px;
  color: var(--sb-red);
  margin-bottom: 12px;
}
.sb-foot p, .sb-foot ul {
  font-family: var(--hand);
  font-size: 19px;
  color: var(--sb-ink-2);
  line-height: 1.55;
  margin: 0 0 8px;
}
.sb-foot p em { font-family: var(--print); font-style: italic; color: var(--sb-ink); }
.sb-foot p strong { font-family: var(--hand); font-weight: 700; color: var(--sb-ink); }
.sb-foot ul { list-style: none; padding: 0; }
.sb-foot a {
  color: var(--sb-ink);
  text-decoration: none;
  border-bottom: 1.5px dashed var(--sb-ink-soft);
  transition: all 0.2s;
}
.sb-foot a:hover { color: var(--sb-red); border-bottom-color: var(--sb-red); }
.sb-foot-mark { color: var(--sb-red); }
.sb-foot-tail {
  text-align: center;
  font-family: var(--marg);
  font-size: 20px;
  color: var(--sb-ink-soft);
  margin: 18px 0 0;
}
.sb-foot-tail span { color: var(--sb-red); }

@media (prefers-reduced-motion: reduce) {
  .sb-card, .sb-plan, .sb-soon-card, .sb-courier { transition: none; }
}
`;
