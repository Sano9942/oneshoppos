/**
 * services/packages.js — F02 packages / session passes.
 *
 * A package is a prepaid entitlement of N credits sold once and redeemed over
 * time. `customer_packages.credits_used` is a running total kept in lockstep
 * with the `package_redemptions` ledger; the invariant
 *
 *     credits_used = Σ package_redemptions.credits WHERE reversed_at IS NULL
 *
 * is maintained here under `SELECT ... FOR UPDATE OF customer_packages` — the
 * exact locking shape copied from routes/gift-cards.js:331-370 so two parallel
 * redeems on the last credit can never both win.
 *
 * All mutating helpers take a transaction `client` (never the pool proxy) so
 * the redemption row and the credits_used bump commit or roll back together
 * with whatever business write triggered them (a POS sale, a booking, etc.).
 */

/**
 * Sell / grant a package to a customer. Inserts the customer_packages ledger
 * head from the template. Requires a customer — anonymous packages are refused
 * by callers before reaching here.
 *
 * @param {object} client - transaction client
 * @param {object} opts - { customerId, templateId, saleId? }
 * @returns {Promise<object>} the inserted customer_packages row
 */
async function sellPackage(client, { customerId, templateId, saleId = null }) {
  if (!customerId) {
    throw Object.assign(new Error("A customer is required to sell a package"), { statusCode: 400 });
  }
  const { rows: [tpl] } = await client.query(
    `SELECT id, credits, validity_days, is_active
       FROM package_templates WHERE id = $1`,
    [templateId],
  );
  if (!tpl) {
    throw Object.assign(new Error("Package template not found"), { statusCode: 404 });
  }
  if (tpl.is_active === false) {
    throw Object.assign(new Error("Package template is inactive"), { statusCode: 400 });
  }
  // validity_days=NULL → never expires. Anchored at sale time, not first use.
  const expiresAt =
    tpl.validity_days != null
      ? new Date(Date.now() + Number(tpl.validity_days) * 86400000)
      : null;
  const { rows: [pkg] } = await client.query(
    `INSERT INTO customer_packages
       (customer_id, package_template_id, sale_id, credits_total, credits_used, expires_at, status)
     VALUES ($1, $2, $3, $4, 0, $5, 'active')
     RETURNING *`,
    [customerId, templateId, saleId, tpl.credits, expiresAt],
  );
  return pkg;
}

/**
 * Redeem credits from a package. Transactional and lock-guarded.
 *
 * Locks the customer_packages row FOR UPDATE, validates status / expiry /
 * scope / remaining balance, writes the redemption ledger row, bumps
 * credits_used, and flips status to 'exhausted' when the last credit is used.
 * On expiry it flips status to 'expired' and rejects.
 *
 * @param {object} client - transaction client (REQUIRED — must be in a tx)
 * @param {object} opts
 * @param {number} opts.customerPackageId
 * @param {number} [opts.credits=1]
 * @param {number} [opts.saleId]
 * @param {number} [opts.appointmentId]
 * @param {number} [opts.classSessionBookingId]
 * @param {number} [opts.bookingServiceId] - resolved service, for scope='listed' checks
 * @returns {Promise<{redemption, remaining, status}>}
 */
async function redeemPackage(client, {
  customerPackageId,
  customerId = null,
  credits = 1,
  saleId = null,
  appointmentId = null,
  classSessionBookingId = null,
  bookingServiceId = null,
}) {
  const use = Math.max(1, Math.floor(Number(credits) || 1));

  // FOR UPDATE OF cp — lock only the ledger head, not the joined template.
  const { rows: [pkg] } = await client.query(
    `SELECT cp.id, cp.customer_id, cp.credits_total, cp.credits_used, cp.status,
            cp.expires_at, cp.package_template_id,
            pt.service_scope
       FROM customer_packages cp
       JOIN package_templates pt ON pt.id = cp.package_template_id
      WHERE cp.id = $1
      FOR UPDATE OF cp`,
    [customerPackageId],
  );
  if (!pkg) {
    throw Object.assign(new Error("Package not found"), { statusCode: 404 });
  }
  // Ownership guard — a POS cart must not redeem another customer's package.
  if (customerId != null && Number(pkg.customer_id) !== Number(customerId)) {
    throw Object.assign(new Error("Package belongs to a different customer"), { statusCode: 400 });
  }
  if (pkg.status === "refunded") {
    throw Object.assign(new Error("Package has been refunded"), { statusCode: 400 });
  }
  // Expiry rejects the redeem. We deliberately DON'T flip status here — this
  // whole transaction rolls back on the throw below, so the flip wouldn't
  // persist anyway. The durable 'active'→'expired' transition is owned by
  // expireStalePackages() on the read/balances path (single writer).
  if (pkg.expires_at && new Date(pkg.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error("Package has expired"), { statusCode: 400 });
  }
  if (pkg.status !== "active") {
    throw Object.assign(new Error(`Package is ${pkg.status}`), { statusCode: 400 });
  }
  const remaining = Number(pkg.credits_total) - Number(pkg.credits_used);
  if (use > remaining) {
    throw Object.assign(
      new Error(`Not enough credits (remaining ${remaining})`),
      { statusCode: 400 },
    );
  }
  // scope='listed' — the redeemed service must be one of the covered services.
  if (pkg.service_scope === "listed") {
    if (!bookingServiceId) {
      throw Object.assign(
        new Error("This package only covers specific services — service not identified"),
        { statusCode: 400 },
      );
    }
    const { rows: [ok] } = await client.query(
      `SELECT 1 FROM package_template_services
         WHERE package_template_id = $1 AND booking_service_id = $2`,
      [pkg.package_template_id, bookingServiceId],
    );
    if (!ok) {
      throw Object.assign(
        new Error("This service is not covered by the package"),
        { statusCode: 400 },
      );
    }
  }

  const { rows: [redemption] } = await client.query(
    `INSERT INTO package_redemptions
       (customer_package_id, credits, appointment_id, class_session_booking_id, sale_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [pkg.id, use, appointmentId, classSessionBookingId, saleId],
  );
  const newUsed = Number(pkg.credits_used) + use;
  const newStatus = newUsed >= Number(pkg.credits_total) ? "exhausted" : "active";
  await client.query(
    "UPDATE customer_packages SET credits_used = $1, status = $2 WHERE id = $3",
    [newUsed, newStatus, pkg.id],
  );
  return {
    redemption,
    remaining: Number(pkg.credits_total) - newUsed,
    status: newStatus,
    customer_package_id: pkg.id,
  };
}

/**
 * Reverse a single redemption (cancellation gives the credit back). Idempotent
 * on an already-reversed redemption (returns { reversed: false }). Re-opens an
 * exhausted package back to 'active'; leaves 'expired'/'refunded' untouched.
 *
 * @param {object} client - transaction client
 * @param {object} opts - one of { redemptionId } or { appointmentId } / { classSessionBookingId }
 * @returns {Promise<{reversed, customer_package_id?, remaining?}>}
 */
async function reverseRedemption(client, { redemptionId = null, appointmentId = null, classSessionBookingId = null }) {
  let target = redemptionId;
  if (!target && (appointmentId || classSessionBookingId)) {
    const conds = [];
    const params = [];
    if (appointmentId) { params.push(appointmentId); conds.push(`appointment_id = $${params.length}`); }
    if (classSessionBookingId) { params.push(classSessionBookingId); conds.push(`class_session_booking_id = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT id FROM package_redemptions
         WHERE reversed_at IS NULL AND (${conds.join(" OR ")})
         ORDER BY id DESC LIMIT 1`,
      params,
    );
    if (!rows.length) return { reversed: false, reason: "no_active_redemption" };
    target = rows[0].id;
  }
  if (!target) return { reversed: false, reason: "no_target" };

  // Lock the redemption, then the package head, then adjust.
  const { rows: [red] } = await client.query(
    "SELECT id, customer_package_id, credits, reversed_at FROM package_redemptions WHERE id = $1 FOR UPDATE",
    [target],
  );
  if (!red) return { reversed: false, reason: "not_found" };
  if (red.reversed_at) return { reversed: false, reason: "already_reversed", customer_package_id: red.customer_package_id };

  const { rows: [pkg] } = await client.query(
    "SELECT id, credits_total, credits_used, status FROM customer_packages WHERE id = $1 FOR UPDATE",
    [red.customer_package_id],
  );
  await client.query(
    "UPDATE package_redemptions SET reversed_at = NOW() WHERE id = $1",
    [red.id],
  );
  const newUsed = Math.max(0, Number(pkg.credits_used) - Number(red.credits));
  // Re-open an exhausted package; never resurrect expired/refunded/active-as-is.
  const newStatus = pkg.status === "exhausted" ? "active" : pkg.status;
  await client.query(
    "UPDATE customer_packages SET credits_used = $1, status = $2 WHERE id = $3",
    [newUsed, newStatus, pkg.id],
  );
  return {
    reversed: true,
    customer_package_id: pkg.id,
    remaining: Number(pkg.credits_total) - newUsed,
    status: newStatus,
  };
}

/**
 * Flip any of a customer's active-but-expired packages to 'expired'. Cheap
 * catch-up run called from the balances endpoint so a stale 'active' row never
 * shows a redeemable balance the redeem path would reject.
 */
async function expireStalePackages(db, customerId) {
  await db.query(
    `UPDATE customer_packages
        SET status = 'expired'
      WHERE customer_id = $1
        AND status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()`,
    [customerId],
  );
}

/**
 * Resolve the booking_service_id a POS product line maps to (v100 added
 * booking_services.product_id). Returns null when the product isn't a service.
 */
async function resolveBookingServiceForProduct(client, productId) {
  if (!productId) return null;
  const { rows } = await client.query(
    "SELECT id FROM booking_services WHERE product_id = $1 LIMIT 1",
    [productId],
  );
  return rows.length ? rows[0].id : null;
}

module.exports = {
  sellPackage,
  redeemPackage,
  reverseRedemption,
  expireStalePackages,
  resolveBookingServiceForProduct,
};
