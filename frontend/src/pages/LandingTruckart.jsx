import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Pakistani truck-art / chamak-patti landing — preview at /preview/landing-truckart
 *
 * Concept: SanoPOS as a hand-painted Pakistani truck panel. Saffron-cream
 * base, deep midnight painted-panel inserts, ruby/emerald/royal/mango/gold
 * accents, peacock and rosette motifs, animated chamak (shimmer) strips,
 * Urdu calligraphic flourishes. Ground truth from PRs 1–9.
 */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Rozha+One&family=Mirza:wght@400;500;600;700&family=Noto+Nastaliq+Urdu:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap";

const BLESSINGS = [
  "ماشاءاللہ",
  "SANOPOS",
  "MASHALLAH",
  "سنو پی او ایس",
  "RING IT UP",
  "خوش آمدید",
  "OPEN YOUR SHOP",
  "★ ★ ★",
];

const VIRTUES = [
  { color: "ruby", icon: "★", title: "Free", urdu: "مفت", note: "for-ever" },
  { color: "emerald", icon: "❀", title: "FBR", urdu: "ٹیکس", note: "real-time" },
  { color: "royal", icon: "❖", title: "Offline", urdu: "آف لائن", note: "safe" },
  { color: "mango", icon: "✦", title: "67+ Reports", urdu: "رپورٹس", note: "all included" },
  { color: "rose", icon: "✿", title: "13 Couriers", urdu: "کوریئر", note: "wired in" },
  { color: "gold", icon: "❋", title: "No Locks", urdu: "بے روک", note: "ever" },
];

const FEATURES = [
  ["Counter & receipts", "Barcode scan, split tender, returns & exchanges, customer-facing display"],
  ["Stock & movement", "Per-outlet stock, transfers, kits, serial tracking, dead-stock"],
  ["Purchasing", "PO with multi-level approvals, partial GRN, scanned receiving, supplier ledger"],
  ["Books, in window", "P&L, balance sheet, cash flow, journals, AP/AR, post-dated cheques"],
  ["Customer ledger", "Wallet, tiered loyalty, points transfer, RFM segmentation"],
  ["67+ reports", "Sales, stock, payroll, accounting. Plus an AI panel that answers in plain language"],
];

const COURIERS = [
  "Leopards", "TCS", "BlueEx", "Postex", "Trax", "Rider",
  "Swyft", "Bykea", "MNP", "Pakpost", "DHL", "FedEx", "CallCourier",
];

const COMING_SOON = [
  { en: "Salon & Spa", urdu: "بیوٹی پارلر" },
  { en: "Clinic & Pharmacy", urdu: "دواخانہ" },
  { en: "Restaurant & Café", urdu: "ریستوران" },
  { en: "Rentals", urdu: "کرایہ" },
  { en: "Education", urdu: "تعلیم" },
  { en: "Veterinary", urdu: "جانور خانہ" },
];

/* ─── SVG ornaments ─────────────────────────────────────────────────────── */

function Peacock({ flip = false, size = 100 }) {
  return (
    <svg
      viewBox="0 0 110 130"
      width={size}
      height={size * 1.18}
      style={{ transform: flip ? "scaleX(-1)" : "none" }}
      aria-hidden="true"
    >
      {/* Tail feathers — fan */}
      {[-30, -20, -10, 0, 10, 20, 30].map((deg, i) => (
        <g key={i} transform={`rotate(${deg} 55 90)`}>
          <path
            d="M 55 90 Q 55 30 55 12"
            stroke="var(--ta-emerald)"
            strokeWidth="2"
            fill="none"
          />
          <ellipse cx="55" cy="14" rx="5" ry="7" fill="var(--ta-royal)" />
          <ellipse cx="55" cy="14" rx="3" ry="4" fill="var(--ta-mango)" />
          <circle cx="55" cy="14" r="1.5" fill="var(--ta-ruby)" />
        </g>
      ))}
      {/* Body */}
      <ellipse cx="55" cy="92" rx="10" ry="14" fill="var(--ta-royal)" />
      <ellipse cx="55" cy="92" rx="6" ry="9" fill="var(--ta-emerald)" />
      {/* Neck */}
      <path d="M 55 80 Q 50 70 55 60" stroke="var(--ta-royal)" strokeWidth="6" fill="none" strokeLinecap="round" />
      {/* Head */}
      <circle cx="55" cy="58" r="6" fill="var(--ta-royal)" />
      {/* Eye */}
      <circle cx="56" cy="57" r="1.5" fill="var(--ta-gold)" />
      {/* Beak */}
      <path d="M 60 58 L 66 60 L 60 60 Z" fill="var(--ta-mango)" />
      {/* Crest */}
      <path d="M 55 52 L 53 46 M 55 52 L 55 44 M 55 52 L 57 46" stroke="var(--ta-gold)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="53" cy="45" r="1.5" fill="var(--ta-gold)" />
      <circle cx="55" cy="43" r="1.5" fill="var(--ta-gold)" />
      <circle cx="57" cy="45" r="1.5" fill="var(--ta-gold)" />
      {/* Legs */}
      <line x1="51" y1="105" x2="49" y2="118" stroke="var(--ta-mango)" strokeWidth="2" strokeLinecap="round" />
      <line x1="59" y1="105" x2="61" y2="118" stroke="var(--ta-mango)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Rosette({ size = 60, color = "ta-gold" }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      {[0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5].map((deg) => (
        <ellipse
          key={deg}
          cx="50"
          cy="50"
          rx="6"
          ry="32"
          fill={`var(--${color})`}
          transform={`rotate(${deg} 50 50)`}
          opacity="0.85"
        />
      ))}
      <circle cx="50" cy="50" r="14" fill="var(--ta-ruby)" />
      <circle cx="50" cy="50" r="7" fill="var(--ta-gold)" />
      <circle cx="50" cy="50" r="3" fill="var(--ta-midnight)" />
    </svg>
  );
}

function Lotus({ size = 80, palette = ["ta-rose", "ta-mango", "ta-gold"] }) {
  return (
    <svg viewBox="0 0 120 80" width={size} height={size * 0.67} aria-hidden="true">
      {/* Three lotus layers */}
      <path d="M 60 75 Q 20 50 30 20 Q 60 35 60 75" fill={`var(--${palette[0]})`} opacity="0.92" />
      <path d="M 60 75 Q 100 50 90 20 Q 60 35 60 75" fill={`var(--${palette[0]})`} opacity="0.92" />
      <path d="M 60 75 Q 35 45 45 18 Q 60 30 60 75" fill={`var(--${palette[1]})`} />
      <path d="M 60 75 Q 85 45 75 18 Q 60 30 60 75" fill={`var(--${palette[1]})`} />
      <path d="M 60 75 Q 60 40 60 14" stroke={`var(--${palette[2]})`} strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="60" cy="14" rx="6" ry="9" fill={`var(--${palette[2]})`} />
    </svg>
  );
}

function ScallopBorder({ flip = false, color = "ta-midnight" }) {
  return (
    <svg
      width="100%"
      height="32"
      viewBox="0 0 1200 32"
      preserveAspectRatio="none"
      style={{ transform: flip ? "rotate(180deg)" : "none", display: "block" }}
      aria-hidden="true"
    >
      <path
        d="M 0 0 L 0 16 Q 25 32 50 16 Q 75 0 100 16 Q 125 32 150 16 Q 175 0 200 16 Q 225 32 250 16 Q 275 0 300 16 Q 325 32 350 16 Q 375 0 400 16 Q 425 32 450 16 Q 475 0 500 16 Q 525 32 550 16 Q 575 0 600 16 Q 625 32 650 16 Q 675 0 700 16 Q 725 32 750 16 Q 775 0 800 16 Q 825 32 850 16 Q 875 0 900 16 Q 925 32 950 16 Q 975 0 1000 16 Q 1025 32 1050 16 Q 1075 0 1100 16 Q 1125 32 1150 16 Q 1175 0 1200 16 L 1200 0 Z"
        fill={`var(--${color})`}
      />
    </svg>
  );
}

function ChamakStrip({ items = BLESSINGS, reverse = false }) {
  const track = items.concat(items);
  return (
    <div className="ta-chamak">
      <div className={`ta-chamak-shimmer ${reverse ? "ta-rev" : ""}`} aria-hidden="true" />
      <div className={`ta-chamak-track ${reverse ? "ta-rev" : ""}`}>
        {track.map((b, i) => (
          <span key={i} className={`ta-chamak-item ${i % 4 === 1 ? "ta-chamak-urdu" : ""}`}>
            {b}
            <span className="ta-chamak-sep" aria-hidden="true">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default function LandingTruckart() {
  const [year] = useState(() => new Date().getFullYear());
  const fontInjected = useRef(false);

  useEffect(() => {
    if (fontInjected.current) return;
    fontInjected.current = true;
    if (!document.querySelector('link[data-ta-font="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      link.setAttribute("data-ta-font", "1");
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="ta-root">
      <style>{TA_STYLES}</style>

      <ChamakStrip />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="ta-header">
        <div className="ta-container ta-header-row">
          <Link to="/" className="ta-brand">
            <span className="ta-brand-rosette" aria-hidden="true">
              <Rosette size={42} />
            </span>
            <div>
              <div className="ta-brand-name">SanoPOS</div>
              <div className="ta-brand-urdu">سنو پی او ایس</div>
            </div>
          </Link>
          <nav className="ta-nav">
            <a href="#virtues">Virtues</a>
            <a href="#prices">Plans</a>
            <a href="#field">Field</a>
            <Link to="/login" className="ta-nav-cta">Sign in ↗</Link>
          </nav>
        </div>
      </header>

      {/* ── Hero painted panel ─────────────────────────────────────── */}
      <section className="ta-hero">
        <div className="ta-container">
          <div className="ta-panel ta-panel-hero">
            <div className="ta-panel-corner ta-panel-corner-tl" aria-hidden="true">
              <Lotus size={70} />
            </div>
            <div className="ta-panel-corner ta-panel-corner-tr" aria-hidden="true">
              <Lotus size={70} palette={["ta-emerald", "ta-rose", "ta-gold"]} />
            </div>
            <div className="ta-panel-corner ta-panel-corner-bl" aria-hidden="true">
              <Lotus size={70} palette={["ta-royal", "ta-mango", "ta-gold"]} />
            </div>
            <div className="ta-panel-corner ta-panel-corner-br" aria-hidden="true">
              <Lotus size={70} palette={["ta-ruby", "ta-emerald", "ta-gold"]} />
            </div>

            <div className="ta-hero-grid">
              <div className="ta-hero-peacock ta-hero-peacock-l" aria-hidden="true">
                <Peacock size={140} />
              </div>

              <div className="ta-hero-copy">
                <div className="ta-hero-eyebrow">
                  <span className="ta-eyebrow-flourish">❀</span>
                  Bismillah · Spring · MMXXVI
                  <span className="ta-eyebrow-flourish">❀</span>
                </div>

                <h1 className="ta-hero-title">
                  <span className="ta-title-1">Open</span>
                  <span className="ta-title-2">a Free</span>
                  <span className="ta-title-3">Shop</span>
                </h1>

                <div className="ta-hero-banner">
                  <span className="ta-banner-end">▸</span>
                  <span className="ta-banner-text">Free, for-ever · Mashallah</span>
                  <span className="ta-banner-end">◂</span>
                </div>

                <p className="ta-lede">
                  SanoPOS is a Pakistani point-of-sale system, hand-built in
                  Lahore. <strong>Free forever for the first shop.</strong>{" "}
                  FBR-ready, offline-tolerant, sixty-seven reports, and the
                  books all in one window. No card. No trial. No locks.
                </p>

                <div className="ta-cta-row">
                  <Link to="/signup" className="ta-cta-primary">
                    <span>Open Free Shop</span>
                    <span className="ta-cta-orn" aria-hidden="true">✦</span>
                  </Link>
                  <Link to="/login" className="ta-cta-ghost">
                    I have a shop · Sign in
                  </Link>
                </div>

                <div className="ta-fineprint">
                  <span>Free</span> <em>= 1 outlet · 3 staff · 100 products</em>
                  <span className="ta-fine-sep">◆</span>
                  <span>Pro</span> <em>= ₨ 8,000 / month / outlet</em>
                </div>
              </div>

              <div className="ta-hero-peacock ta-hero-peacock-r" aria-hidden="true">
                <Peacock size={140} flip />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Bilingual statement panel ──────────────────────────────── */}
      <section className="ta-statement">
        <div className="ta-container">
          <div className="ta-statement-inner">
            <div className="ta-statement-orn" aria-hidden="true">
              <Rosette size={48} color="ta-mango" />
            </div>
            <p className="ta-statement-urdu">
              ہر دکان دار کا اپنا حساب
            </p>
            <p className="ta-statement-en">
              <em>Har dukandar ka apna hisaab.</em>
              <span> · Every shopkeeper, their own ledger.</span>
            </p>
            <div className="ta-statement-orn" aria-hidden="true">
              <Rosette size={48} color="ta-emerald" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Virtue medallions ──────────────────────────────────────── */}
      <section className="ta-virtues" id="virtues">
        <div className="ta-container">
          <header className="ta-section-head">
            <div className="ta-section-flourish">❀ ❀ ❀</div>
            <h2 className="ta-section-title">The Six Virtues</h2>
            <p className="ta-section-sub">
              Every line below is included on every plan. Painted on the panel
              the same as on the truck.
            </p>
          </header>

          <div className="ta-virtues-grid">
            {VIRTUES.map((v, i) => (
              <article className={`ta-virtue ta-virtue-${v.color}`} key={i}>
                <div className="ta-virtue-medal">
                  <Rosette size={68} color={`ta-${v.color}`} />
                  <span className="ta-virtue-icon">{v.icon}</span>
                </div>
                <div className="ta-virtue-body">
                  <div className="ta-virtue-urdu">{v.urdu}</div>
                  <h4 className="ta-virtue-title">{v.title}</h4>
                  <div className="ta-virtue-note">{v.note}</div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ChamakStrip reverse />

      {/* ── Pricing as truck-back panels ───────────────────────────── */}
      <section className="ta-prices" id="prices">
        <div className="ta-container">
          <header className="ta-section-head">
            <div className="ta-section-flourish">❖ ❖ ❖</div>
            <h2 className="ta-section-title">Two Paintings, Two Plans</h2>
            <p className="ta-section-sub">
              Free is permanent. Pro is paid per outlet, monthly, additive
              one outlet at a time.
            </p>
          </header>

          <div className="ta-pricing-grid">
            {/* Free panel */}
            <article className="ta-price-panel ta-price-free">
              <div className="ta-price-frame">
                <div className="ta-price-corner ta-price-corner-tl" aria-hidden="true"><Lotus size={50} /></div>
                <div className="ta-price-corner ta-price-corner-tr" aria-hidden="true"><Lotus size={50} palette={["ta-emerald", "ta-rose", "ta-gold"]} /></div>
                <div className="ta-price-corner ta-price-corner-bl" aria-hidden="true"><Lotus size={50} palette={["ta-royal", "ta-mango", "ta-gold"]} /></div>
                <div className="ta-price-corner ta-price-corner-br" aria-hidden="true"><Lotus size={50} palette={["ta-ruby", "ta-emerald", "ta-gold"]} /></div>

                <div className="ta-price-crown" aria-hidden="true">✦ ❖ ✦</div>
                <div className="ta-price-name">FREE</div>
                <div className="ta-price-urdu">مفت</div>
                <div className="ta-price-rule" />
                <div className="ta-price-amount">
                  <span className="ta-price-cur">₨</span>
                  <span className="ta-price-num">0</span>
                </div>
                <div className="ta-price-cad">for-ever · not a trial</div>
                <div className="ta-price-rule" />
                <ul className="ta-price-list">
                  <li><span className="ta-tick">✦</span>One outlet</li>
                  <li><span className="ta-tick">✦</span>Three staff</li>
                  <li><span className="ta-tick">✦</span>100 products</li>
                  <li><span className="ta-tick">✦</span>Every retail feature</li>
                  <li><span className="ta-tick">✦</span>FBR digital invoicing</li>
                  <li><span className="ta-tick">✦</span>Offline sale queue</li>
                </ul>
                <Link to="/signup" className="ta-price-cta">
                  Open free shop &nbsp;✧
                </Link>
              </div>
            </article>

            {/* Pro panel */}
            <article className="ta-price-panel ta-price-pro">
              <div className="ta-price-frame">
                <div className="ta-price-corner ta-price-corner-tl" aria-hidden="true"><Lotus size={50} palette={["ta-mango", "ta-rose", "ta-gold"]} /></div>
                <div className="ta-price-corner ta-price-corner-tr" aria-hidden="true"><Lotus size={50} palette={["ta-rose", "ta-emerald", "ta-gold"]} /></div>
                <div className="ta-price-corner ta-price-corner-bl" aria-hidden="true"><Lotus size={50} palette={["ta-gold", "ta-royal", "ta-mango"]} /></div>
                <div className="ta-price-corner ta-price-corner-br" aria-hidden="true"><Lotus size={50} palette={["ta-emerald", "ta-mango", "ta-gold"]} /></div>

                <div className="ta-price-crown ta-price-crown-hot" aria-hidden="true">✦ ❀ ✦</div>
                <div className="ta-price-name ta-price-name-pro">PRO</div>
                <div className="ta-price-urdu">شاہی</div>
                <div className="ta-price-rule" />
                <div className="ta-price-amount">
                  <span className="ta-price-cur">₨</span>
                  <span className="ta-price-num ta-price-num-pro">8,000</span>
                </div>
                <div className="ta-price-cad">per month · per outlet</div>
                <div className="ta-price-rule" />
                <ul className="ta-price-list">
                  <li><span className="ta-tick">✦</span>Unlimited staff</li>
                  <li><span className="ta-tick">✦</span>Unlimited products</li>
                  <li><span className="ta-tick">✦</span>Multi-outlet + transfers</li>
                  <li><span className="ta-tick">✦</span>Context-aware pricing</li>
                  <li><span className="ta-tick">✦</span>AI insights panel</li>
                  <li><span className="ta-tick">✦</span>Email + WhatsApp support</li>
                </ul>
                <Link to="/signup" className="ta-price-cta ta-price-cta-pro">
                  Begin on Free &nbsp;✧&nbsp; Upgrade later
                </Link>
                <div className="ta-price-foot">
                  Add additional outlets one at a time, from <em>/billing</em>.
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ── Features as decorative slabs ───────────────────────────── */}
      <section className="ta-features">
        <div className="ta-container">
          <header className="ta-section-head">
            <div className="ta-section-flourish">✿ ✿ ✿</div>
            <h2 className="ta-section-title">What Is on the Truck</h2>
            <p className="ta-section-sub">
              Every plan, painted with the same six colours.
            </p>
          </header>

          <div className="ta-features-grid">
            {FEATURES.map(([t, b], i) => (
              <article className="ta-feature" key={t}>
                <div className="ta-feature-num">{String(i + 1).padStart(2, "0")}</div>
                <div className="ta-feature-rosette" aria-hidden="true">
                  <Rosette size={36} color={["ta-ruby", "ta-emerald", "ta-royal", "ta-mango", "ta-rose", "ta-gold"][i % 6]} />
                </div>
                <h4 className="ta-feature-title">{t}</h4>
                <p className="ta-feature-body">{b}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Couriers as garlanded row ──────────────────────────────── */}
      <section className="ta-couriers" id="field">
        <ScallopBorder color="ta-midnight" />
        <div className="ta-couriers-inner">
          <div className="ta-container">
            <header className="ta-section-head ta-section-head-light">
              <div className="ta-section-flourish ta-section-flourish-gold">★ ★ ★</div>
              <h2 className="ta-section-title ta-section-title-light">Shipping Nationwide</h2>
              <p className="ta-section-sub ta-section-sub-light">
                Thirteen courier partners wired in. Label printing, tracking,
                COD reconciliation — all from inside the dashboard.
              </p>
            </header>
            <div className="ta-couriers-row">
              {COURIERS.map((c, i) => (
                <span
                  key={c}
                  className="ta-courier"
                  style={{ "--rot": `${(i % 2 === 0 ? -1 : 1) * (1 + (i % 3))}deg` }}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
        <ScallopBorder color="ta-midnight" flip />
      </section>

      {/* ── Testimonial as framed plaque ───────────────────────────── */}
      <section className="ta-quote">
        <div className="ta-container">
          <div className="ta-plaque">
            <div className="ta-plaque-flourish ta-plaque-flourish-tl" aria-hidden="true">
              <Rosette size={44} color="ta-mango" />
            </div>
            <div className="ta-plaque-flourish ta-plaque-flourish-tr" aria-hidden="true">
              <Rosette size={44} color="ta-rose" />
            </div>
            <div className="ta-plaque-flourish ta-plaque-flourish-bl" aria-hidden="true">
              <Rosette size={44} color="ta-emerald" />
            </div>
            <div className="ta-plaque-flourish ta-plaque-flourish-br" aria-hidden="true">
              <Rosette size={44} color="ta-royal" />
            </div>

            <div className="ta-plaque-stamp">A field report · Lahore</div>
            <blockquote className="ta-plaque-text">
              "We had been paying a Karachi vendor by the feature. SanoPOS gave
              us FBR, multi-outlet, and the books on the first day. Closing
              used to take a Saturday. It now takes an hour. <em>Mashallah.</em>"
            </blockquote>
            <div className="ta-plaque-attr">
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
      <section className="ta-soon">
        <div className="ta-container">
          <header className="ta-section-head">
            <div className="ta-section-flourish">❋ ❋ ❋</div>
            <h2 className="ta-section-title">By Invitation</h2>
            <p className="ta-section-sub">
              SanoPOS at public launch is for retail. Other presets are
              already painted — opening in waves through the year.
            </p>
          </header>
          <div className="ta-soon-grid">
            {COMING_SOON.map(({ en, urdu }, i) => (
              <div key={en} className="ta-soon-card">
                <div className="ta-soon-rosette" aria-hidden="true">
                  <Rosette size={32} color={["ta-ruby", "ta-emerald", "ta-royal", "ta-mango", "ta-rose", "ta-gold"][i]} />
                </div>
                <div className="ta-soon-name">{en}</div>
                <div className="ta-soon-urdu">{urdu}</div>
                <div className="ta-soon-tag">in preview</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ChamakStrip />

      {/* ── End CTA ────────────────────────────────────────────────── */}
      <section className="ta-end">
        <div className="ta-container ta-end-inner">
          <div className="ta-end-rosette" aria-hidden="true">
            <Rosette size={88} color="ta-gold" />
          </div>
          <h2 className="ta-end-title">
            Khush amdeed <span className="ta-end-urdu">— خوش آمدید —</span>
          </h2>
          <p className="ta-end-sub">
            Five minutes. An email to confirm. Your shop, ringing up sales tonight.
          </p>
          <div className="ta-cta-row ta-cta-center">
            <Link to="/signup" className="ta-cta-primary ta-cta-large">
              <span>Open a Free Shop</span>
              <span className="ta-cta-orn" aria-hidden="true">✦</span>
            </Link>
            <Link to="/login" className="ta-cta-ghost ta-cta-large">
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="ta-foot">
        <ScallopBorder color="ta-midnight" />
        <div className="ta-foot-inner">
          <div className="ta-container">
            <div className="ta-foot-grid">
              <div>
                <div className="ta-foot-h">❀ Colophon</div>
                <p>
                  Set in <em>Rozha One</em>, <em>Mirza</em>, and{" "}
                  <em>Noto Nastaliq Urdu</em>. Painted in Lahore.
                  <strong> SanoPOS</strong> is a registered product of Sano
                  Merchandise.
                </p>
              </div>
              <div>
                <div className="ta-foot-h">❀ Pages</div>
                <ul>
                  <li><a href="#virtues">Virtues</a></li>
                  <li><a href="#prices">Plans</a></li>
                  <li><a href="#field">Field</a></li>
                </ul>
              </div>
              <div>
                <div className="ta-foot-h">❀ Desk</div>
                <ul>
                  <li><Link to="/login">Sign in</Link></li>
                  <li><Link to="/signup">Open an account</Link></li>
                  <li><Link to="/terms">Terms</Link></li>
                  <li><Link to="/privacy">Privacy</Link></li>
                </ul>
              </div>
              <div>
                <div className="ta-foot-h">❀ Edition</div>
                <p>
                  Spring · MMXXVI · Lahore<br />
                  © {year} Sano Merchandise<br />
                  ماشاءاللہ
                </p>
              </div>
            </div>
            <p className="ta-foot-tail">
              ✦ ✦ ✦ &nbsp; خدا حافظ &nbsp; ·&nbsp; Khuda hafiz, see you tomorrow &nbsp; ✦ ✦ ✦
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Stylesheet ─────────────────────────────────────────────────────────── */

const TA_STYLES = `
.ta-root {
  --cream: #FFF7DC;
  --cream-2: #FFEFC0;
  --midnight: #0F0B2E;
  --midnight-2: #1A1442;
  --ruby: #DC2C5E;
  --ruby-2: #B81E4E;
  --emerald: #0E8A5A;
  --emerald-2: #0A6E47;
  --royal: #1E3A8A;
  --mango: #F59E0B;
  --gold: #FCD34D;
  --gold-2: #EAB308;
  --rose: #FF6B9D;
  --ink: #1A1814;

  --display: "Rozha One", "Cormorant Garamond", Georgia, serif;
  --body: "Mirza", Georgia, "Times New Roman", serif;
  --urdu: "Noto Nastaliq Urdu", serif;
  --sans: "Outfit", -apple-system, BlinkMacSystemFont, sans-serif;

  background: var(--cream);
  color: var(--ink);
  font-family: var(--body);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
  overflow-x: hidden;
  font-weight: 500;
}

.ta-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 28px;
}
@media (max-width: 720px) { .ta-container { padding: 0 18px; } }

/* ── Chamak strip (animated foil/glitter band) ───────────────────────── */
.ta-chamak {
  position: relative;
  background: linear-gradient(90deg,
    var(--midnight) 0%,
    var(--ruby) 16%,
    var(--mango) 32%,
    var(--gold) 48%,
    var(--emerald) 64%,
    var(--royal) 80%,
    var(--rose) 92%,
    var(--midnight) 100%);
  border-top: 3px solid var(--midnight);
  border-bottom: 3px solid var(--midnight);
  overflow: hidden;
  padding: 12px 0;
}
.ta-chamak-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg,
    transparent 0%,
    transparent 30%,
    rgba(255,255,255,0.55) 45%,
    rgba(255,255,255,0.85) 50%,
    rgba(255,255,255,0.55) 55%,
    transparent 70%,
    transparent 100%);
  background-size: 220% 100%;
  animation: ta-shimmer 4.2s linear infinite;
  mix-blend-mode: overlay;
  pointer-events: none;
}
.ta-chamak-shimmer.ta-rev { animation-direction: reverse; }
@keyframes ta-shimmer {
  from { background-position: -120% 0; }
  to { background-position: 120% 0; }
}
.ta-chamak-track {
  display: inline-flex;
  white-space: nowrap;
  font-family: var(--display);
  font-size: 18px;
  letter-spacing: 0.04em;
  color: var(--cream);
  text-shadow: 0 0 8px rgba(0,0,0,0.5), 0 1px 0 rgba(0,0,0,0.6);
  animation: ta-marq 38s linear infinite;
  position: relative;
}
.ta-chamak-track.ta-rev { animation-direction: reverse; animation-duration: 44s; }
@keyframes ta-marq {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
.ta-chamak-item { display: inline-flex; align-items: center; gap: 22px; padding-right: 22px; }
.ta-chamak-urdu {
  font-family: var(--urdu);
  font-size: 22px;
  letter-spacing: 0;
  color: var(--gold);
}
.ta-chamak-sep { color: var(--gold); opacity: 0.85; }

/* ── Header ───────────────────────────────────────────────────────────── */
.ta-header {
  background: var(--cream);
  padding: 22px 0 18px;
  border-bottom: 2px solid var(--midnight);
  position: relative;
}
.ta-header::before, .ta-header::after {
  content: "";
  position: absolute;
  bottom: -2px;
  height: 2px;
  width: 100%;
  background: repeating-linear-gradient(90deg,
    var(--ruby) 0 12px, var(--mango) 12px 24px, var(--emerald) 24px 36px,
    var(--royal) 36px 48px, var(--rose) 48px 60px, var(--gold) 60px 72px);
}
.ta-header::before { top: -2px; bottom: auto; }

.ta-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.ta-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
  color: var(--midnight);
}
.ta-brand-rosette { display: flex; }
.ta-brand-name {
  font-family: var(--display);
  font-size: 30px;
  letter-spacing: 0.01em;
  color: var(--midnight);
  line-height: 1;
}
.ta-brand-urdu {
  font-family: var(--urdu);
  font-size: 18px;
  color: var(--ruby);
  margin-top: 4px;
  line-height: 1;
}
.ta-nav { display: flex; align-items: center; gap: 28px; }
.ta-nav a {
  font-family: var(--body);
  font-weight: 600;
  font-size: 16.5px;
  color: var(--midnight);
  text-decoration: none;
  letter-spacing: 0.005em;
  transition: color 0.18s;
  position: relative;
}
.ta-nav a:hover { color: var(--ruby); }
.ta-nav a:not(.ta-nav-cta)::after {
  content: "";
  position: absolute;
  bottom: -4px; left: 50%;
  width: 0; height: 2px;
  background: var(--ruby);
  transition: all 0.25s;
  transform: translateX(-50%);
}
.ta-nav a:not(.ta-nav-cta):hover::after { width: 100%; }
.ta-nav-cta {
  background: var(--midnight);
  color: var(--gold) !important;
  padding: 10px 18px;
  font-weight: 700 !important;
  letter-spacing: 0.04em !important;
  border: 2px solid var(--gold);
  transition: all 0.2s;
}
.ta-nav-cta:hover {
  background: var(--ruby);
  color: var(--cream) !important;
  border-color: var(--ruby);
}
@media (max-width: 720px) {
  .ta-nav { gap: 14px; }
  .ta-nav a:not(.ta-nav-cta) { display: none; }
  .ta-brand-urdu { display: none; }
}

/* ── Hero painted panel ──────────────────────────────────────────────── */
.ta-hero { padding: 56px 0 64px; background: var(--cream); }
.ta-panel-hero {
  background: var(--midnight);
  background-image:
    radial-gradient(circle at 20% 30%, rgba(252,211,77,0.10) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(220,44,94,0.10) 0%, transparent 50%);
  position: relative;
  padding: 64px 56px;
  border: 4px solid var(--gold);
  box-shadow:
    inset 0 0 0 8px var(--midnight),
    inset 0 0 0 10px var(--ruby),
    inset 0 0 0 12px var(--midnight),
    0 24px 48px rgba(15,11,46,0.25);
}
@media (max-width: 720px) { .ta-panel-hero { padding: 52px 22px; } }
.ta-panel-corner { position: absolute; opacity: 0.95; pointer-events: none; }
.ta-panel-corner-tl { top: 14px; left: 14px; }
.ta-panel-corner-tr { top: 14px; right: 14px; transform: scaleX(-1); }
.ta-panel-corner-bl { bottom: 14px; left: 14px; transform: scaleY(-1); }
.ta-panel-corner-br { bottom: 14px; right: 14px; transform: scale(-1); }

.ta-hero-grid {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 24px;
  align-items: center;
  position: relative;
}
@media (max-width: 980px) {
  .ta-hero-grid { grid-template-columns: 1fr; gap: 20px; }
  .ta-hero-peacock { display: flex; justify-content: center; }
}
.ta-hero-peacock { display: flex; align-items: center; }

.ta-hero-copy { text-align: center; color: var(--cream); }
.ta-hero-eyebrow {
  font-family: var(--body);
  font-style: italic;
  font-size: 15px;
  color: var(--gold);
  letter-spacing: 0.06em;
  margin-bottom: 18px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.ta-eyebrow-flourish { color: var(--rose); font-size: 14px; }

.ta-hero-title {
  font-family: var(--display);
  font-size: clamp(46px, 8vw, 124px);
  font-weight: 400;
  line-height: 0.92;
  letter-spacing: -0.012em;
  margin: 0 0 28px;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.ta-title-1, .ta-title-2, .ta-title-3 {
  display: inline-block;
  text-shadow:
    -2px 0 0 var(--midnight),
    2px 0 0 var(--midnight),
    0 -2px 0 var(--midnight),
    0 2px 0 var(--midnight),
    -2px -2px 0 var(--midnight),
    2px 2px 0 var(--midnight),
    4px 4px 0 rgba(15,11,46,0.6);
  position: relative;
}
.ta-title-1 { color: var(--gold); }
.ta-title-2 { color: var(--rose); padding-left: 0.4em; }
.ta-title-3 { color: var(--mango); padding-left: 0.1em; }

.ta-hero-banner {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: var(--ruby);
  color: var(--cream);
  font-family: var(--display);
  font-size: 19px;
  letter-spacing: 0.04em;
  padding: 10px 22px;
  margin-bottom: 28px;
  border: 2px solid var(--gold);
  position: relative;
  box-shadow: 0 4px 0 var(--midnight-2);
}
.ta-banner-end { color: var(--gold); font-size: 22px; }

.ta-lede {
  font-family: var(--body);
  font-size: clamp(16.5px, 1.4vw, 19px);
  line-height: 1.55;
  color: var(--cream);
  max-width: 580px;
  margin: 0 auto 30px;
  font-weight: 500;
}
.ta-lede strong {
  color: var(--gold);
  font-weight: 700;
  background: linear-gradient(180deg, transparent 60%, rgba(245,158,11,0.25) 60%);
  padding: 0 4px;
}

.ta-cta-row {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}
.ta-cta-center { justify-content: center; }

.ta-cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--display);
  font-size: 19px;
  letter-spacing: 0.02em;
  color: var(--midnight);
  background: var(--gold);
  padding: 16px 26px;
  text-decoration: none;
  border: 3px solid var(--midnight);
  position: relative;
  transition: all 0.2s;
  box-shadow: 0 5px 0 var(--midnight);
}
.ta-cta-large { font-size: 22px; padding: 20px 32px; }
.ta-cta-primary:hover {
  background: var(--ruby);
  color: var(--cream);
  transform: translateY(-2px);
  box-shadow: 0 7px 0 var(--midnight);
}
.ta-cta-orn { color: var(--ruby); transition: color 0.2s; }
.ta-cta-primary:hover .ta-cta-orn { color: var(--gold); }

.ta-cta-ghost {
  font-family: var(--body);
  font-size: 16px;
  font-weight: 600;
  color: var(--cream);
  text-decoration: none;
  border: 2px solid var(--gold);
  padding: 14px 22px;
  transition: all 0.2s;
  font-style: italic;
}
.ta-cta-ghost:hover { background: var(--gold); color: var(--midnight); }

.ta-fineprint {
  margin-top: 26px;
  font-family: var(--body);
  font-size: 14px;
  color: var(--cream);
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  align-items: center;
  letter-spacing: 0.01em;
}
.ta-fineprint span { color: var(--gold); font-weight: 700; letter-spacing: 0.06em; }
.ta-fineprint em { font-style: italic; opacity: 0.92; }
.ta-fine-sep { color: var(--ruby) !important; }

/* ── Statement bilingual panel ───────────────────────────────────────── */
.ta-statement {
  padding: 64px 0;
  background: var(--cream);
  text-align: center;
}
.ta-statement-inner {
  max-width: 760px;
  margin: 0 auto;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  flex-wrap: wrap;
}
.ta-statement-orn { flex-shrink: 0; }
.ta-statement-urdu {
  font-family: var(--urdu);
  font-size: clamp(28px, 4vw, 52px);
  color: var(--ruby);
  margin: 0;
  font-weight: 600;
  flex: 0 0 100%;
  line-height: 1.5;
}
.ta-statement-en {
  font-family: var(--display);
  font-size: clamp(20px, 2.4vw, 30px);
  color: var(--midnight);
  margin: 12px 0 0;
  flex: 0 0 100%;
}
.ta-statement-en em { color: var(--ruby); font-style: italic; }
.ta-statement-en span { color: var(--midnight); opacity: 0.7; }

/* ── Section heads ──────────────────────────────────────────────────── */
.ta-section-head {
  text-align: center;
  margin-bottom: 56px;
}
.ta-section-flourish {
  font-family: var(--display);
  font-size: 24px;
  color: var(--gold-2);
  letter-spacing: 0.4em;
  margin-bottom: 14px;
}
.ta-section-flourish-gold { color: var(--gold); }
.ta-section-title {
  font-family: var(--display);
  font-size: clamp(38px, 5.4vw, 76px);
  color: var(--midnight);
  margin: 0 0 16px;
  line-height: 1;
  letter-spacing: -0.01em;
  text-shadow: 3px 3px 0 var(--gold);
}
.ta-section-title-light {
  color: var(--cream);
  text-shadow: 3px 3px 0 var(--ruby);
}
.ta-section-sub {
  font-family: var(--body);
  font-style: italic;
  font-size: 18px;
  color: var(--midnight);
  opacity: 0.8;
  max-width: 620px;
  margin: 0 auto;
  line-height: 1.55;
}
.ta-section-sub-light { color: var(--cream); opacity: 0.92; }

/* ── Virtues grid ───────────────────────────────────────────────────── */
.ta-virtues { padding: 80px 0; background: var(--cream); }
.ta-virtues-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
@media (max-width: 880px) { .ta-virtues-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .ta-virtues-grid { grid-template-columns: 1fr; } }
.ta-virtue {
  background: var(--cream-2);
  border: 3px solid var(--midnight);
  padding: 22px 22px 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  position: relative;
  transition: all 0.25s;
  box-shadow: 6px 6px 0 var(--midnight);
}
.ta-virtue:hover { transform: translateY(-3px); box-shadow: 9px 9px 0 var(--midnight); }
.ta-virtue::before {
  content: "";
  position: absolute;
  inset: 6px;
  border: 2px solid var(--midnight);
  pointer-events: none;
  opacity: 0.35;
}
.ta-virtue-ruby { background: linear-gradient(180deg, var(--cream-2) 0%, #FCE4EC 100%); }
.ta-virtue-emerald { background: linear-gradient(180deg, var(--cream-2) 0%, #D1FAE5 100%); }
.ta-virtue-royal { background: linear-gradient(180deg, var(--cream-2) 0%, #DBEAFE 100%); }
.ta-virtue-mango { background: linear-gradient(180deg, var(--cream-2) 0%, #FEF3C7 100%); }
.ta-virtue-rose { background: linear-gradient(180deg, var(--cream-2) 0%, #FCE7F3 100%); }
.ta-virtue-gold { background: linear-gradient(180deg, var(--cream-2) 0%, #FEF9C3 100%); }
.ta-virtue-medal {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  margin-bottom: 16px;
}
.ta-virtue-icon {
  position: absolute;
  font-size: 22px;
  color: var(--cream);
  font-weight: 700;
  text-shadow: 0 0 4px rgba(0,0,0,0.5);
}
.ta-virtue-urdu {
  font-family: var(--urdu);
  font-size: 22px;
  color: var(--ruby);
  margin-bottom: 4px;
  line-height: 1.3;
}
.ta-virtue-title {
  font-family: var(--display);
  font-size: 28px;
  color: var(--midnight);
  margin: 0 0 6px;
  letter-spacing: -0.01em;
  line-height: 1;
}
.ta-virtue-note {
  font-family: var(--body);
  font-style: italic;
  font-size: 14.5px;
  color: var(--midnight);
  opacity: 0.7;
}

/* ── Pricing panels ─────────────────────────────────────────────────── */
.ta-prices {
  padding: 96px 0;
  background:
    repeating-linear-gradient(45deg,
      rgba(252,211,77,0.06) 0 8px,
      rgba(220,44,94,0.04) 8px 16px),
    var(--cream);
}
.ta-pricing-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  margin-top: 40px;
}
@media (max-width: 880px) { .ta-pricing-grid { grid-template-columns: 1fr; } }

.ta-price-panel { position: relative; }
.ta-price-frame {
  background: var(--cream-2);
  padding: 50px 36px 38px;
  border: 4px solid var(--midnight);
  position: relative;
  text-align: center;
  box-shadow:
    inset 0 0 0 6px var(--cream-2),
    inset 0 0 0 8px var(--gold),
    inset 0 0 0 10px var(--cream-2),
    inset 0 0 0 12px var(--ruby),
    10px 10px 0 var(--midnight);
}
.ta-price-pro .ta-price-frame {
  background: var(--midnight);
  color: var(--cream);
  box-shadow:
    inset 0 0 0 6px var(--midnight),
    inset 0 0 0 8px var(--gold),
    inset 0 0 0 10px var(--midnight),
    inset 0 0 0 12px var(--ruby),
    10px 10px 0 var(--midnight-2);
}
.ta-price-corner { position: absolute; opacity: 0.9; }
.ta-price-corner-tl { top: 18px; left: 18px; }
.ta-price-corner-tr { top: 18px; right: 18px; transform: scaleX(-1); }
.ta-price-corner-bl { bottom: 18px; left: 18px; transform: scaleY(-1); }
.ta-price-corner-br { bottom: 18px; right: 18px; transform: scale(-1); }

.ta-price-crown {
  font-family: var(--display);
  font-size: 22px;
  color: var(--gold-2);
  letter-spacing: 0.5em;
  margin-bottom: 12px;
}
.ta-price-crown-hot { color: var(--gold); }
.ta-price-name {
  font-family: var(--display);
  font-size: clamp(56px, 7vw, 88px);
  color: var(--midnight);
  letter-spacing: 0.04em;
  line-height: 0.9;
  margin: 0;
  text-shadow: 4px 4px 0 var(--gold);
}
.ta-price-name-pro {
  color: var(--gold);
  text-shadow: 4px 4px 0 var(--ruby);
}
.ta-price-urdu {
  font-family: var(--urdu);
  font-size: 24px;
  color: var(--ruby);
  margin: 6px 0 0;
  line-height: 1.5;
}
.ta-price-pro .ta-price-urdu { color: var(--rose); }
.ta-price-rule {
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--gold) 20%, var(--gold) 80%, transparent);
  margin: 22px auto;
  width: 80%;
}
.ta-price-amount {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.ta-price-cur {
  font-family: var(--display);
  font-size: 26px;
  color: var(--midnight);
  opacity: 0.7;
}
.ta-price-pro .ta-price-cur { color: var(--gold); opacity: 0.7; }
.ta-price-num {
  font-family: var(--display);
  font-size: clamp(72px, 9vw, 120px);
  letter-spacing: -0.02em;
  color: var(--midnight);
  line-height: 1;
}
.ta-price-num-pro { color: var(--gold); }
.ta-price-cad {
  font-family: var(--body);
  font-style: italic;
  font-size: 15.5px;
  color: var(--midnight);
  opacity: 0.75;
  margin: 8px 0 0;
}
.ta-price-pro .ta-price-cad { color: var(--cream); opacity: 0.85; }
.ta-price-list {
  list-style: none;
  padding: 0;
  margin: 24px 0 28px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  text-align: left;
  max-width: 280px;
  margin-left: auto;
  margin-right: auto;
}
.ta-price-list li {
  font-family: var(--body);
  font-size: 16px;
  color: var(--midnight);
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.ta-price-pro .ta-price-list li { color: var(--cream); }
.ta-tick { color: var(--ruby); font-weight: 700; }
.ta-price-pro .ta-tick { color: var(--gold); }
.ta-price-cta {
  display: inline-block;
  font-family: var(--display);
  font-size: 17px;
  letter-spacing: 0.04em;
  background: var(--ruby);
  color: var(--cream);
  padding: 16px 24px;
  text-decoration: none;
  border: 3px solid var(--midnight);
  transition: all 0.2s;
  box-shadow: 0 5px 0 var(--midnight);
}
.ta-price-cta:hover {
  background: var(--mango);
  color: var(--midnight);
  transform: translateY(-2px);
  box-shadow: 0 7px 0 var(--midnight);
}
.ta-price-cta-pro {
  background: var(--gold);
  color: var(--midnight);
  border-color: var(--gold);
  box-shadow: 0 5px 0 var(--ruby);
}
.ta-price-cta-pro:hover {
  background: var(--rose);
  color: var(--cream);
  border-color: var(--rose);
  box-shadow: 0 7px 0 var(--ruby);
}
.ta-price-foot {
  font-family: var(--body);
  font-style: italic;
  font-size: 13.5px;
  color: var(--cream);
  opacity: 0.75;
  margin: 14px 0 0;
}
.ta-price-foot em { color: var(--gold); font-style: italic; }

/* ── Features grid ──────────────────────────────────────────────────── */
.ta-features { padding: 96px 0; background: var(--cream); }
.ta-features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin-top: 32px;
}
@media (max-width: 880px) { .ta-features-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .ta-features-grid { grid-template-columns: 1fr; } }
.ta-feature {
  background: var(--cream-2);
  border: 3px solid var(--midnight);
  padding: 24px 22px 22px;
  position: relative;
  transition: all 0.25s;
  box-shadow: 5px 5px 0 var(--ruby);
}
.ta-feature:hover { transform: translateY(-3px); box-shadow: 8px 8px 0 var(--ruby); }
.ta-feature-num {
  position: absolute;
  top: -2px;
  left: -2px;
  background: var(--ruby);
  color: var(--cream);
  font-family: var(--display);
  font-size: 22px;
  padding: 6px 14px;
  letter-spacing: 0.05em;
  border: 3px solid var(--midnight);
  box-shadow: 3px 3px 0 var(--midnight);
}
.ta-feature-rosette { position: absolute; top: 14px; right: 14px; }
.ta-feature-title {
  font-family: var(--display);
  font-size: 24px;
  color: var(--midnight);
  margin: 28px 0 10px;
  letter-spacing: -0.005em;
  line-height: 1.05;
}
.ta-feature-body {
  font-family: var(--body);
  font-size: 15.5px;
  line-height: 1.55;
  color: var(--midnight);
  opacity: 0.78;
  margin: 0;
}

/* ── Couriers ───────────────────────────────────────────────────────── */
.ta-couriers { background: var(--cream); }
.ta-couriers-inner {
  background: var(--midnight);
  background-image:
    radial-gradient(circle at 30% 30%, rgba(252,211,77,0.08) 0%, transparent 50%),
    radial-gradient(circle at 70% 70%, rgba(220,44,94,0.08) 0%, transparent 50%);
  padding: 80px 0 96px;
  margin: -1px 0;
}
.ta-couriers-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
  margin-top: 32px;
}
.ta-courier {
  font-family: var(--display);
  font-size: 22px;
  color: var(--midnight);
  background: var(--gold);
  padding: 12px 22px;
  border: 3px solid var(--cream);
  letter-spacing: 0.02em;
  transform: rotate(var(--rot, 0deg));
  transition: all 0.25s;
  box-shadow: 4px 4px 0 var(--ruby);
}
.ta-courier:hover {
  transform: rotate(0deg) translateY(-3px);
  background: var(--rose);
  color: var(--cream);
  box-shadow: 6px 6px 0 var(--gold);
}

/* ── Plaque / testimonial ───────────────────────────────────────────── */
.ta-quote { padding: 96px 0; background: var(--cream); }
.ta-plaque {
  background: var(--cream-2);
  padding: 56px 48px;
  border: 4px solid var(--midnight);
  position: relative;
  max-width: 880px;
  margin: 0 auto;
  text-align: center;
  box-shadow:
    inset 0 0 0 6px var(--cream-2),
    inset 0 0 0 8px var(--ruby),
    inset 0 0 0 10px var(--cream-2),
    inset 0 0 0 12px var(--gold),
    12px 12px 0 var(--midnight);
}
.ta-plaque-flourish { position: absolute; }
.ta-plaque-flourish-tl { top: 22px; left: 22px; }
.ta-plaque-flourish-tr { top: 22px; right: 22px; }
.ta-plaque-flourish-bl { bottom: 22px; left: 22px; }
.ta-plaque-flourish-br { bottom: 22px; right: 22px; }

.ta-plaque-stamp {
  display: inline-block;
  font-family: var(--display);
  font-size: 14px;
  letter-spacing: 0.16em;
  background: var(--midnight);
  color: var(--gold);
  padding: 6px 14px;
  margin-bottom: 22px;
}
.ta-plaque-text {
  font-family: var(--display);
  font-size: clamp(20px, 2.6vw, 30px);
  line-height: 1.4;
  color: var(--midnight);
  margin: 0 0 22px;
  letter-spacing: -0.005em;
}
.ta-plaque-text em {
  font-family: var(--body);
  font-style: italic;
  color: var(--ruby);
}
.ta-plaque-attr {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  font-family: var(--body);
  font-size: 14.5px;
  color: var(--midnight);
  opacity: 0.8;
}
.ta-plaque-attr strong { color: var(--ruby); font-weight: 700; }
.ta-plaque-attr span:nth-child(even) { color: var(--gold-2); }

/* ── Coming soon ────────────────────────────────────────────────────── */
.ta-soon { padding: 96px 0; background: var(--cream-2); }
.ta-soon-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 32px;
}
@media (max-width: 720px) { .ta-soon-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .ta-soon-grid { grid-template-columns: 1fr; } }
.ta-soon-card {
  background: var(--cream);
  border: 3px solid var(--midnight);
  padding: 22px 18px;
  text-align: center;
  position: relative;
  transition: all 0.25s;
  box-shadow: 5px 5px 0 var(--midnight);
}
.ta-soon-card:hover { transform: translateY(-3px); box-shadow: 8px 8px 0 var(--midnight); }
.ta-soon-rosette { display: flex; justify-content: center; margin-bottom: 10px; }
.ta-soon-name {
  font-family: var(--display);
  font-size: 22px;
  color: var(--midnight);
  margin-bottom: 4px;
  letter-spacing: -0.005em;
}
.ta-soon-urdu {
  font-family: var(--urdu);
  font-size: 18px;
  color: var(--ruby);
  margin-bottom: 12px;
  line-height: 1.5;
}
.ta-soon-tag {
  font-family: var(--body);
  font-style: italic;
  font-size: 12.5px;
  letter-spacing: 0.06em;
  color: var(--midnight);
  opacity: 0.7;
}

/* ── End / CTA ──────────────────────────────────────────────────────── */
.ta-end {
  padding: 120px 0;
  background:
    radial-gradient(ellipse at center, rgba(252,211,77,0.18) 0%, transparent 60%),
    var(--cream);
  text-align: center;
}
.ta-end-rosette {
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
  animation: ta-spin 24s linear infinite;
}
@keyframes ta-spin { to { transform: rotate(360deg); } }
.ta-end-title {
  font-family: var(--display);
  font-size: clamp(42px, 6vw, 88px);
  color: var(--midnight);
  margin: 0 0 12px;
  line-height: 1;
  letter-spacing: -0.01em;
  text-shadow: 4px 4px 0 var(--gold), 6px 6px 0 var(--ruby);
}
.ta-end-urdu {
  display: inline-block;
  font-family: var(--urdu);
  font-size: 0.7em;
  color: var(--ruby);
  text-shadow: none;
  margin-left: 8px;
}
.ta-end-sub {
  font-family: var(--body);
  font-style: italic;
  font-size: 18.5px;
  color: var(--midnight);
  opacity: 0.78;
  margin: 12px 0 32px;
  max-width: 580px;
  margin-left: auto;
  margin-right: auto;
}
.ta-end-inner .ta-cta-row { justify-content: center; }

/* ── Footer ─────────────────────────────────────────────────────────── */
.ta-foot {
  background: var(--cream-2);
}
.ta-foot-inner {
  background: var(--midnight);
  color: var(--cream);
  padding: 44px 0 32px;
  margin: -1px 0;
}
.ta-foot-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--gold);
}
@media (max-width: 720px) { .ta-foot-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .ta-foot-grid { grid-template-columns: 1fr; } }
.ta-foot-h {
  font-family: var(--display);
  font-size: 16px;
  letter-spacing: 0.04em;
  color: var(--gold);
  margin-bottom: 12px;
}
.ta-foot p, .ta-foot ul {
  font-family: var(--body);
  font-size: 14.5px;
  color: var(--cream);
  opacity: 0.8;
  line-height: 1.65;
  margin: 0;
}
.ta-foot ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ta-foot a {
  color: var(--cream);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: all 0.2s;
}
.ta-foot a:hover { color: var(--gold); border-bottom-color: var(--gold); }
.ta-foot p em { color: var(--gold); font-style: italic; }
.ta-foot p strong { color: var(--gold); font-weight: 600; }
.ta-foot-tail {
  font-family: var(--display);
  font-size: 14px;
  letter-spacing: 0.16em;
  color: var(--gold);
  text-align: center;
  margin-top: 22px;
}

@media (prefers-reduced-motion: reduce) {
  .ta-chamak-shimmer, .ta-chamak-track, .ta-end-rosette { animation: none; }
}
`;
