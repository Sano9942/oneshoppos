import { Check, X } from "lucide-react";
import Seo from "./Seo";
import { MarketingLayout, SectionHeading, SpecTable, CtaBand } from "./components";

const STACK_ROWS = [
  ["Sell in person", "A POS subscription", "Included"],
  ["Take bookings", "A booking app", "Included"],
  ["Memberships & passes", "A membership tool", "Included"],
  ["Track stock & purchasing", "Spreadsheets + a stock app", "Included"],
  ["Kitchen orders", "A separate KDS tablet", "Included"],
  ["Client galleries / portals", "A gallery or portal service", "Included"],
  ["Books & receivables", "An accounting export", "Included"],
];

const HONEST_POINTS = [
  { title: "Works offline at the counter", body: "Sales queue locally on the device and sync when the connection returns — a power cut isn't a closed shop." },
  { title: "Permissions with teeth", body: "Role-based permissions on every route, manager-PIN overrides for voids, comps and price changes, and an audit trail on sensitive actions." },
  { title: "Your data stays yours", body: "CSV export on every report, self-service database export, and no lock-in pricing games." },
  { title: "One customer record", body: "The same customer exists at the counter, in bookings, on invoices and in the portal — not four half-profiles in four tools." },
];

const LOCALIZATION_ROWS = [
  ["FBR e-invoicing", "Real-time IRN + QR at the moment of sale, automatic retry queue with backoff"],
  ["Tax lookup", "HS-code tax rate search with category-level inheritance"],
  ["Couriers", "Leopards · TCS · BlueEx · Trax · CallCourier · M&P · PostEx · Rider · Swyft · Bykea · Pakistan Post · DHL · FedEx"],
  ["Delivery apps", "foodpanda & Careem order capture into one inbox"],
  ["Cash on delivery", "COD reconciliation and dispatch loadsheets"],
  ["Billing", "PKR pricing · WhatsApp receipt sharing"],
];

export default function WhySanoPosPage() {
  return (
    <MarketingLayout>
      <Seo
        title="Why SanoPOS"
        description="One system that adapts per industry instead of ten point products — why businesses replace their POS, booking tool and spreadsheets with SanoPOS."
        path="/why-sanopos"
        ogImage="/og/default.png"
      />

      <section className="mx-auto max-w-6xl px-5 pb-16 pt-16 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-widest text-(--ui-text-muted)">Why SanoPOS</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-[clamp(2.1rem,5vw,3.4rem)] font-bold leading-[1.08] tracking-tight">
          Stop stitching tools together.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-(--ui-text-muted)">
          A POS here, a booking app there, spreadsheets for stock and someone's phone for the
          kitchen. SanoPOS replaces the stack with one system that already knows your industry.
        </p>
      </section>

      {/* Adaptive core */}
      <section className="border-y border-(--ui-border) bg-(--ui-sidebar)">
        <div className="mx-auto max-w-3xl px-5 py-16 text-center">
          <SectionHeading
            kicker="The adaptive core"
            title="23 presets. 10 vertical engines. One product."
            copy="Not an “industry edition” you buy separately — one product that reconfigures itself: vocabulary, POS layout, dashboard widgets, reports, portal tabs, even the words on your public booking page. Pick a preset at signup; change it later from Settings."
          />
        </div>
      </section>

      {/* Stack compare */}
      <section className="mx-auto max-w-4xl px-5 py-20">
        <SectionHeading kicker="Compare the stack" title="Seven subscriptions or one." />
        <div className="mt-8 overflow-x-auto rounded-(--ui-radius-md) border border-(--ui-border-strong)">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border-strong) bg-(--ui-muted-surface) text-left">
                <th className="px-5 py-3 font-semibold">You need to…</th>
                <th className="px-5 py-3 font-semibold">Typical stack</th>
                <th className="px-5 py-3 font-semibold">SanoPOS</th>
              </tr>
            </thead>
            <tbody>
              {STACK_ROWS.map(([need, stack, ours]) => (
                <tr key={need} className="border-b border-(--ui-border) last:border-0">
                  <td className="px-5 py-3.5 font-medium">{need}</td>
                  <td className="px-5 py-3.5 text-(--ui-text-muted)">
                    <span className="inline-flex items-center gap-1.5"><X size={14} className="text-(--ui-danger)" />{stack}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1.5 font-medium"><Check size={14} className="text-(--ui-success-fg)" />{ours}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-center text-xs text-(--ui-text-muted)">
          One login, one customer record, one report layer — instead of tool sprawl.
        </p>
      </section>

      {/* Honest engineering */}
      <section className="border-y border-(--ui-border) bg-(--ui-sidebar)">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHeading kicker="Honest engineering" title="Built for bad days, not just demos." />
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {HONEST_POINTS.map(({ title, body }) => (
              <div key={title} className="rounded-(--ui-radius-md) border border-(--ui-border) bg-white p-6">
                <h3 className="font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-(--ui-text-muted)">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Localization */}
      <section id="localization" className="mx-auto max-w-4xl scroll-mt-24 px-5 py-20">
        <SectionHeading
          kicker="Built global. Localized deep."
          title="Your currency anywhere. Compliance where it counts."
          copy="SanoPOS works in your currency, timezone and tax mode in any market. And where we localize, we go deep — in Pakistan, compliance and logistics are built in, not bolted on."
        />
        <div className="mt-8">
          <SpecTable rows={LOCALIZATION_ROWS} />
        </div>
      </section>

      <CtaBand title="Your industry is already set up." sub="Start on the Free plan with a 45-day Pro trial — no card required." />
    </MarketingLayout>
  );
}
