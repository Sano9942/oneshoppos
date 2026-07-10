/**
 * backend/routes/admin/index.js — Super-admin API orchestrator.
 *
 * All endpoints live under /api/admin/* and are gated by requireSuperAdmin middleware.
 * Uses master-db-pg (public schema) directly, not the tenant DB proxy.
 *
 * Split into domain modules:
 *   auth.js        — login
 *   tenants.js     — tenant CRUD, stats, flags, notes, migrations, PIN reset
 *   monitoring.js  — global stats, attention, cleanup, infra, revenue
 *   billing.js     — plan pricing, payments, upgrade requests
 *   operations.js  — support tickets, impersonation, dead letters
 *   compliance.js  — tax rates, suggestions, FBR health
 *   messaging.js   — email queue, broadcast, activity/security logs, announcements
 *   system.js      — worker status, orphaned schemas, backup
 *   module-locks.js — Business Modules platform locks (self-enable backstop)
 */
const { bcrypt, BCRYPT_ROUNDS, createRequireAllowedIp, createRequireSuperAdmin, createLoggers } = require("./helpers");

const registerAuthRoutes = require("./auth");
const registerTenantRoutes = require("./tenants");
const registerMonitoringRoutes = require("./monitoring");
const registerBillingRoutes = require("./billing");
const registerOperationsRoutes = require("./operations");
const registerComplianceRoutes = require("./compliance");
const registerMessagingRoutes = require("./messaging");
const registerSystemRoutes = require("./system");
const registerModuleLockRoutes = require("./module-locks");

module.exports = function registerAdminRoutes(app, { authLimiter }) {
  const db = require("../../db-pg");
  const masterDb = require("../../master-db-pg");
  const jwt = require("jsonwebtoken");
  const { verifyAccessToken, defaults: jwtDefaults } = require("../../jwt-auth");
  const { provision } = require("../../tenant-provisioner-pg");
  const { PLAN_DEFAULTS } = require("../../middleware/plan-limits");
  const tenantDbManager = require("../../tenant-db-manager-pg");
  tenantDbManager.init(db);

  // Create shared middleware and helpers
  const requireAllowedIp = createRequireAllowedIp();
  const requireSuperAdmin = createRequireSuperAdmin(verifyAccessToken);
  const { auditLog, logAdminAction, logSecurityEvent } = createLoggers(db, masterDb);

  // Shared deps object passed to all domain modules
  const deps = {
    db, masterDb, jwt, jwtDefaults, tenantDbManager,
    requireAllowedIp, requireSuperAdmin, authLimiter,
    bcrypt, BCRYPT_ROUNDS,
    provision, PLAN_DEFAULTS,
    auditLog, logAdminAction, logSecurityEvent,
  };

  // Register domain routes (order matters for Express route matching)
  registerAuthRoutes(app, deps);
  registerTenantRoutes(app, deps);
  registerMonitoringRoutes(app, deps);
  registerBillingRoutes(app, deps);
  registerOperationsRoutes(app, deps);
  registerComplianceRoutes(app, deps);
  registerMessagingRoutes(app, deps);
  registerSystemRoutes(app, deps);
  registerModuleLockRoutes(app, deps);
};
