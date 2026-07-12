import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../contexts/ToastContext";
import { usePreset } from "../../contexts/PresetContext";
import { refreshFeatureFlags } from "../../hooks/useFeatureFlags";
import { PageShell, SectionCard, Badge, Button, Toggle, Tooltip, ConfirmDialog, EmptyState } from "../../ui/primitives";
import { Lock, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
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

function ModuleCard({ module: m, titleByKey, busyKey, onToggle, onSubToggle, onSetup }) {
  const requires = (m.depends_on || []).map((k) => titleByKey[k] || k);
  const isOn = m.state === "on";
  const busy = busyKey === m.key;
  const subsEnabled = isOn && !busy;
  // Sub-toggles are only usable once the parent module is on. When it's off we
  // still render them (so the merchant sees what's inside) but disabled with a
  // tooltip. Bucket C sub-toggles are read-only badges, so they never gate here.
  const parentOff = m.bucket !== "C" && !isOn;
  const subs = m.sub_toggles || [];
  const useExpander = subs.length > 3;
  const [showCustomize, setShowCustomize] = useState(false);

  return (
    <div className="border border-(--ui-border) rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-(--ui-text)">{m.title}</span>
        <div className="flex items-center gap-2 shrink-0">
          {m.preset_recommended && (
            <Badge tone="default"><Sparkles size={10} /> Recommended</Badge>
          )}
          <StateBadge module={m} />
          {m.bucket === "C" ? (
            <Button size="sm" tone={m.connected ? "default" : "primary"} disabled={m.state === "locked"} onClick={() => onSetup(m)}>
              {m.connected ? "Manage" : "Set up"}
            </Button>
          ) : (
            <Toggle
              checked={isOn}
              disabled={m.state === "locked" || busy}
              onChange={() => onToggle(m)}
              aria-label={`Toggle ${m.title}`}
            />
          )}
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

      {subs.length > 0 && (
        <div className="mt-1 border-t border-(--ui-border) pt-2">
          {/* Long sub-toggle lists (>3) collapse behind a Customize expander;
              short lists stay inline. */}
          {useExpander && (
            <Button
              tone="link"
              size="sm"
              onClick={() => setShowCustomize((v) => !v)}
              aria-expanded={showCustomize}
            >
              {showCustomize ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Customize ({subs.length})
            </Button>
          )}
          {(!useExpander || showCustomize) && (
            <div className={`space-y-2.5 ${useExpander ? "mt-2" : ""}`}>
              {subs.map((s) => {
                let control;
                if (m.bucket === "C") {
                  control = <Badge tone={s.enabled ? "success" : "default"}>{s.enabled ? "On" : "Off"}</Badge>;
                } else if (parentOff) {
                  control = (
                    <Tooltip label={`Enable ${m.title} first`}>
                      <Toggle checked={s.enabled} disabled aria-label={`Toggle ${s.title}`} />
                    </Tooltip>
                  );
                } else {
                  control = (
                    <Toggle
                      checked={s.enabled}
                      disabled={!subsEnabled || busyKey === s.key}
                      onChange={() => onSubToggle(m, s)}
                      aria-label={`Toggle ${s.title}`}
                    />
                  );
                }
                return (
                  <div key={s.key} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className={`text-sm ${subsEnabled ? "text-(--ui-text)" : "text-(--ui-muted)"}`}>{s.title}</span>
                      {s.description && <p className="text-xs text-(--ui-muted)">{s.description}</p>}
                    </div>
                    <div className="shrink-0 pt-0.5">{control}</div>
                  </div>
                );
              })}
            </div>
          )}
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
  const navigate = useNavigate();
  const { refreshPreset } = usePreset();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  // { key, title, direction: "enable"|"disable", impact, rolesBeyondAdmin }
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const reload = useCallback(async () => {
    const next = await api.get("/api/business-modules");
    setData(next);
  }, []);

  useEffect(() => {
    reload()
      .catch((err) => toast.error(err.message || "Failed to load business modules"))
      .finally(() => setLoading(false));
  }, []);

  const modules = data?.modules || [];
  const titleByKey = useMemo(
    () => Object.fromEntries(modules.map((m) => [m.key, m.title])),
    [modules]
  );
  // subKey -> { title, depends_on } so a skipped_restores toast can name the
  // sub-toggle that stayed off and the prerequisite it's waiting on.
  const subToggleByKey = useMemo(() => {
    const map = {};
    for (const mod of modules) {
      for (const s of mod.sub_toggles || []) {
        map[s.key] = { title: s.title, depends_on: s.depends_on || [] };
      }
    }
    return map;
  }, [modules]);
  const recommended = modules.filter((m) => m.preset_recommended);

  const doToggle = async (key, enabled, cascade) => {
    setBusyKey(key);
    setConfirmBusy(true);
    try {
      const res = await api.post(`/api/business-modules/${key}/toggle`, { enabled, cascade });
      const title = titleByKey[key] || key;
      const extras = [];
      if (res.also_enabled?.length) {
        extras.push(`also enabled ${res.also_enabled.map((k) => titleByKey[k] || k).join(", ")}`);
      }
      if (res.cascaded?.length) {
        extras.push(`also turned off ${res.cascaded.map((d) => d.title || d.key).join(", ")}`);
      }
      toast.success(`${title} turned ${enabled ? "on" : "off"}${extras.length ? " — " + extras.join("; ") : ""}`);
      if (res.left_connected?.length) {
        toast.warning(
          `${res.left_connected.map((d) => d.title || d.key).join(", ")} stays connected — disconnect it from its setup page.`
        );
      }
      // A restored sub-toggle whose prerequisite isn't on is kept off by the
      // backend (dependency invariant beats exact restore) — tell the merchant why.
      if (res.skipped_restores?.length) {
        const msgs = res.skipped_restores.map((subKey) => {
          const sub = subToggleByKey[subKey];
          const subTitle = sub?.title || subKey;
          const prereqs = (sub?.depends_on || []).map((k) => titleByKey[k] || k);
          return prereqs.length
            ? `${subTitle} stayed off — enable ${prereqs.join(", ")} first`
            : `${subTitle} stayed off`;
        });
        toast.toast(msgs.join("; "), "info");
      }
      setConfirm(null);
      await reload();
      // Propagate to the two client cache layers so nav flag + mode gates
      // update in place (the backend invalidated its own caches already).
      refreshFeatureFlags();
      refreshPreset();
    } catch (err) {
      if (err.body?.code === "REQUIRES_SETUP" && err.body.setup_route) {
        navigate(err.body.setup_route);
        return;
      }
      toast.error(err.message || "Toggle failed");
    } finally {
      setBusyKey(null);
      setConfirmBusy(false);
    }
  };

  // Card toggle — enable may need a change-preview confirm, disable always
  // gets the warn+confirm with live counts (owner decision: never block,
  // never silent).
  const onToggle = async (m) => {
    const enabling = m.state !== "on";
    setBusyKey(m.key);
    try {
      if (enabling) {
        const rolesBeyondAdmin = (m.roles_with_access || []).filter((r) => r !== "Administrator");
        const needsPreview = (m.depends_on || []).length > 0 || rolesBeyondAdmin.length > 0;
        if (!needsPreview) {
          await doToggle(m.key, true, false);
          return;
        }
        const impact = await api.get(`/api/business-modules/${m.key}/impact`, { direction: "enable" });
        if (impact.locked) {
          const lockedTitle = titleByKey[impact.locked_module] || impact.locked_module;
          toast.error(`${lockedTitle} has been locked by the platform — contact support.`);
          return;
        }
        setConfirm({ key: m.key, title: m.title, direction: "enable", impact, rolesBeyondAdmin: m.roles_with_access });
      } else {
        const impact = await api.get(`/api/business-modules/${m.key}/impact`);
        setConfirm({ key: m.key, title: m.title, direction: "disable", impact });
      }
    } catch (err) {
      toast.error(err.message || "Could not load change preview");
    } finally {
      setBusyKey((k) => (k === m.key ? null : k));
    }
  };

  // Sub-toggle — direct write; an enable with dependencies gets the same
  // prerequisite preview as a card (e.g. Van Sales names Field Sales).
  const onSubToggle = async (m, s) => {
    const enabling = !s.enabled;
    if (enabling && (s.depends_on || []).length > 0) {
      setBusyKey(s.key);
      try {
        const impact = await api.get(`/api/business-modules/${s.key}/impact`, { direction: "enable" });
        if (impact.locked) {
          const lockedTitle = titleByKey[impact.locked_module] || impact.locked_module;
          toast.error(`${lockedTitle} has been locked by the platform — contact support.`);
          return;
        }
        if (impact.prerequisites?.length > 0) {
          setConfirm({ key: s.key, title: s.title, direction: "enable", impact, rolesBeyondAdmin: [] });
          return;
        }
      } catch (err) {
        toast.error(err.message || "Could not load change preview");
        return;
      } finally {
        setBusyKey((k) => (k === s.key ? null : k));
      }
    }
    await doToggle(s.key, enabling, false);
  };

  const onSetup = (m) => {
    if (m.setup_route) navigate(m.setup_route);
  };

  // Bucket C dependents are NOT cascaded off on disable — the backend leaves
  // them connected (their lifecycle belongs to their setup flow), so the
  // confirm copy must not claim they'll turn off.
  const disableDeps =
    confirm?.direction === "disable" ? confirm.impact.dependents || [] : [];
  const depsTurningOff = disableDeps.filter((d) => !(d.type === "module" && d.bucket === "C"));
  const depsStayingConnected = disableDeps.filter((d) => d.type === "module" && d.bucket === "C");

  // ConfirmDialog renders `body` inside a <p>, so only inline elements here
  // (block tags would trip React's DOM-nesting dev warning).
  const confirmBody = confirm && (
    <>
      {confirm.direction === "enable" ? (
        <>
          {confirm.impact.prerequisites?.length > 0 && (
            <span className="block mb-2 text-(--ui-text)">
              Will also enable:{" "}
              <span className="font-medium">{confirm.impact.prerequisites.map((p) => p.title).join(", ")}</span>
            </span>
          )}
          {confirm.rolesBeyondAdmin?.length > 0 && (
            <span className="block mb-2 text-(--ui-text)">
              Staff roles that will gain access:{" "}
              <span className="font-medium">{confirm.rolesBeyondAdmin.join(", ")}</span>
            </span>
          )}
          <span className="block">You can turn this off again at any time.</span>
        </>
      ) : (
        <>
          {(confirm.impact.counts || [])
            .filter((c) => c.count !== null && c.count > 0)
            .map((c) => (
              <span key={c.key} className="block mb-1 text-(--ui-text)">
                {c.label}: <span className="font-medium">{c.count}</span>
              </span>
            ))}
          {depsTurningOff.length > 0 && (
            <span className="block mb-2 text-(--ui-text)">
              Will also turn off:{" "}
              <span className="font-medium">{depsTurningOff.map((d) => d.title).join(", ")}</span>
            </span>
          )}
          {depsStayingConnected.length > 0 && (
            <span className="block mb-2 text-(--ui-text)">
              Will stay connected (disconnect via its setup page):{" "}
              <span className="font-medium">{depsStayingConnected.map((d) => d.title).join(", ")}</span>
            </span>
          )}
          <span className="block">
            Your data and settings are kept and restored when you re-enable this module — turning it off only hides it.
          </span>
        </>
      )}
    </>
  );

  return (
    <PageShell
      title="Business Modules"
      subtitle="Turn features on or off for your business. Turning a module off hides it — your data and settings are always kept."
    >
      <p className="text-xs text-(--ui-muted) -mt-2 mb-4">
        Changes apply immediately here. Other devices and open POS sessions pick them up on their next reload.
      </p>

      {loading ? (
        <SectionCard>
          <p className="text-(--ui-muted) text-sm py-8 text-center">Loading...</p>
        </SectionCard>
      ) : modules.length === 0 ? (
        <SectionCard>
          <EmptyState title="No modules available" body="The module catalog could not be loaded." />
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
                    <ModuleCard key={m.key} module={m} titleByKey={titleByKey} busyKey={busyKey}
                      onToggle={onToggle} onSubToggle={onSubToggle} onSetup={onSetup} />
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
                      <ModuleCard key={m.key} module={m} titleByKey={titleByKey} busyKey={busyKey}
                        onToggle={onToggle} onSubToggle={onSubToggle} onSetup={onSetup} />
                    ))}
                  </div>
                </SectionCard>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm
            ? confirm.direction === "enable"
              ? `Turn on ${confirm.title}?`
              : `Turn off ${confirm.title}?`
            : ""
        }
        body={confirmBody}
        confirmLabel={confirm?.direction === "enable" ? "Turn on" : "Turn off"}
        destructive={confirm?.direction === "disable"}
        busy={confirmBusy}
        onConfirm={() =>
          confirm &&
          doToggle(
            confirm.key,
            confirm.direction === "enable",
            confirm.direction === "disable" && (confirm.impact.dependents || []).length > 0
          )
        }
        onCancel={() => setConfirm(null)}
      />
    </PageShell>
  );
}
