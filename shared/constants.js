// @ts-check

/**
 * All permission strings used in requirePerm() (backend) and hasPerm() (frontend).
 * @type {Readonly<{
 *   ALL_ACCESS: 'all_access',
 *   MANAGE_INVENTORY: 'manage_inventory',
 *   MANAGE_ORDERS: 'manage_orders',
 *   VIEW_REPORTS: 'view_reports',
 *   MANAGE_EMPLOYEES: 'manage_employees',
 *   MANAGE_CUSTOMERS: 'manage_customers',
 *   POS_DISCOUNT: 'pos_discount',
 *   VOID_SALES: 'void_sales',
 *   POS_PARK: 'pos_park',
 *   POS_VOID: 'pos_void',
 * }>}
 */
const PERMISSIONS = Object.freeze({
  ALL_ACCESS: 'all_access',
  MANAGE_INVENTORY: 'manage_inventory',
  MANAGE_ORDERS: 'manage_orders',
  VIEW_REPORTS: 'view_reports',
  MANAGE_EMPLOYEES: 'manage_employees',
  MANAGE_CUSTOMERS: 'manage_customers',
  POS_DISCOUNT: 'pos_discount',
  VOID_SALES: 'void_sales',
  POS_PARK: 'pos_park',
  POS_VOID: 'pos_void',
});

/**
 * Tenant subscription lifecycle states.
 * @type {Readonly<{
 *   TRIAL: 'trial',
 *   ACTIVE: 'active',
 *   GRACE: 'grace',
 *   EXPIRED: 'expired',
 * }>}
 */
const BILLING_STATUS = Object.freeze({
  TRIAL: 'trial',
  ACTIVE: 'active',
  GRACE: 'grace',
  EXPIRED: 'expired',
});

/**
 * Cross-cutting feature flag keys (used on both backend and frontend).
 * The full flag set (including ui_redesign_* flags) lives in
 * backend/middleware/feature-flags.js — do not duplicate them here.
 * @type {Readonly<{
 *   FBR_INTEGRATION: 'fbr_integration',
 *   AI_INSIGHTS: 'ai_insights',
 *   ACCOUNTING_CORE: 'accounting_core',
 *   BACKUP_RESTORE: 'backup_restore',
 *   SUPPLIER_PAYABLES: 'supplier_payables',
 * }>}
 */
const FEATURE_FLAGS = Object.freeze({
  FBR_INTEGRATION: 'fbr_integration',
  AI_INSIGHTS: 'ai_insights',
  ACCOUNTING_CORE: 'accounting_core',
  BACKUP_RESTORE: 'backup_restore',
  SUPPLIER_PAYABLES: 'supplier_payables',
});

module.exports = { PERMISSIONS, BILLING_STATUS, FEATURE_FLAGS };
