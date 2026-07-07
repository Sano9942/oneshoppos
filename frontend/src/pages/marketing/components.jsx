import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Menu, X, Check } from "lucide-react";
import { INDUSTRIES } from "./content/industries";

export const DEMO_MAILTO =
  "mailto:demo@sanopos.com?subject=SanoPOS%20demo%20request&body=Hi%2C%20I%27d%20like%20a%20demo%20of%20SanoPOS.%0ABusiness%20type%3A%20%0ACity%2Fcountry%3A%20";

/* ── CTA buttons ─────────────────────────────────────────────── */

export function StartFreeButton({ big = false, inverse = false }) {
  const base = big ? "px-7 py-3.5 text-base" : "px-5 py-2.5 text-sm";
  const tone = inverse
    ? "bg-white text-(--ui-text) hover:bg-neutral-100"
    : "bg-(--ui-primary) text-(--ui-on-primary) hover:bg-(--ui-primary-strong)";
  return (
    <Link to="/signup" className={`inline-flex items-center justify-center rounded-full font-semibold transition ${base} ${tone}`}>
      Start free — 45-day Pro trial
    </Link>
  );
}

export function DemoButton({ big = false, inverse = false }) {
  const base = big ? "px-7 py-3.5 text-base" : "px-5 py-2.5 text-sm";
  const tone = inverse
    ? "border border-white/40 text-white hover:bg-white/10"
    : "border border-(--ui-border-strong) text-(--ui-text) hover:bg-(--ui-muted-surface)";
  return (
    <a href={DEMO_MAILTO} className={`inline-flex items-center justify-center rounded-full font-semibold transition ${base} ${tone}`}>
      Book a demo
    </a>
  );
}

/* ── Nav + footer ────────────────────────────────────────────── */

export function MarketingLayout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [industriesOpen, setIndustriesOpen] = useState(false);

  return (
    <div className="min-h-screen bg-(--ui-bg) font-(family-name:--ui-font) text-(--ui-text)">
      <header className="sticky top-0 z-100 border-b border-(--ui-border) bg-white/95 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link to="/" className="text-lg font-extrabold tracking-tight">
            Sano<span className="text-(--ui-text-muted)">POS</span>
          </Link>

          {/* desktop */}
          <div className="hidden items-center gap-1 md:flex">
            <div
              className="relative"
              onMouseEnter={() => setIndustriesOpen(true)}
              onMouseLeave={() => setIndustriesOpen(false)}
            >
              <button
                className="flex items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text)"
                onClick={() => setIndustriesOpen((v) => !v)}
              >
                Industries <ChevronDown size={14} />
              </button>
              {industriesOpen && (
                <div className="absolute left-0 top-full w-64 rounded-(--ui-radius-md) border border-(--ui-border-strong) bg-white p-2 shadow-(--ui-shadow-lg)">
                  {INDUSTRIES.map((i) => (
                    <Link
                      key={i.slug}
                      to={`/industries/${i.slug}`}
                      onClick={() => setIndustriesOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm hover:bg-(--ui-muted-surface)"
                    >
                      {i.name}
                    </Link>
                  ))}
                  <Link
                    to="/industries"
                    onClick={() => setIndustriesOpen(false)}
                    className="mt-1 block border-t border-(--ui-border) px-3 py-2 text-sm font-semibold text-(--ui-link)"
                  >
                    All 23 business types →
                  </Link>
                </div>
              )}
            </div>
            <Link to="/pricing" className="rounded-full px-3 py-2 text-sm font-medium text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text)">
              Pricing
            </Link>
            <Link to="/why-sanopos" className="rounded-full px-3 py-2 text-sm font-medium text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text)">
              Why SanoPOS
            </Link>
          </div>

          <div className="ml-auto hidden items-center gap-3 md:flex">
            <Link to="/login" className="text-sm font-medium text-(--ui-text-muted) hover:text-(--ui-text)">
              Sign in
            </Link>
            <Link to="/signup" className="rounded-full bg-(--ui-primary) px-5 py-2.5 text-sm font-semibold text-(--ui-on-primary) hover:bg-(--ui-primary-strong)">
              Start free
            </Link>
          </div>

          {/* mobile toggle */}
          <button
            className="ml-auto rounded-full p-2 hover:bg-(--ui-muted-surface) md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </nav>

        {mobileOpen && (
          <div className="border-t border-(--ui-border) bg-white px-5 pb-5 pt-2 md:hidden">
            <p className="px-1 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Industries</p>
            <div className="grid grid-cols-2 gap-1">
              {INDUSTRIES.map((i) => (
                <Link key={i.slug} to={`/industries/${i.slug}`} onClick={() => setMobileOpen(false)} className="rounded-lg px-2 py-1.5 text-sm hover:bg-(--ui-muted-surface)">
                  {i.name}
                </Link>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-1 border-t border-(--ui-border) pt-3">
              <Link to="/pricing" onClick={() => setMobileOpen(false)} className="rounded-lg px-2 py-2 text-sm font-medium hover:bg-(--ui-muted-surface)">Pricing</Link>
              <Link to="/why-sanopos" onClick={() => setMobileOpen(false)} className="rounded-lg px-2 py-2 text-sm font-medium hover:bg-(--ui-muted-surface)">Why SanoPOS</Link>
              <Link to="/login" onClick={() => setMobileOpen(false)} className="rounded-lg px-2 py-2 text-sm font-medium hover:bg-(--ui-muted-surface)">Sign in</Link>
              <Link to="/signup" onClick={() => setMobileOpen(false)} className="mt-2 rounded-full bg-(--ui-primary) px-5 py-2.5 text-center text-sm font-semibold text-(--ui-on-primary)">
                Start free
              </Link>
            </div>
          </div>
        )}
      </header>

      <main>{children}</main>

      <footer className="border-t border-(--ui-border) bg-(--ui-sidebar)">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-lg font-extrabold tracking-tight">Sano<span className="text-(--ui-text-muted)">POS</span></p>
            <p className="mt-2 max-w-xs text-sm text-(--ui-text-muted)">One system that becomes your system.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Product</p>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <Link to="/pricing" className="hover:underline">Pricing</Link>
              <Link to="/why-sanopos" className="hover:underline">Why SanoPOS</Link>
              <Link to="/login" className="hover:underline">Sign in</Link>
              <Link to="/signup" className="hover:underline">Start free</Link>
              <Link to="/terms" className="hover:underline">Terms</Link>
              <Link to="/privacy" className="hover:underline">Privacy</Link>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Industries</p>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              {INDUSTRIES.map((i) => (
                <Link key={i.slug} to={`/industries/${i.slug}`} className="hover:underline">{i.name}</Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Built for your market</p>
            <p className="mt-3 text-sm text-(--ui-text-muted)">
              FBR Digital Invoicing, PKR billing, 13 courier integrations and foodpanda/Careem order capture for businesses in Pakistan.{" "}
              <Link to="/why-sanopos#localization" className="font-medium text-(--ui-link) hover:underline">Learn more</Link>
            </p>
          </div>
        </div>
        <div className="border-t border-(--ui-border) py-5 text-center text-xs text-(--ui-text-muted)">
          © 2026 SanoPOS. One system that becomes your system.
        </div>
      </footer>
    </div>
  );
}

/* ── Shared sections ─────────────────────────────────────────── */

export function SectionHeading({ kicker, title, copy }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {kicker && <p className="text-[13px] font-semibold uppercase tracking-widest text-(--ui-text-muted)">{kicker}</p>}
      <h2 className="mt-2 text-[clamp(1.7rem,3.2vw,2.25rem)] font-bold leading-tight tracking-tight">{title}</h2>
      {copy && <p className="mt-3 text-base leading-relaxed text-(--ui-text-muted)">{copy}</p>}
    </div>
  );
}

export function BrowserFrame({ src, alt, className = "" }) {
  return (
    <figure className={`overflow-hidden rounded-(--ui-radius-lg) border border-(--ui-border-strong) bg-white ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-(--ui-border) bg-(--ui-sidebar) px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-(--ui-border-strong)" />
        <span className="h-2.5 w-2.5 rounded-full bg-(--ui-border-strong)" />
        <span className="h-2.5 w-2.5 rounded-full bg-(--ui-border-strong)" />
      </div>
      <img src={src} alt={alt} width={1440} height={900} loading="lazy" className="block w-full" />
    </figure>
  );
}

export function StatStrip({ items }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 border-y border-(--ui-border) py-6">
      {items.map(([num, label]) => (
        <div key={label} className="text-center">
          <p className="text-2xl font-bold tracking-tight">{num}</p>
          <p className="text-xs font-medium uppercase tracking-wide text-(--ui-text-muted)">{label}</p>
        </div>
      ))}
    </div>
  );
}

export function FeatureBlock({ kicker, title, body, bullets }) {
  return (
    <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-7">
      <p className="text-[12px] font-semibold uppercase tracking-widest text-(--ui-text-muted)">{kicker}</p>
      <h3 className="mt-2 text-xl font-bold tracking-tight">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-(--ui-text-muted)">{body}</p>
      {bullets && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm">
              <Check size={16} className="mt-0.5 shrink-0 text-(--ui-success-fg)" />
              {b}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SpecTable({ rows }) {
  return (
    <div className="overflow-x-auto rounded-(--ui-radius-md) border border-(--ui-border-strong)">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-(--ui-border) last:border-0">
              <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">{k}</td>
              <td className="px-5 py-3.5">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FaqList({ items }) {
  return (
    <div className="mx-auto max-w-2xl divide-y divide-(--ui-border) rounded-(--ui-radius-md) border border-(--ui-border)">
      {items.map(({ q, a }) => (
        <details key={q} className="group px-6 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold">
            {q}
            <ChevronDown size={16} className="shrink-0 text-(--ui-text-muted) transition group-open:rotate-180" />
          </summary>
          <p className="mt-2 text-sm leading-relaxed text-(--ui-text-muted)">{a}</p>
        </details>
      ))}
    </div>
  );
}

export function CtaBand({ title, sub }) {
  return (
    <section className="bg-(--ui-primary)">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-16 text-center">
        <h2 className="text-[clamp(1.7rem,3.2vw,2.25rem)] font-bold tracking-tight text-white">{title}</h2>
        {sub && <p className="max-w-xl text-[15px] leading-relaxed text-white/80">{sub}</p>}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <StartFreeButton big inverse />
          <DemoButton big inverse />
        </div>
      </div>
    </section>
  );
}
