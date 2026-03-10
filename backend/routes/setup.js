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

module.exports = function createSetupRouter(db) {
  const router = express.Router();
  // ── GET /api/setup/status ────────────────────────────────────────────────
  router.get('/status', (req, res) => {
    db.get('SELECT setup_complete FROM company_profile WHERE id = 1', [], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.json({ setup_complete: false });
      res.json({ setup_complete: Boolean(row.setup_complete) });
    });
  });

  // ── POST /api/setup/complete ─────────────────────────────────────────────
  router.post('/complete', (req, res) => {
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
    } = req.body || {};

    // Basic validation
    if (!token) return res.status(400).json({ error: 'token is required' });
    if (!company_name) return res.status(400).json({ error: 'company_name is required' });
    if (!admin_name) return res.status(400).json({ error: 'admin_name is required' });
    if (!admin_pin) return res.status(400).json({ error: 'admin_pin is required' });
    if (String(admin_pin).length < 4 || String(admin_pin).length > 6) {
      return res.status(400).json({ error: 'admin_pin must be 4–6 digits' });
    }

    // Verify token
    db.get(
      'SELECT setup_complete, setup_token FROM company_profile WHERE id = 1',
      [],
      (err, profile) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!profile) return res.status(503).json({ error: 'Setup not initialised' });
        if (profile.setup_complete) {
          return res.status(403).json({ error: 'Setup already complete' });
        }
        if (!profile.setup_token || profile.setup_token !== token) {
          return res.status(403).json({ error: 'Invalid or expired setup token' });
        }

        // All good — run everything in a single transaction
        db.serialize(() => {
          db.run('BEGIN IMMEDIATE', (beginErr) => {
            if (beginErr) return res.status(500).json({ error: beginErr.message });

            let failed = false;
            function rollbackAndFail(msg) {
              if (failed) return;
              failed = true;
              db.run('ROLLBACK', () => res.status(500).json({ error: msg }));
            }

            function run(sql, params) {
              return new Promise((resolve, reject) => {
                db.run(sql, params, function (e) {
                  if (e) reject(e);
                  else resolve(this.lastID);
                });
              });
            }

            function get(sql, params) {
              return new Promise((resolve, reject) => {
                db.get(sql, params, (e, row) => {
                  if (e) reject(e);
                  else resolve(row);
                });
              });
            }

            async function doSetup() {
              // 1. Update company profile
              await run(
                `UPDATE company_profile SET
                   company_name     = ?,
                   country          = ?,
                   city             = ?,
                   phone            = ?,
                   email            = ?,
                   timezone         = ?,
                   currency_symbol  = ?,
                   currency_code    = ?,
                   fiscal_year_start = ?
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
                ],
              );

              // 2. Create/update outlet
              const existingOutlet = await get('SELECT id FROM outlets WHERE id = 1', []);
              const finalOutletName = outlet_name || 'Main Store';
              if (existingOutlet) {
                await run(
                  'UPDATE outlets SET name = ?, address = ? WHERE id = 1',
                  [finalOutletName, outlet_address || ''],
                );
              } else {
                await run(
                  'INSERT INTO outlets (id, name, address, company_id, is_active) VALUES (1, ?, ?, 1, 1)',
                  [finalOutletName, outlet_address || ''],
                );
              }

              // 3. Ensure default roles (id=1 Administrator, id=2 Manager, id=3 Cashier)
              const roleDefs = [
                [1, 'Administrator', 'Full access to all features'],
                [2, 'Manager', 'Access to most features except admin settings'],
                [3, 'Cashier', 'Access to POS and basic features'],
              ];
              for (const [id, name, description] of roleDefs) {
                await run(
                  'INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?)',
                  [id, name, description],
                );
              }

              // 4. Seed role permissions
              for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
                const role = await get('SELECT id FROM roles WHERE name = ?', [roleName]);
                if (!role) continue;
                for (const perm of perms) {
                  await run(
                    'INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)',
                    [role.id, perm],
                  );
                }
              }

              // 5. Create first admin employee
              await run(
                `INSERT INTO employees
                   (name, pin_code, role, role_id, salary_type, work_hours_per_day)
                 VALUES (?, ?, 'Administrator', 1, 'monthly', 8)`,
                [admin_name, String(admin_pin)],
              );
              const emp = await get(
                'SELECT id FROM employees WHERE pin_code = ? ORDER BY id DESC LIMIT 1',
                [String(admin_pin)],
              );
              if (emp) {
                await run(
                  'INSERT OR IGNORE INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (?, 1, 1)',
                  [emp.id],
                );
              }

              // 6. Default receipt template
              const existingTemplate = await get('SELECT id FROM receipt_templates WHERE id = 1', []);
              if (!existingTemplate) {
                await run(
                  `INSERT INTO receipt_templates
                     (id, name, header_text, footer_text, show_barcode, show_logo, is_active)
                   VALUES (1, 'Default', 'Thank you for shopping!', 'Please come again.', 0, 0, 1)`,
                  [],
                );
              }

              // 7. Optional tax
              if (tax_name && tax_rate !== undefined && tax_rate !== '') {
                const rate = parseFloat(tax_rate);
                if (!isNaN(rate)) {
                  await run(
                    'INSERT INTO taxes (name, rate, is_default) VALUES (?, ?, 0)',
                    [tax_name, rate],
                  );
                }
              }

              // 8. Mark setup complete, clear token
              await run(
                'UPDATE company_profile SET setup_complete = 1, setup_token = NULL WHERE id = 1',
                [],
              );
            }

            doSetup()
              .then(() => {
                db.run('COMMIT', (commitErr) => {
                  if (commitErr) return rollbackAndFail(commitErr.message);
                  res.json({ success: true });
                });
              })
              .catch((e) => rollbackAndFail(e.message));
          });
        });
      },
    );
  });

  return router;
};
