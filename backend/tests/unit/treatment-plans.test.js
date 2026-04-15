import { describe, it, expect } from "vitest";
import {
  INDUSTRY_PRESETS,
  getPreset,
  getPortalEnabledTabs,
  getPortalLabels,
  getClinicalConfig,
} from "../../config/industry-config.js";
import { MODE_REGISTRY, getFeatureFlagsForModes } from "../../config/mode-registry.js";

const svc = require("../../services/treatment-plan-service.js");

const CLINICAL_PRESETS = ["dental_clinic", "veterinary", "physiotherapy"];

// ── Preset coverage ────────────────────────────────────────────────

describe("M10 clinical presets", () => {
  it.each(CLINICAL_PRESETS)("%s preset exists", (key) => {
    expect(INDUSTRY_PRESETS).toHaveProperty(key);
  });

  it.each(CLINICAL_PRESETS)("%s enables both treatment_plans and appointments modes", (key) => {
    const p = getPreset(key);
    expect(p.modes).toContain("treatment_plans");
    expect(p.modes).toContain("appointments");
  });

  it.each(CLINICAL_PRESETS)("%s has clinical_treatment business model + list POS layout", (key) => {
    const p = getPreset(key);
    expect(p.business_model).toBe("clinical_treatment");
    expect(p.pos_layout_mode).toBe("list");
  });

  it.each(CLINICAL_PRESETS)("%s has Clinical report group", (key) => {
    const p = getPreset(key);
    expect(p.visible_report_groups).toContain("Clinical");
  });

  it.each(CLINICAL_PRESETS)("%s surfaces active_treatment_plans + overdue_sessions widgets", (key) => {
    const p = getPreset(key);
    expect(p.dashboard_widgets.active_treatment_plans).toBe(true);
    expect(p.dashboard_widgets.overdue_sessions).toBe(true);
    expect(p.dashboard_widgets.appointments_today).toBe(true);
  });

  it.each(CLINICAL_PRESETS)("%s exposes clinical_config with chart_preset + subject_type_default", (key) => {
    const cfg = getClinicalConfig(key);
    expect(cfg).toBeTruthy();
    expect(typeof cfg.chart_preset).toBe("string");
    expect(cfg.chart_preset.length).toBeGreaterThan(0);
    expect(typeof cfg.subject_type_default).toBe("string");
    expect(Array.isArray(cfg.consent_templates)).toBe(true);
    expect(cfg.consent_templates.length).toBeGreaterThan(0);
  });

  it("dental_clinic uses dental chart preset and self subject", () => {
    const cfg = getClinicalConfig("dental_clinic");
    expect(cfg.chart_preset).toBe("dental");
    expect(cfg.subject_type_default).toBe("self");
  });

  it("veterinary uses vet_body chart preset and pet subject", () => {
    const cfg = getClinicalConfig("veterinary");
    expect(cfg.chart_preset).toBe("vet_body");
    expect(cfg.subject_type_default).toBe("pet");
  });

  it("physiotherapy uses body chart preset", () => {
    const cfg = getClinicalConfig("physiotherapy");
    expect(cfg.chart_preset).toBe("body");
  });

  it("dental_clinic labels: product=Procedure, customer=Patient", () => {
    const p = getPreset("dental_clinic");
    expect(p.labels.product).toBe("Procedure");
    expect(p.labels.customer).toBe("Patient");
  });

  it("veterinary labels: customer=Owner (not Patient — pet is subject)", () => {
    const p = getPreset("veterinary");
    expect(p.labels.customer).toBe("Owner");
  });

  it("physiotherapy labels: product=Service, sale=Session", () => {
    const p = getPreset("physiotherapy");
    expect(p.labels.product).toBe("Service");
    expect(p.labels.sale).toBe("Session");
  });

  it("non-clinical presets return null from getClinicalConfig", () => {
    expect(getClinicalConfig("general_retail")).toBeNull();
    expect(getClinicalConfig("restaurant")).toBeNull();
    expect(getClinicalConfig("hotel")).toBeNull();
  });
});

// ── Portal tab coverage ────────────────────────────────────────────

describe("M10 portal tabs", () => {
  it.each(CLINICAL_PRESETS)("%s portal tabs include 'treatments'", (key) => {
    const tabs = getPortalEnabledTabs(key);
    expect(tabs).toContain("treatments");
  });

  it("dental_clinic portal tabs include loyalty; vet and physio do not", () => {
    expect(getPortalEnabledTabs("dental_clinic")).toContain("loyalty");
    expect(getPortalEnabledTabs("veterinary")).not.toContain("loyalty");
    expect(getPortalEnabledTabs("physiotherapy")).not.toContain("loyalty");
  });

  it.each(CLINICAL_PRESETS)("%s portal label overrides include treatments_tab", (key) => {
    const labels = getPortalLabels(key);
    expect(labels.treatments_tab).toBeTruthy();
    expect(typeof labels.treatments_tab).toBe("string");
  });

  it("dental_clinic treatments_tab label = 'My Treatment Plans'", () => {
    expect(getPortalLabels("dental_clinic").treatments_tab).toBe("My Treatment Plans");
  });

  it("veterinary treatments_tab label = 'Pet Treatment Plans'", () => {
    expect(getPortalLabels("veterinary").treatments_tab).toBe("Pet Treatment Plans");
  });
});

// ── Mode registry ──────────────────────────────────────────────────

describe("treatment_plans mode registry", () => {
  it("has treatment_plans mode registered", () => {
    expect(MODE_REGISTRY).toHaveProperty("treatment_plans");
  });

  it("treatment_plans mode enables phase4_treatment_plans flag", () => {
    const cfg = MODE_REGISTRY.treatment_plans;
    expect(cfg.feature_flags_to_enable).toContain("phase4_treatment_plans");
  });

  it("getFeatureFlagsForModes(['treatment_plans']) returns phase4_treatment_plans", () => {
    const flags = getFeatureFlagsForModes(["treatment_plans"]);
    expect(flags).toContain("phase4_treatment_plans");
  });

  it("getFeatureFlagsForModes for a clinical preset enables both the treatment and appointment flags", () => {
    const flags = getFeatureFlagsForModes(getPreset("dental_clinic").modes);
    expect(flags).toContain("phase4_treatment_plans");
    expect(flags).toContain("phase4_appointments");
  });
});

// ── Service pure functions ─────────────────────────────────────────

describe("validateStatusTransition", () => {
  it("allows draft → active", () => {
    expect(svc.validateStatusTransition("draft", "active").ok).toBe(true);
  });

  it("allows active → on_hold → active", () => {
    expect(svc.validateStatusTransition("active", "on_hold").ok).toBe(true);
    expect(svc.validateStatusTransition("on_hold", "active").ok).toBe(true);
  });

  it("allows completed → invoiced", () => {
    expect(svc.validateStatusTransition("completed", "invoiced").ok).toBe(true);
  });

  it("rejects invoiced → active (terminal)", () => {
    const r = svc.validateStatusTransition("invoiced", "active");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Cannot transition/);
  });

  it("rejects discontinued → anything (terminal)", () => {
    expect(svc.validateStatusTransition("discontinued", "active").ok).toBe(false);
    expect(svc.validateStatusTransition("discontinued", "completed").ok).toBe(false);
  });

  it("rejects unknown from-status", () => {
    const r = svc.validateStatusTransition("bogus", "active");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown/);
  });

  it("rejects invalid transition (draft → completed)", () => {
    expect(svc.validateStatusTransition("draft", "completed").ok).toBe(false);
  });
});

describe("calculateSessionCompletionPct", () => {
  it("returns 0 for an empty plan", () => {
    expect(svc.calculateSessionCompletionPct({ total_sessions_planned: 0 }, [])).toBe(0);
  });

  it("returns 50 for 2/4 completed", () => {
    const sessions = [
      { status: "completed" }, { status: "completed" },
      { status: "scheduled" }, { status: "scheduled" },
    ];
    expect(svc.calculateSessionCompletionPct({ total_sessions_planned: 4 }, sessions)).toBe(50);
  });

  it("returns 100 when all done", () => {
    const sessions = [{ status: "completed" }, { status: "completed" }];
    expect(svc.calculateSessionCompletionPct({ total_sessions_planned: 2 }, sessions)).toBe(100);
  });

  it("caps at 100 if more completed than planned (denormalization drift)", () => {
    const sessions = [
      { status: "completed" }, { status: "completed" }, { status: "completed" },
    ];
    expect(svc.calculateSessionCompletionPct({ total_sessions_planned: 2 }, sessions)).toBe(100);
  });

  it("falls back to plan.sessions_completed if sessions array absent", () => {
    expect(svc.calculateSessionCompletionPct({ total_sessions_planned: 4, sessions_completed: 1 }, null)).toBe(25);
  });
});

describe("consent template catalog", () => {
  it("lists the canonical template keys", () => {
    const keys = svc.listConsentTemplateKeys();
    expect(keys).toContain("general_treatment");
    expect(keys).toContain("anaesthesia");
    expect(keys).toContain("surgery");
    expect(keys).toContain("euthanasia");
    expect(keys).toContain("manual_therapy");
  });

  it("getConsentTemplate returns title + body for each key", () => {
    for (const key of svc.listConsentTemplateKeys()) {
      const t = svc.getConsentTemplate(key);
      expect(t).toBeTruthy();
      expect(typeof t.title).toBe("string");
      expect(t.body.length).toBeGreaterThan(20);
    }
  });

  it("returns null for unknown template key", () => {
    expect(svc.getConsentTemplate("not_a_template")).toBeNull();
  });
});
