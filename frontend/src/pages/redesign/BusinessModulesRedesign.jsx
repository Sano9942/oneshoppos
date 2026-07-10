import { useState, useEffect, useMemo } from "react";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Badge, EmptyState } from "../../ui/primitives";
import { Lock, Sparkles } from "lucide-react";
import { api } from "../../api";

const STATE_BADGE = {
  on: { label: "On", tone: "success" },
  off: { label: "Off", tone: "default" },
  setup_required: { label: "Needs setup", tone: "warning" },
  connected: { label: "Connected", tone: "success" },
  locked: { label: "Locked", tone: "default" },
  attention_required: { label: "Attention", tone: "warning" },
};

const BUCKET_GROUPS = [
  { bucket: "A", label: "Business types", blurb: "Full verticals — each adds its own pages, POS behavior and workflows." },
  { bucket: "B", label: "Optional features", blurb: "Add-on capabilities that layer onto any business type." },
  { bucket: "C", label: "Integrations & compliance", blurb: "External connections that need credentials or configuration before they work." },
];

function StateBadge({ module: m }) {
  const badge = STATE_BADGE[m.state] || STATE_BADGE.off;
  return (
    <Badge tone={badge.tone}>
      {m.state === "locked" && <Lock size={10} />}
      {badge.label}
    </Badge>
  );
}

function ModuleCard({ module: m, titleByKey }) {
  const requires = (m.depends_on || []).map((k) => titleByKey[k] || k);
  return (
    <div className="border border-(--ui-border) rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-(--ui-text)">{m.title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {m.preset_recommended && (
            <Badge tone="default"><Sparkles size={10} /> Recommended</Badge>
          )}
          <StateBadge module={m} />
        </div>
      </div>

      <p className="text-sm text-(--ui-muted)">{m.description}</p>

      {requires.length > 0 && (
        <p className="text-xs text-(--ui-muted)">Requires {requires.join(", ")}</p>
      )}

      {m.state === "setup_required" && m.setup_required_when && (
        <p className="text-xs text-(--ui-muted)">{m.setup_required_when}</p>
      )}

      {m.state === "locked" && (
        <p className="text-xs text-(--ui-muted)">This module is locked for your account. Contact support to enable it.</p>
      )}

      {m.sub_toggles?.length > 0 && (
        <div className="mt-1 border-t border-(--ui-border) pt-2 space-y-1.5">
          {m.sub_toggles.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-2">
              <span className="text-sm text-(--ui-text)">{s.title}</span>
              <Badge tone={s.enabled ? "success" : "default"}>{s.enabled ? "On" : "Off"}</Badge>
            </div>
          ))}
        </div>
      )}

      {m.roles_with_access?.length > 0 && (
        <p className="text-xs text-(--ui-muted) mt-auto pt-1">
          Staff access: {m.roles_with_access.join(", ")}
        </p>
      )}
    </div>
  );
}

export default function BusinessModulesRedesign() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/api/business-modules")
      .then(setData)
      .catch((err) => toast.error(err.message || "Failed to load business modules"))
      .finally(() => setLoading(false));
  }, []);

  const modules = data?.modules || [];
  const titleByKey = useMemo(
    () => Object.fromEntries(modules.map((m) => [m.key, m.title])),
    [modules]
  );
  const recommended = modules.filter((m) => m.preset_recommended);

  return (
    <PageShell
      title="Business Modules"
      subtitle="See which features are on for your business. Turning a module off hides it — your data and settings are always kept."
    >
      {loading ? (
        <SectionCard>
          <p className="text-(--ui-muted) text-sm py-8 text-center">Loading...</p>
        </SectionCard>
      ) : modules.length === 0 ? (
        <SectionCard>
          <EmptyState title="No modules available" subtitle="The module catalog could not be loaded." />
        </SectionCard>
      ) : (
        <div className="space-y-6">
          {recommended.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-(--ui-text) mb-1">Recommended for your industry</h2>
              <p className="text-xs text-(--ui-muted) mb-2">
                Based on your business type{data?.outlet_count > 1 ? " and locations" : ""}.
              </p>
              <SectionCard>
                <div className="grid gap-3 md:grid-cols-2">
                  {recommended.map((m) => (
                    <ModuleCard key={m.key} module={m} titleByKey={titleByKey} />
                  ))}
                </div>
              </SectionCard>
            </div>
          )}

          {BUCKET_GROUPS.map((group) => {
            const cards = modules.filter((m) => m.bucket === group.bucket);
            if (cards.length === 0) return null;
            return (
              <div key={group.bucket}>
                <h2 className="text-sm font-semibold text-(--ui-text) mb-1">{group.label}</h2>
                <p className="text-xs text-(--ui-muted) mb-2">{group.blurb}</p>
                <SectionCard>
                  <div className="grid gap-3 md:grid-cols-2">
                    {cards.map((m) => (
                      <ModuleCard key={m.key} module={m} titleByKey={titleByKey} />
                    ))}
                  </div>
                </SectionCard>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
