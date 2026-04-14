/**
 * One-time reconciliation: for each active tenant, recompute the mode-related
 * feature flags from their tenant_modes rows and update feature_flags to match.
 *
 * Fixes data drift caused by the M2/M7 hardcoded ALL_MODE_FLAGS list, which
 * missed phase4_rentals (and let phase4_workflow_tickets leak to some tenants
 * before M2's company-profile logic shipped).
 *
 * Safe to re-run — idempotent. Only rewrites rows where current != desired.
 */

const db = require("../db-pg");
const {
  VALID_MODES,
  getFeatureFlagsForModes,
} = require("../config/mode-registry");

const ALL_MODE_FLAGS = getFeatureFlagsForModes(VALID_MODES);

async function reconcileTenant(slug) {
  await db.query(`SET search_path TO tenant_${slug}`);

  const m = await db.query(
    "SELECT mode FROM tenant_modes WHERE enabled = true"
  );
  const modes = m.rows.map((r) => r.mode);
  const shouldBeEnabled = new Set(getFeatureFlagsForModes(modes));

  const before = await db.query(
    "SELECT key, enabled FROM feature_flags WHERE key = ANY($1) ORDER BY key",
    [ALL_MODE_FLAGS]
  );

  const changes = [];
  for (const flag of ALL_MODE_FLAGS) {
    const desired = shouldBeEnabled.has(flag);
    const current = before.rows.find((r) => r.key === flag);
    if (current && current.enabled !== desired) {
      changes.push(`${flag}: ${current.enabled} -> ${desired}`);
    }
  }

  console.log(`\n=== ${slug} ===`);
  console.log(`  modes: ${modes.length ? modes.join(",") : "(none)"}`);
  console.log(
    `  flags-should-be-on: ${[...shouldBeEnabled].join(",") || "(none)"}`
  );

  if (!changes.length) {
    console.log("  no changes needed");
    return 0;
  }

  console.log(`  changes: ${changes.join("; ")}`);

  for (const flag of ALL_MODE_FLAGS) {
    const desired = shouldBeEnabled.has(flag);
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET enabled = $2`,
      [flag, desired]
    );
  }
  console.log("  applied");
  return changes.length;
}

(async () => {
  try {
    // Switch to public first to read tenant list
    await db.query("SET search_path TO public");
    const { rows: tenants } = await db.query(
      "SELECT slug FROM tenants WHERE status = 'active' ORDER BY slug"
    );
    console.log(`Found ${tenants.length} active tenants`);

    let totalChanges = 0;
    for (const t of tenants) {
      try {
        totalChanges += await reconcileTenant(t.slug);
      } catch (err) {
        console.error(`  !! ${t.slug} failed: ${err.message}`);
      }
    }
    console.log(`\nDone. Total flag changes applied: ${totalChanges}`);
    process.exit(0);
  } catch (err) {
    console.error("Reconciliation failed:", err);
    process.exit(1);
  }
})();
