import { useParams, Navigate, Link } from "react-router-dom";
import Seo from "./Seo";
import {
  MarketingLayout, SectionHeading, BrowserFrame, FeatureBlock, FaqList,
  CtaBand, StartFreeButton, DemoButton,
} from "./components";
import { bySlug, INDUSTRIES } from "./content/industries";

export default function IndustryPage() {
  const { slug } = useParams();
  const ind = bySlug(slug);
  if (!ind) return <Navigate to="/industries" replace />;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        name: `SanoPOS for ${ind.name}`,
        provider: { "@type": "Organization", name: "SanoPOS", url: "https://sanopos.com" },
        description: ind.metaDescription,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://sanopos.com/" },
          { "@type": "ListItem", position: 2, name: "Industries", item: "https://sanopos.com/industries" },
          { "@type": "ListItem", position: 3, name: ind.name, item: `https://sanopos.com/industries/${ind.slug}` },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: ind.faq.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  };

  const others = INDUSTRIES.filter((i) => i.slug !== ind.slug).slice(0, 3);

  return (
    <MarketingLayout>
      <Seo
        title={ind.metaTitle}
        description={ind.metaDescription}
        path={`/industries/${ind.slug}`}
        ogImage={`/og/${ind.slug}.png`}
        jsonLd={jsonLd}
      />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pb-14 pt-16 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-widest text-(--ui-text-muted)">{ind.name}</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-[clamp(2.1rem,5vw,3.4rem)] font-bold leading-[1.08] tracking-tight">
          {ind.h1}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-(--ui-text-muted)">{ind.sub}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <StartFreeButton big />
          <DemoButton big />
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {ind.presets.map((p) => (
            <span key={p} className="rounded-full bg-(--ui-muted-surface) px-3 py-1 text-[12px] font-semibold text-(--ui-text-muted)">
              {p}
            </span>
          ))}
        </div>
        <BrowserFrame src={ind.shot} alt={ind.shotAlt} className="mt-8 shadow-(--ui-shadow-lg)" />
      </section>

      {/* Feature blocks */}
      <section className="border-y border-(--ui-border) bg-(--ui-sidebar)">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHeading kicker="How it works" title={`How ${ind.name.toLowerCase()} run on SanoPOS`} />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {ind.blocks.map((b) => (
              <FeatureBlock key={b.title} {...b} />
            ))}
          </div>
        </div>
      </section>

      {/* Portal line */}
      <section className="mx-auto max-w-3xl px-5 py-16 text-center">
        <SectionHeading kicker="Your customers see it too" title="A front door in your brand" copy={ind.portalLine} />
      </section>

      {/* Spine strip */}
      <section className="border-y border-(--ui-border) bg-(--ui-sidebar)">
        <div className="mx-auto max-w-4xl px-5 py-14 text-center">
          <p className="text-[13px] font-semibold uppercase tracking-widest text-(--ui-text-muted)">Always included</p>
          <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-(--ui-text-muted)">
            Every SanoPOS plan ships the full spine: point of sale with an offline queue, inventory
            and purchasing, customer profiles with loyalty, staff roles and attendance, accounting,
            and reports — plus your industry's vertical engines on top.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <SectionHeading kicker="FAQ" title="Common questions" />
        <div className="mt-8">
          <FaqList items={ind.faq} />
        </div>
      </section>

      {/* Cross links */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <p className="mb-4 text-center text-sm font-semibold text-(--ui-text-muted)">Also on SanoPOS</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {others.map((i) => (
            <Link key={i.slug} to={`/industries/${i.slug}`} className="rounded-(--ui-radius-md) border border-(--ui-border) p-5 transition hover:border-(--ui-border-strong)">
              <p className="font-bold">{i.name}</p>
              <p className="mt-1 text-sm text-(--ui-text-muted)">{i.cardLine}</p>
            </Link>
          ))}
        </div>
      </section>

      <CtaBand title="Your industry is already set up." sub="Start on the Free plan with a 45-day Pro trial — no card required." />
    </MarketingLayout>
  );
}
