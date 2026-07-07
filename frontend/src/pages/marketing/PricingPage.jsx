import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { API_BASE } from "../../config";
import Seo from "./Seo";
import { MarketingLayout, SectionHeading, FaqList, CtaBand, StartFreeButton } from "./components";
import { Link } from "react-router-dom";

const CYCLES = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "semi_annual", label: "6 months" },
  { key: "annual", label: "Annual" },
];

// Fallback if the live pricing endpoint is unreachable (matches plan_pricing
// as of 2026-07-07). The live response always wins.
const FALLBACK = [
  { plan: "pro", cycle: "monthly", price: 8000, currency_code: "PKR", months: 1, monthly_equivalent: 8000, discount_percent: 0 },
  { plan: "pro", cycle: "quarterly", price: 21600, currency_code: "PKR", months: 3, monthly_equivalent: 7200, discount_percent: 10 },
  { plan: "pro", cycle: "semi_annual", price: 40800, currency_code: "PKR", months: 6, monthly_equivalent: 6800, discount_percent: 15 },
  { plan: "pro", cycle: "annual", price: 80000, currency_code: "PKR", months: 12, monthly_equivalent: 6667, discount_percent: 17 },
];

const FREE_FEATURES = [
  "Full point of sale with offline queue",
  "Inventory, purchasing & suppliers",
  "Customer profiles & receipts",
  "Reports & owner dashboard",
  "1 outlet · 3 employees · 100 products",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Unlimited employees and products",
  "Your industry's vertical engines (bookings, tickets, rentals, rooms, plans…)",
  "Customer portal & online booking",
  "Loyalty, gift cards & marketing tools",
  "Integrations: Shopify, WooCommerce, marketplaces, couriers",
  "Additional outlets as paid add-ons",
];

function fmtPrice(price, currency) {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${currency} ${Number(price).toLocaleString()}`;
  }
}

export default function PricingPage() {
  const [rows, setRows] = useState(FALLBACK);
  const [cycle, setCycle] = useState("monthly");

  useEffect(() => {
    // public endpoint, no auth — raw fetch is the convention on public pages
    fetch(`${API_BASE}/api/billing/pricing`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        // only the plans signup actually offers (free is static, pro is priced)
        const pro = (Array.isArray(data) ? data : []).filter((r) => r.plan === "pro");
        if (pro.length) setRows(pro);
      })
      .catch(() => {});
  }, []);

  const current = useMemo(
    () => rows.find((r) => r.cycle === cycle) || rows[0],
    [rows, cycle]
  );
  const availableCycles = CYCLES.filter((c) => rows.some((r) => r.cycle === c.key));

  const faq = [
    { q: "What happens when my trial ends?", a: "You get a 7-day grace period, then the account becomes read-only until renewed — your data is never deleted. You can also fall back to the Free plan." },
    { q: "Can I switch industries later?", a: "Yes — re-apply a different industry preset from Settings → Business Profile at any time." },
    { q: "Is Free really free?", a: "Yes — within its limits (1 outlet, 3 employees, 100 products), forever. No card required." },
    { q: "How do I pay?", a: "Subscriptions are activated from your dashboard — pay by bank transfer and our team confirms your account. No card required." },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return (
    <MarketingLayout>
      <Seo
        title="Pricing — SanoPOS"
        description="Free forever for small counters. Pro with a 45-day free trial — unlimited employees and products. No credit card to start."
        path="/pricing"
        ogImage="/og/default.png"
        jsonLd={jsonLd}
      />

      <section className="mx-auto max-w-5xl px-5 pb-20 pt-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-widest text-(--ui-text-muted)">Pricing</p>
          <h1 className="mt-3 text-[clamp(2.1rem,5vw,3.2rem)] font-bold leading-[1.08] tracking-tight">
            Start free. Upgrade when you outgrow it.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-(--ui-text-muted)">
            Every new account starts with a 45-day Pro trial. When it ends, keep Pro or fall back
            to Free — your data stays.
          </p>
        </div>

        {/* cycle toggle */}
        <div className="mt-10 flex justify-center">
          <div className="inline-flex rounded-full border border-(--ui-border-strong) p-1">
            {availableCycles.map((c) => {
              const row = rows.find((r) => r.cycle === c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => setCycle(c.key)}
                  className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${
                    cycle === c.key ? "bg-(--ui-primary) text-(--ui-on-primary)" : "text-(--ui-text-muted) hover:text-(--ui-text)"
                  }`}
                >
                  {c.label}
                  {row?.discount_percent > 0 && (
                    <span className={`ml-1.5 text-[11px] ${cycle === c.key ? "text-white/70" : "text-(--ui-success-fg)"}`}>
                      −{row.discount_percent}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* plans */}
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="rounded-(--ui-radius-lg) border border-(--ui-border-strong) p-8">
            <h2 className="text-lg font-bold">Free</h2>
            <p className="mt-1 text-sm text-(--ui-text-muted)">For a single small counter.</p>
            <p className="mt-5 text-4xl font-bold tracking-tight">
              Free
              <span className="text-base font-medium text-(--ui-text-muted)"> / forever</span>
            </p>
            <ul className="mt-6 space-y-2.5">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check size={16} className="mt-0.5 shrink-0 text-(--ui-success-fg)" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link to="/signup" className="inline-flex w-full items-center justify-center rounded-full border border-(--ui-border-strong) px-5 py-2.5 text-sm font-semibold hover:bg-(--ui-muted-surface)">
                Start free
              </Link>
            </div>
          </div>

          <div className="relative rounded-(--ui-radius-lg) border-2 border-(--ui-primary) p-8">
            <span className="absolute -top-3 left-8 rounded-full bg-(--ui-primary) px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-(--ui-on-primary)">
              45-day free trial
            </span>
            <h2 className="text-lg font-bold">Pro</h2>
            <p className="mt-1 text-sm text-(--ui-text-muted)">The whole system, your industry's engines included.</p>
            <p className="mt-5 text-4xl font-bold tracking-tight">
              {current ? fmtPrice(current.monthly_equivalent, current.currency_code) : "—"}
              <span className="text-base font-medium text-(--ui-text-muted)"> / month</span>
            </p>
            {current && current.months > 1 && (
              <p className="mt-1 text-sm text-(--ui-text-muted)">
                billed {fmtPrice(current.price, current.currency_code)} every {current.months} months
              </p>
            )}
            <ul className="mt-6 space-y-2.5">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check size={16} className="mt-0.5 shrink-0 text-(--ui-success-fg)" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <StartFreeButton big />
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-(--ui-text-muted)">
          Subscriptions are activated from your dashboard — pay by bank transfer and your account
          is confirmed by our team. No card required.
        </p>
      </section>

      <section className="border-t border-(--ui-border) bg-(--ui-sidebar)">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHeading kicker="FAQ" title="Pricing questions" />
          <div className="mt-8">
            <FaqList items={faq} />
          </div>
        </div>
      </section>

      <CtaBand title="Try everything for 45 days." sub="No card, no lock-in. Your data is exportable at any time." />
    </MarketingLayout>
  );
}
