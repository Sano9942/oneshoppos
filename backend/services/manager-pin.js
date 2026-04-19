// Phase 2-R Wave B — 2-R.2 manager PIN verification.
//
// Verifies that the PIN supplied by a cashier belongs to an employee with
// sufficient permissions to override a void or comp. Reuses the bcrypt
// algorithm from `routes/employees.js` with a plaintext `pin_code` fallback
// for employees that haven't yet been migrated to hashed PINs.
//
// Hard refusal: when the current request is an impersonated super-admin
// session (req.isImpersonating === true), we refuse verification outright.
// A super-admin impersonating a tenant must not be able to self-approve
// irreversible floor actions.

const bcrypt = require("bcryptjs");

async function verifyManagerPin(
  db,
  pin,
  { requiredPerm = "override_void_comp", isImpersonating = false } = {}
) {
  if (isImpersonating === true) {
    const err = new Error("Manager override cannot be used in impersonation mode");
    err.statusCode = 403;
    throw err;
  }
  if (!pin || typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) {
    const err = new Error("Invalid PIN format");
    err.statusCode = 400;
    throw err;
  }

  // Load every employee's pin material in one pass; we can't SELECT on a
  // hashed column, and tenants typically have fewer than a few hundred
  // employees. Mirror the shape used by /api/employees/validate-pin.
  const { rows } = await db.query(
    `SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code, r.name AS role_name
     FROM employees e
     LEFT JOIN roles r ON r.id = e.role_id
     WHERE e.deleted_at IS NULL`
  );

  let matched = null;
  for (const emp of rows) {
    if (emp.pin_hash) {
      const ok = await bcrypt.compare(pin, emp.pin_hash);
      if (ok) { matched = emp; break; }
    } else if (emp.pin_code && String(emp.pin_code) === pin) {
      matched = emp;
      break;
    }
  }

  if (!matched) {
    const err = new Error("Invalid PIN");
    err.statusCode = 401;
    throw err;
  }

  // Resolve permissions for the matched role; treat `all_access` as superuser.
  const { rows: permRows } = await db.query(
    `SELECT permission FROM role_permissions WHERE role_id = $1`,
    [matched.role_id]
  );
  const perms = permRows.map((r) => r.permission);
  const ok = perms.includes("all_access") || perms.includes(requiredPerm);
  if (!ok) {
    const err = new Error("Employee lacks override permission");
    err.statusCode = 403;
    throw err;
  }

  return {
    employee_id: matched.id,
    employee_name: matched.name,
    role_name: matched.role_name || null,
  };
}

module.exports = { verifyManagerPin };
