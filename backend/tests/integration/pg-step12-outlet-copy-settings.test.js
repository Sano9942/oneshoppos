/**
 * Business Modules v2 — D8 "copy settings from" on outlet creation
 * (PLAN-V2 Step 12, Phase 1).
 *
 * v2 copies exactly ONE thing: the source outlet's outlet_business_modules
 * override rows. This file is the contract for that scope:
 *   - copy_from_outlet_id → overrides match the source row-for-row (and ONLY
 *     module overrides — no stock/employee/sales rows follow)
 *   - no copy_from_outlet_id → zero override rows, i.e. the D1 inherit-by-
 *     default path is untouched (the regression that matters most: today's
 *     create path must behave exactly as it did before Step 12)
 *   - bad source (malformed / missing / foreign-tenant / van) → 400 or 404,
 *     never a half-built outlet
 *   - atomicity: an induced failure mid-clone leaves NO orphan outlet
 *   - plan limit still guards the route
 *   - one audit row per copy, naming source + row count
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("D8 copy-settings on outlet creation (Postgres)", () => {
  let app, db, deps, cleanup;

  // Unique per run — outlets.name is UNIQUE, and this file creates several.
  const N = (label) => `Step12 ${label} ${Math.random().toString(16).slice(2, 8)}`;

  const post = (body) =>
    request(app).post("/api/outlets").set("x-employee-id", "1").send(body);

  const overridesFor = async (outletId) => {
    const { rows } = await db.query(
      "SELECT module_key, enabled FROM outlet_business_modules WHERE outlet_id = $1 ORDER BY module_key",
      [outletId]
    );
    return rows;
  };

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/outlets")(app, deps);

    // Source = seeded outlet 1, given a deliberately mixed override set: one
    // ON, one OFF. A copy that only carried the ON rows (or flattened enabled
    // to true) would pass a single-row fixture — this one catches it.
    await db.query(
      `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled, updated_by)
       VALUES (1, 'restaurant', true, 'seed'), (1, 'appointments', false, 'seed')
       ON CONFLICT (outlet_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled`
    );
  }, 60000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  describe("copy path", () => {
    it("clones the source's module overrides row-for-row and audits the copy", async () => {
      const name = N("Copied");
      const res = await post({ name, address: "12 Copy St", copy_from_outlet_id: 1 });

      expect(res.status).toBe(200);
      expect(res.body.copied_from_outlet_id).toBe(1);
      expect(res.body.copied_module_overrides).toBe(2);

      // Row-for-row identity with the source, including the FALSE override.
      expect(await overridesFor(res.body.id)).toEqual([
        { module_key: "appointments", enabled: false },
        { module_key: "restaurant", enabled: true },
      ]);

      const { rows: audit } = await db.query(
        `SELECT user_name, action_type, description FROM action_history
         WHERE action_type = 'outlet_settings_copied' AND description LIKE $1`,
        [`%to new outlet ${res.body.id}%`]
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].description).toContain("Copied 2 business-module override(s) from outlet 1");
    });

    it("copies module overrides ONLY — no stock, employee or sales rows follow", async () => {
      const res = await post({ name: N("ScopeCheck"), copy_from_outlet_id: 1 });
      expect(res.status).toBe(200);
      const id = res.body.id;

      for (const table of ["outlet_stock", "employee_outlets", "sales"]) {
        const { rows } = await db.query(
          `SELECT COUNT(*)::int AS c FROM ${table} WHERE outlet_id = $1`,
          [id]
        );
        expect({ table, count: rows[0].c }).toEqual({ table, count: 0 });
      }
    });

    it("copying from a source with no overrides yields zero rows (inherits defaults)", async () => {
      // Outlet 2 is seeded with no override rows of its own.
      const res = await post({ name: N("FromBare"), copy_from_outlet_id: 2 });
      expect(res.status).toBe(200);
      expect(res.body.copied_module_overrides).toBe(0);
      expect(await overridesFor(res.body.id)).toEqual([]);
    });
  });

  describe("inherit-by-default path (no copy_from)", () => {
    it("creates zero override rows so every module falls back to its card default", async () => {
      const res = await post({ name: N("Fresh"), address: "9 Fresh Ave" });

      expect(res.status).toBe(200);
      expect(res.body.copied_from_outlet_id).toBeNull();
      expect(res.body.copied_module_overrides).toBe(0);
      expect(await overridesFor(res.body.id)).toEqual([]);
    });

    it("empty-string copy_from (the Select's 'Start fresh' option) is not a copy", async () => {
      const res = await post({ name: N("StartFresh"), copy_from_outlet_id: "" });

      expect(res.status).toBe(200);
      expect(res.body.copied_from_outlet_id).toBeNull();
      expect(await overridesFor(res.body.id)).toEqual([]);
    });

    it("writes no audit row when nothing was copied", async () => {
      const name = N("NoAudit");
      const res = await post({ name });
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS c FROM action_history
         WHERE action_type = 'outlet_settings_copied' AND description LIKE $1`,
        [`%to new outlet ${res.body.id}%`]
      );
      expect(rows[0].c).toBe(0);
    });
  });

  describe("invalid sources — rejected, and never a half-built outlet", () => {
    const rejects = async (body, status, code) => {
      const before = await db.query("SELECT COUNT(*)::int AS c FROM outlets");
      const res = await post(body);
      expect({ status: res.status, code: res.body.code }).toEqual({ status, code });
      const after = await db.query("SELECT COUNT(*)::int AS c FROM outlets");
      expect(after.rows[0].c).toBe(before.rows[0].c);
    };

    it("rejects a non-numeric source (400)", () =>
      rejects({ name: N("BadA"), copy_from_outlet_id: "not-an-id" }, 400, "INVALID_COPY_SOURCE"));

    it("rejects a zero/negative source (400)", () =>
      rejects({ name: N("BadB"), copy_from_outlet_id: 0 }, 400, "INVALID_COPY_SOURCE"));

    it("rejects a source that does not exist — the foreign-tenant case, since search_path scopes the lookup (404)", () =>
      rejects({ name: N("BadC"), copy_from_outlet_id: 999999 }, 404, "COPY_SOURCE_NOT_FOUND"));

    it("rejects a van as source — vans carry no per-outlet module state (404)", async () => {
      const { rows } = await db.query(
        `INSERT INTO outlets (name, outlet_type) VALUES ($1, 'van') RETURNING id`,
        [N("Van")]
      );
      await rejects(
        { name: N("BadD"), copy_from_outlet_id: rows[0].id },
        404,
        "COPY_SOURCE_NOT_FOUND"
      );
    });

    it("rejects copying INTO a van (400)", async () => {
      await db.query(
        "INSERT INTO feature_flags (key, enabled) VALUES ('wholesale_van_sales', true) ON CONFLICT (key) DO UPDATE SET enabled = true"
      );
      await rejects(
        { name: N("BadE"), outlet_type: "van", copy_from_outlet_id: 1 },
        400,
        "COPY_SOURCE_NOT_SUPPORTED_FOR_VAN"
      );
      await db.query("UPDATE feature_flags SET enabled = false WHERE key = 'wholesale_van_sales'");
    });
  });

  describe("atomicity", () => {
    it("an induced failure mid-clone leaves no orphan outlet", async () => {
      // Fail the clone itself — after the outlet INSERT has already run inside
      // the transaction. Only a real rollback can hide the outlet afterwards.
      await db.query(`
        CREATE OR REPLACE FUNCTION step12_boom() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'induced clone failure'; END;
        $$ LANGUAGE plpgsql`);
      await db.query(`
        CREATE TRIGGER step12_boom_trg BEFORE INSERT ON outlet_business_modules
        FOR EACH ROW EXECUTE FUNCTION step12_boom()`);

      const name = N("Orphan");
      try {
        const res = await post({ name, copy_from_outlet_id: 1 });
        expect(res.status).toBe(500);
      } finally {
        await db.query("DROP TRIGGER IF EXISTS step12_boom_trg ON outlet_business_modules");
        await db.query("DROP FUNCTION IF EXISTS step12_boom()");
      }

      const { rows } = await db.query("SELECT id FROM outlets WHERE name = $1", [name]);
      expect(rows).toEqual([]);
    });
  });

  describe("plan limit", () => {
    it("still guards POST /api/outlets — the cap is checked before any copy runs", async () => {
      // The shared harness stubs requirePlanLimit to a no-op, so wire a real
      // blocking one onto a second app to prove the guard is still on the route.
      const capped = await createTestApp();
      try {
        require("../../routes/outlets")(capped.app, {
          ...capped.deps,
          requirePlanLimit: (resource) => (req, res, next) =>
            resource === "outlets"
              ? res.status(403).json({ code: "PLAN_LIMIT_REACHED" })
              : next(),
        });

        const res = await request(capped.app)
          .post("/api/outlets")
          .set("x-employee-id", "1")
          .send({ name: N("Capped"), copy_from_outlet_id: 1 });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("PLAN_LIMIT_REACHED");
      } finally {
        await capped.cleanup();
      }
    }, 60000);
  });
});
