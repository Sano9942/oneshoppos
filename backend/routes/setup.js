'use strict';
/**
 * setup.js — First-run setup wizard routes
 *
 * GET  /api/setup/status   — Returns { setup_complete: bool }. No auth required.
 * POST /api/setup/complete — Token-gated. Bootstraps the entire store in one
 *                            transaction (company, outlet, roles, employee, receipt
 *                            template, optional tax). Marks setup_complete = 1.
 *
 * These routes MUST be mounted BEFORE the auth middleware in registerAllRoutes.js.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { getPreset, VALID_INDUSTRY_TYPES, getExtraFlagsForPreset } = require("../config/industry-config");
const { getFeatureFlagsForModes } = require("../config/mode-registry");
const { getCountryPack, getCountryCodeFromName } = require("../config/country-packs");
const { seedPresetData } = require("../seeds/preset-seed-data");
const {
  seedRetailFlags,
  seedRestaurantFlags,
  seedWholesaleFlags,
  seedSalonFlags,
  seedRetailSubtypeFlags,
  RETAIL_BUNDLE_INDUSTRIES,
} = require("../services/retail-flag-preset");
const { signAccessToken, signRefreshToken } = require("../jwt-auth");
// Single source of truth for role -> permissions mapping. Previously hardcoded
// here with a stale 8-perm Manager list, which left non-admin restaurant
// employees locked out of every Phase 4 vertical route (manage_restaurant,
// manage_kds, manage_tips, override_void_comp, override_price, manage_gift_cards,
// manage_bookings, manage_projects, manage_contracts, manage_tickets,
// manage_rentals, manage_rooms, manage_treatment_plans).
const { DEFAULT_ROLE_PERMISSIONS } = require("../middleware/permissions");

module.exports = function createSetupRouter(db, { IS_MULTI_TENANT, tenantDbManager } = {}) {
  const router = express.Router();

  async function getSetupDb(req) {
    if (!IS_MULTI_TENANT) return db;
    const slug = req.query.tenant || req.body?.tenant;
    if (!slug) throw new Error("tenant slug required in MT mode");
    const masterDb = require("../master-db-pg");
    const tenant = await masterDb.getTenantBySlug(slug);
    if (!tenant) throw new Error(`Tenant "${slug}" not found`);
    return tenantDbManager.getDb(tenant.id);
  }

  // Resolve tenant for token issuance after setup completes. Mirrors the
  // lookup in getSetupDb but returns the master tenant row (id, slug, name)
  // since signAccessToken needs `tid`. Called outside the setup transaction.
  async function getSetupTenant(req) {
    if (!IS_MULTI_TENANT) return null;
    const slug = req.query.tenant || req.body?.tenant;
    if (!slug) return null;
    const masterDb = require("../master-db-pg");
    return await masterDb.getTenantBySlug(slug);
  }

  // ── GET /api/setup/status ────────────────────────────────────────────────
  // Returns setup state plus the store/admin info captured at signup so the
  // wizard can pre-fill fields (Store Name on step 2, Full Name on step 5).
  router.get('/status', async (req, res) => {
    try {
      const setupDb = await getSetupDb(req);
      const { rows: [row] } = await setupDb.query(
        'SELECT setup_complete FROM company_profile WHERE id = 1',
        []
      );
      const setup_complete = Boolean(row?.setup_complete);

      // Tenant + admin pre-fill (best effort — never fail status on this).
      let store_name = null, admin_name = null, admin_email = null;
      try {
        const tenant = await getSetupTenant(req);
        if (tenant) store_name = tenant.name || null;
        const { rows: emp } = await setupDb.query(
          "SELECT name, email FROM employees WHERE role_id = 1 ORDER BY id ASC LIMIT 1",
          []
        );
        if (emp[0]) {
          admin_name = emp[0].name || null;
          admin_email = emp[0].email || null;
        }
      } catch { /* ignore — pre-fill is non-critical */ }

      res.json({ setup_complete, store_name, admin_name, admin_email });
    } catch (err) {
      console.error("[setup/status] failed:", err);
      res.status(500).json({ error: "Could not load setup status." });
    }
  });

  // ── POST /api/setup/complete ─────────────────────────────────────────────
  router.post('/complete', async (req, res) => {
    const {
      token,
      company_name,
      country,
      city,
      phone,
      email,
      timezone,
      currency_symbol,
      currency_code,
      fiscal_year_start,
      tax_name,
      tax_rate,
      // P8 (3.14): tax stance from the wizard.
      is_gst_registered,
      tax_mode,
      ntn,
      strn,
      outlet_name,
      outlet_address,
      admin_name,
      admin_pin,
      cash_denominations,
      industry_type: rawIndustryType,
      country_code: rawCountryCode,
    } = req.body || {};

    // Validate tax_mode if provided. Accept legacy callers that omit it.
    const validTaxModes = ["none", "inclusive", "exclusive"];
    const safeTaxMode = is_gst_registered === false
      ? "none"
      : (tax_mode && validTaxModes.includes(tax_mode) ? tax_mode : "none");

    const industry_type = rawIndustryType || "general_retail";
    // Resolve country code: accept explicit code or derive from country name
    const country_code = rawCountryCode || getCountryCodeFromName(country);
    const countryPack = getCountryPack(country_code);

    // Basic validation
    if (!token) return res.status(400).json({ error: 'token is required' });
    if (!VALID_INDUSTRY_TYPES.includes(industry_type)) {
      return res.status(400).json({ error: `Invalid industry_type: ${industry_type}. Valid: ${VALID_INDUSTRY_TYPES.join(", ")}` });
    }
    if (!company_name) return res.status(400).json({ error: 'company_name is required' });
    if (!admin_name) return res.status(400).json({ error: 'admin_name is required' });
    if (!admin_pin) return res.status(400).json({ error: 'admin_pin is required' });
    if (String(admin_pin).length < 4 || String(admin_pin).length > 6) {
      return res.status(400).json({ error: 'admin_pin must be 4–6 digits' });
    }

    try {
      // PR 8: block setup completion until the owner has verified their email.
      // Only enforced in MT mode (single-tenant has no owner email per tenant).
      if (IS_MULTI_TENANT) {
        const masterDb = require("../master-db-pg");
        const slug = req.query.tenant || req.body?.tenant;
        if (slug) {
          try {
            const { rows: [t] } = await masterDb.query(
              "SELECT email_verified_at FROM tenants WHERE slug = $1",
              [String(slug).trim()]
            );
            if (t && t.email_verified_at == null) {
              return res.status(403).json({
                error: "Please verify your email before completing setup.",
                code: "EMAIL_NOT_VERIFIED",
              });
            }
          } catch {
            // Column may not exist on a stale schema — fall through.
            // The migration runs before any setup-complete in production.
          }
        }
      }

      const setupDb = await getSetupDb(req);
      // Verify token
      const { rows: [profile] } = await setupDb.query(
        'SELECT setup_complete, setup_token, setup_token_expires_at FROM company_profile WHERE id = 1',
        []
      );
      if (!profile) return res.status(503).json({ error: 'Setup not initialised' });
      if (profile.setup_complete) {
        return res.status(403).json({ error: 'Setup already complete' });
      }
      if (!profile.setup_token || profile.setup_token !== token) {
        return res.status(403).json({ error: 'Invalid setup token' });
      }
      if (profile.setup_token_expires_at && new Date(profile.setup_token_expires_at) < new Date()) {
        return res.status(403).json({ error: 'Setup link has expired. Please contact support or request a new setup link.' });
      }

      // Captured outside the transaction so we can sign an auto-login JWT
      // for the new admin after the transaction commits successfully.
      let createdEmployeeId = null;

      // All good — run everything in a single transaction
      await setupDb.transaction(async (client) => {
        // 1. Update company profile
        await client.query(
          `UPDATE company_profile SET
             company_name     = $1,
             country          = $2,
             city             = $3,
             phone            = $4,
             email            = $5,
             timezone         = $6,
             currency_symbol  = $7,
             currency_code    = $8,
             fiscal_year_start = $9,
             cash_denominations = COALESCE($10, cash_denominations),
             tax_mode         = $11,
             ntn              = COALESCE($12, ntn),
             strn             = COALESCE($13, strn)
           WHERE id = 1`,
          [
            company_name,
            country || null,
            city || null,
            phone || null,
            email || null,
            timezone || 'UTC',
            currency_symbol || '$',
            currency_code || 'USD',
            fiscal_year_start || '01-01',
            cash_denominations || null,
            // P8 (3.14): persist tax stance. Wizard always sends a value;
            // legacy callers default to 'none' via safeTaxMode above.
            safeTaxMode,
            ntn || null,
            strn || null,
          ]
        );

        // 1b. Set industry preset fields
        const preset = getPreset(industry_type);
        await client.query(
          `UPDATE company_profile SET
             industry_type = $1,
             business_model = $2,
             country_code = $3,
             industry_preset_version = 1
           WHERE id = 1`,
          [preset.industry_type, preset.business_model, country_code]
        );

        // 1c. Seed tenant_modes for this preset
        for (const mode of preset.modes) {
          await client.query(
            `INSERT INTO tenant_modes (mode, enabled, enabled_at)
             VALUES ($1, true, NOW())
             ON CONFLICT (mode) DO NOTHING`,
            [mode]
          );
        }

        // 1d. Enable feature flags corresponding to the preset's modes
        const flagsToEnable = getFeatureFlagsForModes(preset.modes);
        for (const flagKey of flagsToEnable) {
          await client.query(
            `INSERT INTO feature_flags (key, enabled)
             VALUES ($1, true)
             ON CONFLICT (key) DO UPDATE SET enabled = true`,
            [flagKey]
          );
        }

        // 1d-bis. Preset extra flags (PRESET_EXTRA_FLAGS) — sub-features modes
        // can't derive (gym member_checkin, rental_inspections, lodging
        // channel sync, clinical recalls/forms…). Previously only the
        // preset-SWITCH path (tier4/company-profile.js) seeded these, so fresh
        // signups never got them — V05 wires the wizard too (approved fix).
        for (const flagKey of getExtraFlagsForPreset(preset.industry_type)) {
          await client.query(
            `INSERT INTO feature_flags (key, enabled)
             VALUES ($1, true)
             ON CONFLICT (key) DO UPDATE SET enabled = true`,
            [flagKey]
          );
        }

        // 1d-ter. V05 — seed a clinical intake form for clinical presets,
        // auto-attached on a patient's FIRST appointment (F03 trigger wired
        // in services/booking-services.js). Idempotent by template name.
        const CLINICAL_INTAKE_PRESETS = ["clinic", "dental_clinic", "veterinary", "physiotherapy"];
        if (CLINICAL_INTAKE_PRESETS.includes(industry_type)) {
          const intakeFields = JSON.stringify([
            { key: "reason", label: "Reason for visit", type: "text", required: true },
            { key: "allergies", label: "Known allergies", type: "textarea", required: false },
            { key: "medications", label: "Current medications", type: "textarea", required: false },
            { key: "medical_history", label: "Relevant medical history", type: "textarea", required: false },
            { key: "emergency_contact", label: "Emergency contact (name & phone)", type: "text", required: false },
          ]);
          await client.query(
            `INSERT INTO form_templates (name, entity_scope, fields, require_signature, auto_attach, is_active)
             SELECT 'Patient Intake', 'customer', $1::jsonb, false, 'first_appointment', true
             WHERE NOT EXISTS (SELECT 1 FROM form_templates WHERE name = 'Patient Intake')`,
            [intakeFields]
          );
        }

        // 1d-quater. V08 — seed photography questionnaires (Event Timeline +
        // Shot List), auto-attached on project creation (F03 trigger wired in
        // services/projects.js:createProject). Idempotent by template name.
        // Existing photography tenants are backfilled by migration v122.
        if (industry_type === "photography_studio") {
          const timelineFields = JSON.stringify([
            { key: "event_date", label: "Event date", type: "date", required: true },
            { key: "venue", label: "Venue / location", type: "text", required: true },
            { key: "getting_ready_time", label: "Getting-ready start time", type: "text", required: false },
            { key: "ceremony_time", label: "Ceremony time", type: "text", required: false },
            { key: "key_moments", label: "Must-capture moments", type: "textarea", required: false },
            { key: "family_photo_groups", label: "Family photo groupings", type: "textarea", required: false },
          ]);
          const shotlistFields = JSON.stringify([
            { key: "style", label: "Preferred style", type: "select", options: ["Candid", "Posed", "Mix"], required: false },
            { key: "must_have_shots", label: "Must-have shots", type: "textarea", required: true },
            { key: "do_not_photograph", label: "People / things NOT to photograph", type: "textarea", required: false },
            { key: "inspiration_links", label: "Inspiration / mood-board links", type: "textarea", required: false },
          ]);
          await client.query(
            `INSERT INTO form_templates (name, entity_scope, fields, require_signature, auto_attach, is_active)
             SELECT 'Event Timeline', 'project', $1::jsonb, false, 'project_created', true
             WHERE NOT EXISTS (SELECT 1 FROM form_templates WHERE name = 'Event Timeline')`,
            [timelineFields]
          );
          await client.query(
            `INSERT INTO form_templates (name, entity_scope, fields, require_signature, auto_attach, is_active)
             SELECT 'Shot List', 'project', $1::jsonb, false, 'project_created', true
             WHERE NOT EXISTS (SELECT 1 FROM form_templates WHERE name = 'Shot List')`,
            [shotlistFields]
          );
        }

        // 1e. Auto-enable compliance features from country pack
        for (const flag of countryPack.compliance_features) {
          await client.query(
            `INSERT INTO feature_flags (key, enabled)
             VALUES ($1, true)
             ON CONFLICT (key) DO UPDATE SET enabled = true`,
            [flag]
          );
        }

        // 1f. Per-industry flag bundles. See services/retail-flag-preset.js
        // for the per-industry flag lists. Other industries (salon, clinic,
        // rentals, etc.) skip this entirely until their own bundles ship.
        // The buy/sell retail family shares the retail bundle — same feature
        // surface (barcode, price lists, loyalty, gift cards, holds, COD, SMS).
        // V01: butcher/sweet_shop/textile joined general_retail/grocery/wholesale
        // (RETAIL_BUNDLE_INDUSTRIES) instead of skipping the seeder, and each
        // retail sub-type additionally gets the vertical engines it consumes
        // (batch/expiry, kit/BOM) via seedRetailSubtypeFlags — latent until the
        // owner opts a product in.
        if (RETAIL_BUNDLE_INDUSTRIES.includes(industry_type)) {
          await seedRetailFlags(client);
          await seedRetailSubtypeFlags(client, industry_type);
        } else if (industry_type === "restaurant" || industry_type === "cafe") {
          await seedRestaurantFlags(client);
        } else if (industry_type === "salon") {
          // V04 — salon customer-engagement bundle (loyalty + gift cards + SMS
          // campaign/provider surfaces). Packages + waitlist come from the
          // PRESET_EXTRA_FLAGS block above.
          await seedSalonFlags(client);
        }

        // 1g. Wholesale-only flags on top of the retail bundle. All four
        // surfaces (credit controls, field sales, schemes, secondary sales)
        // are inert until the tenant configures them, so safe to ship ON
        // by default. See WHOLESALE_SEED_FLAGS comments in retail-flag-preset.js.
        if (industry_type === "wholesale") {
          await seedWholesaleFlags(client);
        }

        // 2. Create/update outlet
        const { rows: [existingOutlet] } = await client.query(
          'SELECT id FROM outlets WHERE id = 1',
          []
        );
        const finalOutletName = outlet_name || 'Main Store';
        if (existingOutlet) {
          await client.query(
            'UPDATE outlets SET name = $1, address = $2 WHERE id = 1',
            [finalOutletName, outlet_address || '']
          );
        } else {
          await client.query(
            'INSERT INTO outlets (id, name, address, company_id, is_active) VALUES (1, $1, $2, 1, true)',
            [finalOutletName, outlet_address || '']
          );
        }

        // 2a. Seed a default KDS station for restaurant/cafe tenants. Without
        // this, sendToKitchen() resolves targetStation=null for every item
        // and silently produces zero tickets — the kitchen never sees the
        // order even though the cashier's UI shows "Sent to kitchen". W15.
        // Idempotent: only inserts when no station already exists for outlet 1.
        if (industry_type === "restaurant" || industry_type === "cafe") {
          await client.query(
            `INSERT INTO kds_stations (outlet_id, name, station_role, balance_strategy, is_active)
             SELECT 1, 'Main Kitchen', 'prep', 'priority', true
             WHERE NOT EXISTS (SELECT 1 FROM kds_stations WHERE outlet_id = 1)`
          );
        }

        // 2b. Seed sample data (categories + products) — failure is non-fatal.
        // Wrapped in a SAVEPOINT so a seed failure can't poison the parent
        // transaction (Postgres aborts the whole tx on any unhandled error).
        await client.query("SAVEPOINT seed_data");
        try {
          await seedPresetData(client, industry_type, 1);
          await client.query("RELEASE SAVEPOINT seed_data");
        } catch (seedErr) {
          await client.query("ROLLBACK TO SAVEPOINT seed_data");
          console.error("[setup] Sample data seeding failed (non-fatal):", seedErr.message);
        }

        // 3. Ensure default roles (id=1 Administrator, id=2 Manager, id=3 Cashier)
        const roleDefs = [
          [1, 'Administrator', 'Full access to all features'],
          [2, 'Manager', 'Access to most features except admin settings'],
          [3, 'Cashier', 'Access to POS and basic features'],
        ];
        for (const [id, name, description] of roleDefs) {
          await client.query(
            'INSERT INTO roles (id, name, description) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
            [id, name, description]
          );
        }

        // 4. Seed role permissions
        for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
          const { rows: [role] } = await client.query(
            'SELECT id FROM roles WHERE name = $1',
            [roleName]
          );
          if (!role) continue;
          for (const perm of perms) {
            await client.query(
              'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT (role_id, permission) DO NOTHING',
              [role.id, perm]
            );
          }
        }

        // 5. Create or update first admin employee
        // The provisioner may have already created an employee — update if exists
        const { rows: [existingEmp] } = await client.query(
          "SELECT id FROM employees WHERE role_id = 1 LIMIT 1"
        );
        let empId;
        const pinHash = await bcrypt.hash(String(admin_pin), 10);
        if (existingEmp) {
          // Set role text alongside name + pin so legacy UI surfaces don't
          // display the owner as 'Cashier' (the default value of the legacy
          // role column on employees, retained for back-compat with code that
          // hasn't migrated to role_id).
          await client.query(
            "UPDATE employees SET name = $1, pin_hash = $2, role = 'Administrator' WHERE id = $3",
            [admin_name, pinHash, existingEmp.id]
          );
          empId = existingEmp.id;
        } else {
          const { rows: [newEmp] } = await client.query(
            `INSERT INTO employees
               (name, pin_hash, role, role_id, salary_type, work_hours_per_day)
             VALUES ($1, $2, 'Administrator', 1, 'monthly', 8)
             RETURNING id`,
            [admin_name, pinHash]
          );
          empId = newEmp.id;
        }
        if (empId) {
          await client.query(
            'INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES ($1, 1, true) ON CONFLICT (employee_id, outlet_id) DO NOTHING',
            [empId]
          );
        }
        createdEmployeeId = empId;

        // 6. Default receipt template
        const { rows: [existingTemplate] } = await client.query(
          'SELECT id FROM receipt_templates WHERE id = 1',
          []
        );
        if (!existingTemplate) {
          await client.query(
            `INSERT INTO receipt_templates
               (id, name, header_text, footer_text, show_barcode, show_logo, is_active)
             VALUES (1, 'Default', 'Thank you for shopping!', 'Please come again.', false, false, true)`,
            []
          );
        }

        // 7. Tax — only insert if the merchant explicitly typed a name+rate
        // in Step 3. The 0% "Default Tax" seeded by the provisioner is
        // already marked is_default=true, so this row stays non-default.
        // We deliberately do NOT auto-seed the country-pack tax (e.g. GST
        // 17% for PK) — merchants opt in by typing it themselves or adding
        // it later via Settings → Taxes.
        const finalTaxName = (tax_name && String(tax_name).trim()) || null;
        const finalTaxRate = (tax_rate !== undefined && tax_rate !== '') ? parseFloat(tax_rate) : NaN;
        if (finalTaxName && !isNaN(finalTaxRate)) {
          await client.query(
            'INSERT INTO taxes (name, rate, is_default) VALUES ($1, $2, false)',
            [finalTaxName, finalTaxRate]
          );
        }

        // 8. Mark setup complete, clear token
        await client.query(
          'UPDATE company_profile SET setup_complete = true, setup_token = NULL WHERE id = 1',
          []
        );
      });

      // Bust the company-profile cache so the immediate post-setup request
      // (auto-login dashboard fetch) doesn't see the stale setup_complete=false
      // entry that was warmed by the wizard's mount-time /api/setup/status.
      try {
        const { invalidateCompanyProfileCache } = require("../middleware/tenant-auth");
        const tenantForCache = IS_MULTI_TENANT ? await getSetupTenant(req) : null;
        invalidateCompanyProfileCache(tenantForCache?.id ?? "_default");
      } catch { /* non-fatal */ }

      // ── Auto-login (PR 6) ──────────────────────────────────────────────
      // After successful setup, hand the merchant a fresh access + refresh
      // token so the frontend can land directly on /dashboard instead of
      // bouncing through /login. Mirrors the response shape of mt-login so
      // AuthProvider's writeSession() can consume it unchanged. Best-effort
      // — if any of this fails we still return success:true so the wizard
      // can fall back to the legacy /login redirect.
      let auth = null;
      try {
        const tenant = await getSetupTenant(req);
        const JWT_SECRET = process.env.JWT_SECRET;
        const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
        if (tenant && createdEmployeeId && JWT_SECRET && JWT_REFRESH_SECRET) {
          const accessToken = signAccessToken(
            { tid: tenant.id, eid: createdEmployeeId, rid: 1, oid: null },
            JWT_SECRET
          );
          const { token: refreshToken, hash: tokenHash, expiresAt } = signRefreshToken(
            { tid: tenant.id, eid: createdEmployeeId },
            JWT_REFRESH_SECRET
          );
          const masterDb = require("../master-db-pg");
          await masterDb.query(
            "INSERT INTO tenant_refresh_tokens (tenant_id, employee_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
            [tenant.id, createdEmployeeId, tokenHash, expiresAt]
          );
          res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
            path: "/api/auth",
            maxAge: 7 * 24 * 60 * 60 * 1000,
          });
          auth = {
            token: accessToken,
            employee: {
              id: createdEmployeeId,
              name: admin_name,
              role_id: 1,
            },
            permissions: DEFAULT_ROLE_PERMISSIONS.Administrator,
            tenant: { slug: tenant.slug, name: tenant.name },
          };
        }
      } catch (authErr) {
        // Non-fatal — wizard falls back to legacy /login redirect
        console.error("[setup] Auto-login token issuance failed (non-fatal):", authErr.message);
      }

      res.json({ success: true, ...(auth || {}) });
    } catch (err) {
      // Log full error for debugging but never leak raw DB messages to UI.
      console.error("[setup/complete] failed:", err);
      res.status(500).json({
        error: "Setup failed. Please try again or contact support if this persists.",
      });
    }
  });

  return router;
};
