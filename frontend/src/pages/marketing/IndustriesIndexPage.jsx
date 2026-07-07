import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Seo from "./Seo";
import { MarketingLayout, CtaBand } from "./components";
import { INDUSTRIES } from "./content/industries";

export default function IndustriesIndexPage() {
  return (
    <MarketingLayout>
      <Seo
        title="Industries — SanoPOS"
        description="SanoPOS ships ready-made for 23 business types across 10 industry families — see yours."
        path="/industries"
        ogImage="/og/default.png"
      />
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-widest text-(--ui-text-muted)">Industries</p>
          <h1 className="mt-3 text-[clamp(2.1rem,5vw,3.2rem)] font-bold leading-[1.08] tracking-tight">
            23 business types. Ready on day one.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-(--ui-text-muted)">
            Every preset reconfigures the register, vocabulary, dashboard, reports and customer
            portal for how your business actually works.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {INDUSTRIES.map((i) => (
            <Link
              key={i.slug}
              to={`/industries/${i.slug}`}
              className="group rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-6 transition hover:border-(--ui-border-strong)"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{i.name}</h2>
                <ArrowRight size={16} className="text-(--ui-text-muted) transition group-hover:translate-x-0.5 group-hover:text-(--ui-text)" />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-(--ui-text-muted)">{i.cardLine}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {i.presets.map((p) => (
                  <span key={p} className="rounded-full bg-(--ui-muted-surface) px-2.5 py-1 text-[11px] font-semibold text-(--ui-text-muted)">
                    {p}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </section>
      <CtaBand title="Don't see your exact business?" sub="Start with the closest preset — you can re-apply a different one from Settings at any time." />
    </MarketingLayout>
  );
}
