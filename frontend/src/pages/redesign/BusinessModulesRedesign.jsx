import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../contexts/ToastContext";
import { usePreset } from "../../contexts/PresetContext";
import { useAuth } from "../../auth/AuthProvider";
import { refreshFeatureFlags } from "../../hooks/useFeatureFlags";
import { PageShell, SectionCard, Badge, Button, Toggle, Tooltip, Drawer, ConfirmDialog, EmptyState } from "../../ui/primitives";
import { Lock, Sparkles, ChevronDown, ChevronRight, MapPin, CheckCircle2, Circle } from "lucide-react";
import { api } from "../../api";
import {
  showOutletControls,
  locationSummaryLabel,
  isOutletOverridden,
  showChecklist,
  checklistProgress,
} from "./businessModules";

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

// The per-outlet location matrix (PLAN-V2 Step 10). Rendered once at the page
// level, driven by the module whose "Manage locations" button was clicked.
// Presentational — every write goes back up to the page via the handlers so
// the v1 confirm flows are reused, never forked.
function OutletLocationsDrawer({
  module: m,
  open,
  onClose,
  canWrite,
  busy,
  onOutletToggle,
  onOutletReset,
  onSetDefault,
}) {
  if (!m) return null;
  const outlets = m.outlets || [];
  // default_outlet_enabled defaults TRUE when the card has no tenant row yet.
  const defaultOn = m.default_outlet_enabled !== false;

  return (
    <Drawer open={open} onClose={onClose} title={`${m.title} — locations`} size="md">
      <p className="text-sm text-(--ui-muted) mb-4">
        Turn {m.title} on or off for each location. A location left on “Inherited”
        follows the default below.
      </p>

      {/* New-locations default (amendment e) — sets the card's default for
          unlisted / future outlets and every location still inheriting. */}
      <div className="flex items-start justify-between gap-3 border border-(--ui-border) rounded-lg p-3 mb-4">
        <div className="min-w-0">
          <span className="text-sm font-medium text-(--ui-text)">New locations</span>
          <p className="text-xs text-(--ui-muted)">
            When you add a location, {m.title} starts{" "}
            <span className="font-medium">{defaultOn ? "On" : "Off"}</span> there.
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          {canWrite ? (
            <Toggle
              checked={defaultOn}
              disabled={busy === "default"}
              onChange={() => onSetDefault(m, !defaultOn)}
              aria-label="New locations start on"
            />
          ) : (
            <Tooltip label="You don't have permission to change this">
              <Toggle checked={defaultOn} disabled aria-label="New locations start on" />
            </Tooltip>
          )}
        </div>
      </div>

      <h4 className="text-xs font-semibold text-(--ui-muted) uppercase tracking-wide mb-2">
        Locations
      </h4>
      <div className="space-y-3">
        {outlets.map((o) => {
          const overridden = isOutletOverridden(o);
          return (
            <div key={o.outlet_id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm text-(--ui-text) truncate block">{o.name}</span>
                <div className="flex items-center gap-2 mt-1">
                  <Badge tone={overridden ? "warning" : "default"}>
                    {overridden ? "Override" : "Inherited"}
                  </Badge>
                  {overridden && canWrite && (
                    <Button
                      tone="link"
                      size="sm"
                      onClick={() => onOutletReset(m, o)}
                      disabled={busy === o.outlet_id}
                    >
                      Reset to default
                    </Button>
                  )}
                </div>
              </div>
              <div className="shrink-0 pt-0.5">
                {canWrite ? (
                  <Toggle
                    checked={o.effective}
                    disabled={busy === o.outlet_id}
                    onChange={() => onOutletToggle(m, o)}
                    aria-label={`Toggle ${m.title} at ${o.name}`}
                  />
                ) : (
                  <Tooltip label="You don't have permission to change this">
                    <Toggle checked={o.effective} disabled aria-label={`Toggle ${m.title} at ${o.name}`} />
                  </Tooltip>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}

function ModuleCard({ module: m, titleByKey, busyKey, canCompany, highlightKey, onToggle, onSubToggle, onSetup, onManageLocations, onStepNavigate }) {
  const requires = (m.depends_on || []).map((k) => titleByKey[k] || k);
  // A covered vertical that's enabled-but-unconfigured reads attention_required
  // yet is still functionally on, so treat it as "on" for the sub-toggle gates.
  const isOn = m.state === "on" || m.state === "attention_required";
  const busy = busyKey === m.key;
  // Sub-toggles are usable only once the parent module is on AND the viewer can
  // manage company-level state (a manage_outlet_modules-only delegate can drive
  // the location matrix but not company flags).
  const subsEnabled = isOn && !busy && canCompany;
  // Sub-toggles are only usable once the parent module is on. When it's off we
  // still render them (so the merchant sees what's inside) but disabled with a
  // tooltip. Bucket C sub-toggles are read-only badges, so they never gate here.
  const parentOff = m.bucket !== "C" && !isOn;
  const subs = m.sub_toggles || [];
  const useExpander = subs.length > 3;
  const [showCustomize, setShowCustomize] = useState(false);
  const showLocations = showOutletControls(m);

  // Setup checklist (D6) — the "Get started — N of M done" expander.
  const showSteps = showChecklist(m);
  const { done: stepsDone, total: stepsTotal } = checklistProgress(m);
  const [stepsOpen, setStepsOpen] = useState(false);
  // After a first enable, the parent flags this card's key so we auto-expand +
  // scroll it into view (highlight, not a modal).
  const highlight = highlightKey === m.key;
  const cardRef = useRef(null);
  useEffect(() => {
    if (highlight && showSteps) {
      setStepsOpen(true);
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight, showSteps]);

  return (
    <div
      ref={cardRef}
      className={`border rounded-lg p-4 flex flex-col gap-2 transition-shadow ${
        highlight ? "border-(--ui-primary) ring-2 ring-(--ui-primary)" : "border-(--ui-border)"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-(--ui-text)">{m.title}</span>
        <div className="flex items-center gap-2 shrink-0">
          {m.preset_recommended && (
            <Badge tone="default"><Sparkles size={10} /> Recommended</Badge>
          )}
          <StateBadge module={m} />
          {m.bucket === "C" ? (
            <Button
              size="sm"
              tone={m.connected ? "default" : "primary"}
              disabled={m.state === "locked" || !canCompany}
              onClick={() => onSetup(m)}
            >
              {m.connected ? "Manage" : "Set up"}
            </Button>
          ) : canCompany ? (
            <Toggle
              checked={isOn}
              disabled={m.state === "locked" || busy}
              onChange={() => onToggle(m)}
              aria-label={`Toggle ${m.title}`}
            />
          ) : (
            <Tooltip label="You can manage locations only">
              <Toggle checked={isOn} disabled aria-label={`Toggle ${m.title}`} />
            </Tooltip>
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

      {/* Setup checklist (D6) — enabled covered verticals still missing a
          required step. Expands to deep-linked "get started" items. */}
      {showSteps && (
        <div className="mt-1 border-t border-(--ui-border) pt-2">
          <Button
            tone="link"
            size="sm"
            onClick={() => setStepsOpen((v) => !v)}
            aria-expanded={stepsOpen}
          >
            {stepsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Get started — {stepsDone} of {stepsTotal} done
          </Button>
          {stepsOpen && (
            <ul className="mt-2 space-y-2">
              {(m.checklist || []).map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-2">
                  <span className="inline-flex items-start gap-2 min-w-0">
                    {item.done ? (
                      <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-(--ui-success-fg)" />
                    ) : (
                      <Circle size={16} className="shrink-0 mt-0.5 text-(--ui-muted)" />
                    )}
                    <span className="min-w-0">
                      <span className={`text-sm ${item.done ? "text-(--ui-muted) line-through" : "text-(--ui-text)"}`}>
                        {item.label}
                      </span>
                      {!item.required && <span className="text-xs text-(--ui-muted)"> · optional</span>}
                      {item.scope === "outlet" && <span className="text-xs text-(--ui-muted)"> · all locations</span>}
                    </span>
                  </span>
                  {!item.done && (
                    <Button tone="link" size="sm" onClick={() => onStepNavigate(item.route)}>
                      Set up →
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Per-outlet summary + entry to the location matrix (multi-outlet
          tenants only; backend omits outlets[] otherwise). */}
      {showLocations && (
        <div className="mt-1 border-t border-(--ui-border) pt-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-(--ui-muted)">
            <MapPin size={12} />
            {locationSummaryLabel(m)}
          </span>
          <Button tone="link" size="sm" onClick={() => onManageLocations(m)}>
            Manage locations
          </Button>
        </div>
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
                } else if (!canCompany) {
                  control = (
                    <Tooltip label="You can manage locations only">
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
  const { hasPerm } = useAuth();
  // Company-level controls (module on/off, sub-toggles, Bucket C setup) need
  // manage_business_modules (all_access bypasses). A manage_outlet_modules-only
  // delegate reaches the page (route relaxed) but drives only the location
  // matrix + defaults.
  const canCompany = hasPerm("manage_business_modules");
  const canOutlet = hasPerm(["manage_business_modules", "manage_outlet_modules"]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  // { key, title, direction: "enable"|"disable", impact, rolesBeyondAdmin,
  //   scope?: "outlet", outletId?, outletName? }
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Which card's location Drawer is open (null = closed). We look the module up
  // from `data` by key so the Drawer always renders the freshest per-outlet
  // state after an in-place patch.
  const [locationsKey, setLocationsKey] = useState(null);
  // outlet_id | "default" — the per-row write currently in flight in the Drawer.
  const [outletBusy, setOutletBusy] = useState(null);
  // Card key to auto-expand + scroll after a first enable that left setup
  // pending (D6 "route attention to the checklist"). Cleared on a short timer.
  const [highlightKey, setHighlightKey] = useState(null);

  const reload = useCallback(async () => {
    const next = await api.get("/api/business-modules");
    setData(next);
    return next;
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
  const locationsModule = locationsKey ? modules.find((m) => m.key === locationsKey) : null;

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
      const next = await reload();
      // First-enable success routes attention to the setup checklist: if the
      // just-enabled card still has an incomplete required step, flag it so its
      // card auto-expands + scrolls into view (no new modal).
      if (enabled) {
        const card = next?.modules?.find((mod) => mod.key === key);
        if (card && showChecklist(card)) {
          setHighlightKey(key);
          setTimeout(() => setHighlightKey((k) => (k === key ? null : k)), 2600);
        }
      }
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
    // attention_required is still an ON state (enabled, setup pending), so
    // clicking the toggle on it means DISABLE, not enable.
    const enabling = !(m.state === "on" || m.state === "attention_required");
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

  // ── Per-outlet write path (PLAN-V2 Step 10) ──────────────────────────────
  // Patch just this card's outlet fields from the toggle echo so the summary
  // + Drawer update in place (no full-page reload, no flicker).
  const patchCardOutlets = useCallback((key, echo) => {
    setData((d) => {
      if (!d) return d;
      return {
        ...d,
        modules: d.modules.map((m) =>
          m.key === key
            ? {
                ...m,
                outlets: echo.outlets,
                outlet_count: echo.outlet_count,
                enabled_outlet_count: echo.enabled_outlet_count,
                default_outlet_enabled: echo.default_outlet_enabled,
              }
            : m
        ),
      };
    });
  }, []);

  const writeOutlet = useCallback(
    async (key, body) => {
      const echo = await api.post(`/api/business-modules/${key}/outlet-toggle`, body);
      patchCardOutlets(key, echo);
      // If the toggled outlet is the current session's active outlet, its own
      // nav/mode gates just changed — refresh both client caches in place.
      refreshFeatureFlags();
      refreshPreset();
      return echo;
    },
    [patchCardOutlets, refreshPreset]
  );

  const openLocations = (m) => setLocationsKey(m.key);
  const closeLocations = () => setLocationsKey(null);

  const handleOutletToggle = async (m, outlet) => {
    const next = !outlet.effective;
    setOutletBusy(outlet.outlet_id);
    try {
      if (!next) {
        // Disabling at one outlet — show the outlet-scoped impact confirm when
        // there's data to lose (reuses the v1 ConfirmDialog).
        const impact = await api.get(`/api/business-modules/${m.key}/impact`, { outlet_id: outlet.outlet_id });
        const hasData = (impact.counts || []).some((c) => c.count !== null && c.count > 0);
        if (hasData) {
          setConfirm({
            key: m.key,
            title: m.title,
            direction: "disable",
            scope: "outlet",
            outletId: outlet.outlet_id,
            outletName: outlet.name,
            impact,
          });
          return;
        }
        await writeOutlet(m.key, { outlet_id: outlet.outlet_id, enabled: false });
        toast.success(`${m.title} turned off at ${outlet.name}`);
      } else {
        // Enabling never has side effects — write directly.
        await writeOutlet(m.key, { outlet_id: outlet.outlet_id, enabled: true });
        toast.success(`${m.title} turned on at ${outlet.name}`);
      }
    } catch (err) {
      toast.error(err.message || "Could not update location");
    } finally {
      setOutletBusy((b) => (b === outlet.outlet_id ? null : b));
    }
  };

  const handleOutletReset = async (m, outlet) => {
    setOutletBusy(outlet.outlet_id);
    try {
      await writeOutlet(m.key, { outlet_id: outlet.outlet_id, enabled: null });
      toast.success(`${outlet.name} reset to default for ${m.title}`);
    } catch (err) {
      toast.error(err.message || "Could not reset location");
    } finally {
      setOutletBusy((b) => (b === outlet.outlet_id ? null : b));
    }
  };

  const handleSetDefault = async (m, nextEnabled) => {
    setOutletBusy("default");
    try {
      await writeOutlet(m.key, { default_outlet_enabled: nextEnabled });
      toast.success(`New locations will start ${nextEnabled ? "on" : "off"} for ${m.title}`);
    } catch (err) {
      toast.error(err.message || "Could not update default");
    } finally {
      setOutletBusy((b) => (b === "default" ? null : b));
    }
  };

  const doOutletDisable = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await writeOutlet(confirm.key, { outlet_id: confirm.outletId, enabled: false });
      toast.success(`${confirm.title} turned off at ${confirm.outletName}`);
      setConfirm(null);
    } catch (err) {
      toast.error(err.message || "Could not update location");
    } finally {
      setConfirmBusy(false);
    }
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
      ) : confirm.scope === "outlet" ? (
        <>
          {(confirm.impact.counts || [])
            .filter((c) => c.count !== null && c.count > 0)
            .map((c) => (
              <span key={c.key} className="block mb-1 text-(--ui-text)">
                {c.label}: <span className="font-medium">{c.count}</span>
                {c.tenant_wide ? " (across all locations)" : ""}
              </span>
            ))}
          <span className="block">
            This only turns {confirm.title} off at {confirm.outletName} — your data is kept and
            comes back if you turn it on there again.
          </span>
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

  const confirmTitle = confirm
    ? confirm.direction === "enable"
      ? `Turn on ${confirm.title}?`
      : confirm.scope === "outlet"
        ? `Turn off ${confirm.title} at ${confirm.outletName}?`
        : `Turn off ${confirm.title}?`
    : "";

  const onConfirm = () => {
    if (!confirm) return;
    if (confirm.scope === "outlet") {
      doOutletDisable();
      return;
    }
    doToggle(
      confirm.key,
      confirm.direction === "enable",
      confirm.direction === "disable" && (confirm.impact.dependents || []).length > 0
    );
  };

  const cardProps = {
    titleByKey,
    busyKey,
    canCompany,
    highlightKey,
    onToggle,
    onSubToggle,
    onSetup,
    onManageLocations: openLocations,
    onStepNavigate: (route) => navigate(route),
  };

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
                    <ModuleCard key={m.key} module={m} {...cardProps} />
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
                      <ModuleCard key={m.key} module={m} {...cardProps} />
                    ))}
                  </div>
                </SectionCard>
              </div>
            );
          })}
        </div>
      )}

      {/* Location matrix Drawer — rendered before the ConfirmDialog so the
          outlet-scoped disable confirm stacks on top of it. */}
      <OutletLocationsDrawer
        module={locationsModule}
        open={!!locationsModule}
        onClose={closeLocations}
        canWrite={canOutlet}
        busy={outletBusy}
        onOutletToggle={handleOutletToggle}
        onOutletReset={handleOutletReset}
        onSetDefault={handleSetDefault}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirmTitle}
        body={confirmBody}
        confirmLabel={confirm?.direction === "enable" ? "Turn on" : "Turn off"}
        destructive={confirm?.direction === "disable"}
        busy={confirmBusy}
        onConfirm={onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </PageShell>
  );
}
