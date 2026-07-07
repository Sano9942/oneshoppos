import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingBag, WifiOff, MonitorSmartphone, Printer, Package, Users,
  UserCog, Landmark, BarChart3, Store, ArrowRight,
} from "lucide-react";
import Seo from "./Seo";
import {
  MarketingLayout, SectionHeading, BrowserFrame, StatStrip, SpecTable,
  CtaBand, StartFreeButton, DemoButton,
} from "./components";
import { INDUSTRIES } from "./content/industries";

const REGISTER_POINTS = [
  { icon: ShoppingBag, title: "Fast at the counter", body: "Barcode, SKU or price search, split payments, returns and exchanges, parked sales, cash shifts, PIN re-auth and F-key shortcuts. Cashiers stop thinking about the software." },
  { icon: WifiOff, title: "Keeps selling when the internet doesn't", body: "Sales queue locally and sync the moment the connection returns. Outages don't close your counter." },
  { icon: MonitorSmartphone, title: "Any device you already own", body: "Install as an app on a tablet, run the full dashboard on a laptop, check the day from your phone." },
  { icon: Printer, title: "Real hardware support", body: "USB barcode scanners, ESC/POS thermal printers and network printers work out of the box." },
];

const BACK_OFFICE = [
  { icon: Package, title: "Inventory", body: "Per-outlet stock, transfers, adjustments, purchasing and supplier receiving." },
  { icon: Users, title: "Customers", body: "Profiles, loyalty, gift cards, wallet, purchase history and a self-service portal." },
  { icon: UserCog, title: "Staff", body: "Roles and permissions, attendance kiosk, cash shifts and commissions." },
  { icon: Landmark, title: "Accounting", body: "P&L, journals, payables and receivables — in the same window." },
  { icon: BarChart3, title: "Reports", body: "Sales, stock, finance, staff and operations views from the same data." },
  { icon: Store, title: "Multi-outlet", body: "Add branches and keep stock, pricing and staff access connected." },
];

const SPEC_ROWS = [
  ["Runs on", "Browser · tablet · phone · installs as an app"],
  ["Offline", "Local sale queue, auto-sync on reconnect"],
  ["Hardware", "USB scanners · ESC/POS thermal · network printers"],
  ["Channels", "Shopify · WooCommerce · Daraz · Facebook · WhatsApp · Google Merchant"],
  ["Security", "Role-based permissions · manager PIN overrides · audit trail"],
  ["Localization", "FBR digital invoicing · 13 couriers · foodpanda & Careem capture (Pakistan)"],
];

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "SanoPOS",
      url: "https://sanopos.com",
      logo: "https://sanopos.com/icon-512.png",
    },
    {
      "@type": "SoftwareApplication",
      name: "SanoPOS",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://sanopos.com",
      description:
        "Point of sale, inventory, staff, bookings and billing that reshape themselves for retail, restaurants, salons, clinics, gyms, wholesale, rentals, hotels and more.",
    },
  ],
};

export default function HomePage() {
  const [active, setActive] = useState(INDUSTRIES[0]);

  return (
    <MarketingLayout>
      <Seo
        title="SanoPOS — The POS that adapts to your industry"
        description="Point of sale, inventory, staff, bookings and billing that reshape themselves for retail, restaurants, salons, clinics, gyms, wholesale, rentals, hotels and more. Free to start."
        path="/"
        ogImage="/og/default.png"
        jsonLd={JSON_LD}
      />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-16 text-center sm:pt-20">
        <p className="text-[13px] font-semibold uppercase tracking-widest text-(--ui-text-muted)">
          Point of sale · Inventory · Customers · Billing
        </p>
        <h1 className="mx-auto mt-4 max-w-3xl text-[clamp(2.4rem,6vw,4rem)] font-bold leading-[1.05] tracking-tight">
          The point of sale that speaks your industry's language.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-(--ui-text-muted)">
          Pick your business type and SanoPOS reshapes itself — the register, the words on every
          screen, the dashboard, the reports, even your customers' portal. A butcher sells by
          weight. A dentist charts teeth. A hotel runs folios. Same system, your system.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <StartFreeButton big />
          <DemoButton big />
        </div>

        {/* industry switcher */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
          {INDUSTRIES.map((i) => (
            <button
              key={i.slug}
              onClick={() => setActive(i)}
              className={`rounded-full border px-4 py-1.5 text-[13px] font-semibold transition ${
                active.slug === i.slug
                  ? "border-(--ui-primary) bg-(--ui-primary) text-(--ui-on-primary)"
                  : "border-(--ui-border-strong) text-(--ui-text-muted) hover:border-(--ui-text-muted) hover:text-(--ui-text)"
              }`}
            >
              {i.chip}
            </button>
          ))}
        </div>
        <BrowserFrame src={active.shot} alt={active.shotAlt} className="mt-6 shadow-(--ui-shadow-lg)" />
        <p className="mt-3 text-sm text-(--ui-text-muted)">
          {active.name} — <Link to={`/industries/${active.slug}`} className="font-medium text-(--ui-link) hover:underline">see how {active.name.toLowerCase()} run on SanoPOS →</Link>
        </p>
      </section>

      <StatStrip items={[["23", "industry presets"], ["10", "vertical engines"], ["13", "courier integrations"], ["Offline", "sale queue built in"], ["Free", "to start"]]} />

      {/* Industry grid */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <SectionHeading
          kicker="Industries"
          title="Pick your business. We've already set it up."
          copy="Every preset changes the vocabulary, POS layout, dashboard, reports and customer portal — before you sell your first item."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INDUSTRIES.map((i) => (
            <Link
              key={i.slug}
              to={`/industries/${i.slug}`}
              className="group rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-6 transition hover:border-(--ui-border-strong)"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold">{i.name}</h3>
                <ArrowRight size={16} className="text-(--ui-text-muted) transition group-hover:translate-x-0.5 group-hover:text-(--ui-text)" />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-(--ui-text-muted)">{i.cardLine}</p>
            </Link>
          ))}
          <Link
            to="/industries"
            className="flex items-center justify-center rounded-(--ui-radius-md) border border-dashed border-(--ui-border-strong) p-6 text-sm font-semibold text-(--ui-link) hover:bg-(--ui-muted-surface)"
          >
            All 23 business types →
          </Link>
        </div>
      </section>

      {/* Register */}
      <section className="border-y border-(--ui-border) bg-(--ui-sidebar)">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHeading kicker="The register" title="One register. Every way you sell." />
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {REGISTER_POINTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-(--ui-radius-md) border border-(--ui-border) bg-white p-6">
                <Icon size={20} className="text-(--ui-text)" />
                <h3 className="mt-3 font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-(--ui-text-muted)">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Back office */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <SectionHeading kicker="Beyond the counter" title="Your back office, included." />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BACK_OFFICE.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-6">
              <Icon size={20} />
              <h3 className="mt-3 font-bold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-(--ui-text-muted)">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Customer front door */}
      <section className="border-y border-(--ui-border) bg-(--ui-sidebar)">
        <div className="mx-auto max-w-4xl px-5 py-20 text-center">
          <SectionHeading
            kicker="Your customers"
            title="Your customers get a front door too."
            copy="Online booking pages that speak your vocabulary — “Book an appointment” at a salon, “Book a stay” at a hotel — a self-service portal with the tabs your industry needs (invoices, bookings, treatment plans, memberships, rental agreements, repair tickets), and an embedded storefront when you want to sell online."
          />
        </div>
      </section>

      {/* Spec sheet */}
      <section className="mx-auto max-w-4xl px-5 py-20">
        <SectionHeading kicker="Under the hood" title="The boring details, handled." />
        <div className="mt-8">
          <SpecTable rows={SPEC_ROWS} />
        </div>
        <p className="mt-6 text-center text-sm text-(--ui-text-muted)">
          Built global, localized deep — in Pakistan that means FBR Digital Invoicing at the moment
          of sale, 13 courier integrations, foodpanda and Careem order capture, and PKR billing.{" "}
          <Link to="/why-sanopos#localization" className="font-medium text-(--ui-link) hover:underline">Learn more</Link>
        </p>
      </section>

      <CtaBand
        title="Set up your business in minutes."
        sub="Free plan forever — 1 outlet, 3 employees, 100 products. Every new account starts with a 45-day Pro trial."
      />
    </MarketingLayout>
  );
}
