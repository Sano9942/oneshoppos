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
const { getPreset, VALID_INDUSTRY_TYPES } = require("../config/industry-config");
const { getFeatureFlagsForModes } = require("../config/mode-registry");
const { getCountryPack, getCountryCodeFromName } = require("../config/country-packs");
const { seedPresetData } = require("../seeds/preset-seed-data");
const { seedRetailFlags } = require("../services/retail-flag-preset");

const ROLE_PERMISSIONS = {
  Administrator: ['all_access'],
  Manager: [
    'manage_inventory',
    'manage_orders',
    'view_reports',
    'manage_employees',
    'pos_discount',
    'void_sales',
    'pos_park',
    'pos_void',
  ],
  Cashier: ['view_reports', 'pos_discount', 'pos_park'],
};

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

  // ── GET /api/setup/status ────────────────────────────────────────────────
  router.get('/status', async (req, res) => {
    try {
      const setupDb = await getSetupDb(req);
      const { rows: [row] } = await setupDb.query(
        'SELECT setup_complete FROM company_profile WHERE id = 1',
        []
      );
      if (!row) return res.json({ setup_complete: false });
      res.json({ setup_complete: Boolean(row.setup_complete) });
    } catch (err) {
      res.status(500).json({ error: err.message });
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
      outlet_name,
      outlet_address,
      admin_name,
      admin_pin,
      cash_denominations,
      industry_type: rawIndustryType,
      country_code: rawCountryCode,
    } = req.body || {};

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
             cash_denominations = COALESCE($10, cash_denominations)
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

        // 1e. Auto-enable compliance features from country pack
        for (const flag of countryPack.compliance_features) {
          await client.query(
            `INSERT INTO feature_flags (key, enabled)
             VALUES ($1, true)
             ON CONFLICT (key) DO UPDATE SET enabled = true`,
            [flag]
          );
        }

        // 1f. Retail-only flag bundle. Only fires for general_retail today —
        // other industries skip this entirely until their own preset bundles
        // ship. See services/retail-flag-preset.js for the 19-flag list.
        if (industry_type === "general_retail") {
          await seedRetailFlags(client);
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

        // 2b. Seed sample data (categories + products) — failure is non-fatal
        try {
          await seedPresetData(client, industry_type, 1);
        } catch (seedErr) {
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
        for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
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
          await client.query(
            "UPDATE employees SET name = $1, pin_hash = $2 WHERE id = $3",
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

        // 7. Tax — user-specified or auto-seed from country pack
        const finalTaxName = tax_name || (countryPack.default_tax && countryPack.default_tax.name);
        const finalTaxRate = (tax_rate !== undefined && tax_rate !== '') ? parseFloat(tax_rate) : (countryPack.default_tax ? countryPack.default_tax.rate : NaN);
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

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
