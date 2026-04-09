# Phase 2B Depth and Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Phase 2B features (smart collections, outlet product visibility, outlet tax profiles, commission tracking, custom report builder, smart POS grid, item suggestions, scheduled catalog changes) on the `omnichannel-phase1` branch with one commit per workstream.

**Architecture:** Three independent workstreams, each containing schema + backend routes + frontend UI. A shared migration (v20) ships first as the foundation, then workstreams build on it independently. Workstream 1 covers catalog depth (smart collections, outlet visibility, outlet tax, scheduled changes). Workstream 2 covers commissions. Workstream 3 covers the report builder, POS grid, and item suggestions.

**Tech Stack:** Node.js/Express v5 backend, PostgreSQL (via `pg` pool), React 19 + Vite 7 + Tailwind CSS v4 frontend. Zod validation. Feature-flagged rollout.

**Branch:** `omnichannel-phase1` (continuing existing work)

**Prerequisites:** Phase 2A stable (migration v19 applied, all Phase 2A routes functional).

**Existing services to integrate with (do not rebuild):**
- `backend/services/quote.js` — already has `resolvePriceForContext()` (422 lines) with cascading outlet → channel → customer → base price resolution. POS and storefront already consume this.
- `backend/routes/price-list-assignments.js` — already has `GET /api/price-resolve` endpoint. Scheduled catalog changes activate by mutating underlying data; the existing resolution chain picks it up.
- `backend/routes/tier4/hr.js` — already has `POST /api/hr/payroll/periods/:id/generate` with commission calculation. Commissions workstream must wire `commission_earnings` into this existing path.
- `backend/routes/reports/governance.js` — existing `report_schedules` supports `report_key`. Report builder must use `builder:<definition_id>` pattern to schedule saved definitions.

---

## Workstream Overview

| # | Workstream | Commit | Dependencies |
|---|-----------|--------|-------------|
| 0 | Shared foundations | `feat(phase2b): add shared foundations — migration v20, feature flags` | Phase 2A (v19) |
| 1 | Catalog depth & scheduled merchandising | `feat(phase2b): add smart collections, outlet visibility, outlet tax profiles, scheduled catalog changes` | Foundation |
| 2 | Commissions | `feat(phase2b): add commission plans, rules, and earnings tied to payroll` | Foundation |
| 3 | Report builder, smart grid & item suggestions | `feat(phase2b): add custom report builder, configurable POS tile layouts, item suggestions` | Foundation |

---

## Task 0: Shared Foundations

### Task 0.1: Migration v20 — All Phase 2B Tables

**Files:**
- Modify: `backend/migrate-pg.js` (add after v19 entry)
- Modify: `backend/schema-pg.sql` (add after Phase 2A tables, before schema_version)

**Step 1: Add migration v20 to migrate-pg.js**

Add this migration object to the `MIGRATIONS` array, after the v19 entry:

```javascript
{
  version: 20,
  description: "Phase 2B — smart collections, outlet visibility, outlet tax profiles, scheduled catalog changes, commissions, report builder, POS layouts, product affinities",
  up: async (client) => {
    // -- Smart collections --
    await client.query(`
      CREATE TABLE IF NOT EXISTS smart_collections (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        disjunctive BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        sort_order TEXT DEFAULT 'manual',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS smart_collection_rules (
        id SERIAL PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES smart_collections(id) ON DELETE CASCADE,
        field TEXT NOT NULL,
        operator TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_smart_collection_rules_collection ON smart_collection_rules(collection_id)`);

    // -- Outlet product visibility --
    await client.query(`
      CREATE TABLE IF NOT EXISTS outlet_product_visibility (
        id SERIAL PRIMARY KEY,
        outlet_id INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        is_visible BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(outlet_id, product_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_opv_outlet ON outlet_product_visibility(outlet_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_opv_product ON outlet_product_visibility(product_id)`);

    // -- Outlet tax profiles --
    await client.query(`
      CREATE TABLE IF NOT EXISTS outlet_tax_profiles (
        id SERIAL PRIMARY KEY,
        outlet_id INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(outlet_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS outlet_tax_profile_lines (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER NOT NULL REFERENCES outlet_tax_profiles(id) ON DELETE CASCADE,
        category_id INTEGER REFERENCES categories(id),
        product_id INTEGER REFERENCES products(id),
        tax_id INTEGER NOT NULL REFERENCES taxes(id),
        priority INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_otpl_profile ON outlet_tax_profile_lines(profile_id)`);

    // -- Scheduled catalog changes --
    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduled_catalog_changes (
        id SERIAL PRIMARY KEY,
        change_type TEXT NOT NULL CHECK (change_type IN ('price','visibility','status','tax')),
        entity_type TEXT NOT NULL CHECK (entity_type IN ('product','variant','collection','price_list')),
        entity_id INTEGER NOT NULL,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ NOT NULL,
        applied_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled','failed')),
        created_by INTEGER REFERENCES employees(id),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scc_status_scheduled ON scheduled_catalog_changes(status, scheduled_at) WHERE status = 'pending'`);

    // -- Commission plans --
    await client.query(`
      CREATE TABLE IF NOT EXISTS commission_plans (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL DEFAULT 'percentage' CHECK (type IN ('percentage','fixed_per_sale','fixed_per_item','tiered')),
        is_active BOOLEAN DEFAULT TRUE,
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // -- Commission plan rules --
    await client.query(`
      CREATE TABLE IF NOT EXISTS commission_plan_rules (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all','category','product','brand')),
        scope_id INTEGER,
        rate NUMERIC(8,4) NOT NULL,
        min_threshold NUMERIC(12,2) DEFAULT 0,
        max_cap NUMERIC(12,2),
        priority INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cpr_plan ON commission_plan_rules(plan_id)`);

    // -- Commission earnings --
    await client.query(`
      CREATE TABLE IF NOT EXISTS commission_earnings (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        sale_id INTEGER NOT NULL REFERENCES sales(id),
        plan_id INTEGER NOT NULL REFERENCES commission_plans(id),
        rule_id INTEGER REFERENCES commission_plan_rules(id),
        sale_amount NUMERIC(12,2) NOT NULL,
        commission_amount NUMERIC(12,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','reversed')),
        approved_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        reversed_at TIMESTAMPTZ,
        reversal_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ce_employee ON commission_earnings(employee_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ce_sale ON commission_earnings(sale_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ce_status ON commission_earnings(status)`);

    // -- Employee commission plan assignment --
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS commission_plan_id INTEGER REFERENCES commission_plans(id)`);

    // -- Custom report definitions --
    await client.query(`
      CREATE TABLE IF NOT EXISTS custom_report_definitions (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        dataset TEXT NOT NULL,
        dimensions TEXT[] NOT NULL DEFAULT '{}',
        measures TEXT[] NOT NULL DEFAULT '{}',
        filters_json TEXT DEFAULT '{}',
        sort_by TEXT,
        sort_order TEXT DEFAULT 'desc',
        created_by INTEGER REFERENCES employees(id),
        is_shared BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // -- Custom report widgets (composable visualization elements within saved reports) --
    await client.query(`
      CREATE TABLE IF NOT EXISTS custom_report_widgets (
        id SERIAL PRIMARY KEY,
        definition_id INTEGER NOT NULL REFERENCES custom_report_definitions(id) ON DELETE CASCADE,
        widget_type TEXT NOT NULL DEFAULT 'table' CHECK (widget_type IN ('table','bar_chart','line_chart','pie_chart','metric_card')),
        title TEXT,
        config_json TEXT DEFAULT '{}',
        position INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crw_definition ON custom_report_widgets(definition_id)`);

    // -- POS layouts --
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_layouts (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        scope_type TEXT NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global','outlet','role','employee')),
        scope_id INTEGER,
        layout_json TEXT NOT NULL DEFAULT '[]',
        is_active BOOLEAN DEFAULT TRUE,
        created_by INTEGER REFERENCES employees(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(scope_type, scope_id)
      )
    `);

    // -- Product affinities --
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_affinities (
        id SERIAL PRIMARY KEY,
        source_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        target_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        affinity_type TEXT NOT NULL DEFAULT 'frequently_bought_together' CHECK (affinity_type IN ('frequently_bought_together','complementary','upsell','cross_sell')),
        score NUMERIC(5,2) DEFAULT 1.0,
        is_manual BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(source_product_id, target_product_id, affinity_type)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pa_source ON product_affinities(source_product_id)`);
  }
}
```

**Step 2: Add DDL to schema-pg.sql**

Append the same `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE` statements to `backend/schema-pg.sql` after the Phase 2A tables (before the `schema_version` table). This keeps the schema file as the single source of truth.

**Step 3: Run migration to verify**

Run: `node backend/migrate-pg.js` (requires `DATABASE_URL`)
Expected: `Migration v20 applied successfully`

### Task 0.2: Feature Flags for Phase 2B

**Files:**
- Modify: `backend/middleware/feature-flags.js`

**Step 1: Add Phase 2B flags to DEFAULT_FEATURE_FLAGS**

Add these entries to the `DEFAULT_FEATURE_FLAGS` object (after the Phase 2A flags).

Note: The design doc lists only `phase2_report_builder` for this wave, but we split into 8 granular flags to allow independent rollout per feature. This is consistent with Phase 2A's pattern (5 separate flags rather than one).

```javascript
phase2_smart_collections: false,
phase2_outlet_visibility: false,
phase2_outlet_tax: false,
phase2_scheduled_changes: false,
phase2_commissions: false,
phase2_report_builder: false,
phase2_pos_layouts: false,
phase2_item_suggestions: false,
```

### Task 0.3: Commit foundations

```bash
git add backend/migrate-pg.js backend/schema-pg.sql backend/middleware/feature-flags.js
git commit -m "feat(phase2b): add shared foundations — migration v20, feature flags"
```

---

## Workstream 1: Catalog Depth & Scheduled Merchandising

This workstream covers 4 sub-features: smart collections, outlet product visibility, outlet tax profiles, and scheduled catalog changes.

### Task 1.1: Smart Collections Backend

**Files:**
- Create: `backend/routes/smart-collections.js`
- Create: `backend/schemas/smart-collections.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new route)

**Step 1: Create Zod schema**

Create `backend/schemas/smart-collections.js`:

```javascript
const { z } = require("zod");

// Design doc specifies: "supports standard columns plus metafield-based rules"
// v1 ships with standard product columns only. Metafield rules (custom attributes from
// attribute_sets/variant_option_values) can be added later by extending the field enum
// and adding a metafield resolution path in buildRuleQuery().
const ruleSchema = z.object({
  field: z.enum(["category_id", "brand_id", "product_type", "vendor", "tags", "price", "stock", "status", "created_at"]),
  operator: z.enum(["equals", "not_equals", "greater_than", "less_than", "contains", "starts_with", "in"]),
  value: z.string().min(1),
});

const createCollectionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  disjunctive: z.boolean().optional().default(false),
  sort_order: z.enum(["manual", "name_asc", "name_desc", "price_asc", "price_desc", "created_at_desc"]).optional().default("manual"),
  rules: z.array(ruleSchema).min(1).max(20),
});

const updateCollectionSchema = createCollectionSchema.partial().extend({
  is_active: z.boolean().optional(),
});

module.exports = { createCollectionSchema, updateCollectionSchema, ruleSchema };
```

**Step 2: Create route handler**

Create `backend/routes/smart-collections.js`:

```javascript
const { validate } = require("../middleware/validate");
const { createCollectionSchema, updateCollectionSchema } = require("../schemas/smart-collections");

module.exports = function registerSmartCollectionRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_smart_collections");

  // Build a WHERE clause from smart collection rules
  function buildRuleQuery(rules, disjunctive) {
    const clauses = [];
    const params = [];
    let idx = 1;

    for (const rule of rules) {
      const { field, operator, value } = rule;
      let col;
      switch (field) {
        case "category_id": col = "p.category_id"; break;
        case "brand_id": col = "p.brand_id"; break;
        case "product_type": col = "p.product_type"; break;
        case "vendor": col = "p.vendor"; break;
        case "tags": col = "p.tags"; break;
        case "price": col = "p.price"; break;
        case "stock": col = "p.stock"; break;
        case "status": col = "p.status"; break;
        case "created_at": col = "p.created_at"; break;
        default: continue;
      }

      switch (operator) {
        case "equals":
          clauses.push(`${col} = $${idx}`);
          params.push(value);
          idx++;
          break;
        case "not_equals":
          clauses.push(`${col} != $${idx}`);
          params.push(value);
          idx++;
          break;
        case "greater_than":
          clauses.push(`${col} > $${idx}`);
          params.push(value);
          idx++;
          break;
        case "less_than":
          clauses.push(`${col} < $${idx}`);
          params.push(value);
          idx++;
          break;
        case "contains":
          clauses.push(`${col} ILIKE $${idx}`);
          params.push(`%${value}%`);
          idx++;
          break;
        case "starts_with":
          clauses.push(`${col} ILIKE $${idx}`);
          params.push(`${value}%`);
          idx++;
          break;
        case "in":
          const vals = value.split(",").map(v => v.trim());
          clauses.push(`${col} = ANY($${idx})`);
          params.push(vals);
          idx++;
          break;
      }
    }

    const joiner = disjunctive ? " OR " : " AND ";
    return { where: clauses.length > 0 ? clauses.join(joiner) : "TRUE", params };
  }

  // GET /api/smart-collections
  app.get("/api/smart-collections", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT sc.*, json_agg(json_build_object(
            'id', scr.id, 'field', scr.field, 'operator', scr.operator, 'value', scr.value
          ) ORDER BY scr.id) AS rules
         FROM smart_collections sc
         LEFT JOIN smart_collection_rules scr ON scr.collection_id = sc.id
         GROUP BY sc.id
         ORDER BY sc.name`
      );
      // Clean up null rules from LEFT JOIN
      for (const row of rows) {
        if (row.rules && row.rules[0] && row.rules[0].id === null) {
          row.rules = [];
        }
      }
      res.json({ collections: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/smart-collections/:id — includes matched products
  app.get("/api/smart-collections/:id", feat, async (req, res) => {
    try {
      const { rows: cRows } = await db.query("SELECT * FROM smart_collections WHERE id = $1", [req.params.id]);
      if (!cRows.length) return res.status(404).json({ error: "Collection not found" });
      const collection = cRows[0];

      const { rows: ruleRows } = await db.query(
        "SELECT * FROM smart_collection_rules WHERE collection_id = $1 ORDER BY id", [collection.id]
      );
      collection.rules = ruleRows;

      // Evaluate rules to get matching products
      if (ruleRows.length > 0) {
        const { where, params } = buildRuleQuery(ruleRows, collection.disjunctive);
        // Apply sort_order from collection definition
        const sortMap = {
          manual: "p.id ASC",
          name_asc: "p.name ASC",
          name_desc: "p.name DESC",
          price_asc: "p.price ASC",
          price_desc: "p.price DESC",
          created_at_desc: "p.id DESC",
        };
        const orderClause = sortMap[collection.sort_order] || "p.name ASC";
        const { rows: products } = await db.query(
          `SELECT p.id, p.name, p.barcode, p.price, p.stock, p.status, p.image_url
           FROM products p
           WHERE p.deleted_at IS NULL AND (${where})
           ORDER BY ${orderClause}
           LIMIT 500`,
          params
        );
        collection.products = products;
        collection.product_count = products.length;
      } else {
        collection.products = [];
        collection.product_count = 0;
      }

      res.json({ collection });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/smart-collections
  app.post("/api/smart-collections", feat, requirePerm("all_access"), validate(createCollectionSchema), async (req, res) => {
    const { name, description, disjunctive, sort_order, rules } = req.body;
    try {
      const result = await db.transaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO smart_collections (name, description, disjunctive, sort_order)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [name, description || null, disjunctive, sort_order]
        );
        const collection = rows[0];

        for (const rule of rules) {
          await client.query(
            `INSERT INTO smart_collection_rules (collection_id, field, operator, value)
             VALUES ($1,$2,$3,$4)`,
            [collection.id, rule.field, rule.operator, rule.value]
          );
        }
        return collection;
      });
      res.status(201).json({ collection: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/smart-collections/:id
  app.put("/api/smart-collections/:id", feat, requirePerm("all_access"), validate(updateCollectionSchema), async (req, res) => {
    const { name, description, disjunctive, sort_order, is_active, rules } = req.body;
    try {
      const result = await db.transaction(async (client) => {
        const { rows } = await client.query("SELECT * FROM smart_collections WHERE id = $1", [req.params.id]);
        if (!rows.length) return null;

        const sets = [];
        const vals = [];
        let idx = 1;

        if (name !== undefined) { sets.push(`name = $${idx}`); vals.push(name); idx++; }
        if (description !== undefined) { sets.push(`description = $${idx}`); vals.push(description); idx++; }
        if (disjunctive !== undefined) { sets.push(`disjunctive = $${idx}`); vals.push(disjunctive); idx++; }
        if (sort_order !== undefined) { sets.push(`sort_order = $${idx}`); vals.push(sort_order); idx++; }
        if (is_active !== undefined) { sets.push(`is_active = $${idx}`); vals.push(is_active); idx++; }
        sets.push(`updated_at = NOW()`);

        vals.push(req.params.id);
        const { rows: updated } = await client.query(
          `UPDATE smart_collections SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
        );

        // Replace rules if provided
        if (rules) {
          await client.query("DELETE FROM smart_collection_rules WHERE collection_id = $1", [req.params.id]);
          for (const rule of rules) {
            await client.query(
              `INSERT INTO smart_collection_rules (collection_id, field, operator, value)
               VALUES ($1,$2,$3,$4)`,
              [req.params.id, rule.field, rule.operator, rule.value]
            );
          }
        }

        return updated[0];
      });

      if (!result) return res.status(404).json({ error: "Collection not found" });
      res.json({ collection: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/smart-collections/:id
  app.delete("/api/smart-collections/:id", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM smart_collections WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Collection not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 3: Mount in registerAllRoutes.js**

Add after the Phase 2A route blocks (after `require("./draft-orders")(app, deps);`):

```javascript
  // --- ROUTES: SMART COLLECTIONS (Phase 2B) ---
  require("./smart-collections")(app, deps);
```

### Task 1.2: Outlet Product Visibility Backend

**Files:**
- Create: `backend/routes/outlet-visibility.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new route)

**Step 1: Create route handler**

Create `backend/routes/outlet-visibility.js`:

```javascript
module.exports = function registerOutletVisibilityRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_outlet_visibility");

  // GET /api/products/:id/outlet-visibility
  app.get("/api/products/:id/outlet-visibility", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT o.id AS outlet_id, o.name AS outlet_name,
                COALESCE(opv.is_visible, TRUE) AS is_visible,
                opv.updated_at
         FROM outlets o
         LEFT JOIN outlet_product_visibility opv ON opv.outlet_id = o.id AND opv.product_id = $1
         WHERE o.is_active = TRUE
         ORDER BY o.name`,
        [req.params.id]
      );
      res.json({ visibility: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/products/:id/outlet-visibility
  // Body: { outlets: [{ outlet_id, is_visible }] }
  app.put("/api/products/:id/outlet-visibility", feat, requirePerm("all_access"), async (req, res) => {
    const { outlets } = req.body;
    if (!Array.isArray(outlets)) return res.status(400).json({ error: "outlets array required" });
    try {
      await db.transaction(async (client) => {
        for (const { outlet_id, is_visible } of outlets) {
          await client.query(
            `INSERT INTO outlet_product_visibility (outlet_id, product_id, is_visible)
             VALUES ($1, $2, $3)
             ON CONFLICT (outlet_id, product_id)
             DO UPDATE SET is_visible = $3, updated_at = NOW()`,
            [outlet_id, req.params.id, is_visible !== false]
          );
        }
      });
      // Return updated state
      const { rows } = await db.query(
        `SELECT o.id AS outlet_id, o.name AS outlet_name,
                COALESCE(opv.is_visible, TRUE) AS is_visible
         FROM outlets o
         LEFT JOIN outlet_product_visibility opv ON opv.outlet_id = o.id AND opv.product_id = $1
         WHERE o.is_active = TRUE
         ORDER BY o.name`,
        [req.params.id]
      );
      res.json({ visibility: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/outlet-visibility/by-outlet/:outletId — list visible products for an outlet
  app.get("/api/outlet-visibility/by-outlet/:outletId", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT p.id, p.name, p.barcode, p.price, p.status,
                COALESCE(opv.is_visible, TRUE) AS is_visible
         FROM products p
         LEFT JOIN outlet_product_visibility opv ON opv.product_id = p.id AND opv.outlet_id = $1
         WHERE p.deleted_at IS NULL AND p.status = 'active'
         ORDER BY p.name`,
        [req.params.outletId]
      );
      res.json({ products: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/outlet-visibility/bulk — bulk set visibility for an outlet
  // Body: { outlet_id, product_ids: [1,2,3], is_visible: true/false }
  app.put("/api/outlet-visibility/bulk", feat, requirePerm("all_access"), async (req, res) => {
    const { outlet_id, product_ids, is_visible } = req.body;
    if (!outlet_id || !Array.isArray(product_ids)) {
      return res.status(400).json({ error: "outlet_id and product_ids array required" });
    }
    try {
      await db.transaction(async (client) => {
        for (const pid of product_ids) {
          await client.query(
            `INSERT INTO outlet_product_visibility (outlet_id, product_id, is_visible)
             VALUES ($1, $2, $3)
             ON CONFLICT (outlet_id, product_id)
             DO UPDATE SET is_visible = $3, updated_at = NOW()`,
            [outlet_id, pid, is_visible !== false]
          );
        }
      });
      res.json({ success: true, updated: product_ids.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 2: Mount in registerAllRoutes.js**

```javascript
  // --- ROUTES: OUTLET VISIBILITY (Phase 2B) ---
  require("./outlet-visibility")(app, deps);
```

### Task 1.3: Outlet Tax Profiles Backend

**Files:**
- Create: `backend/routes/outlet-tax-profiles.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new route)

**Step 1: Create route handler**

Create `backend/routes/outlet-tax-profiles.js`:

```javascript
module.exports = function registerOutletTaxProfileRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_outlet_tax");

  // GET /api/outlet-tax-profiles
  app.get("/api/outlet-tax-profiles", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT otp.*,
                o.name AS outlet_name,
                json_agg(json_build_object(
                  'id', otpl.id,
                  'category_id', otpl.category_id,
                  'product_id', otpl.product_id,
                  'tax_id', otpl.tax_id,
                  'priority', otpl.priority,
                  'tax_name', t.name,
                  'tax_rate', t.rate
                ) ORDER BY otpl.priority DESC) FILTER (WHERE otpl.id IS NOT NULL) AS lines
         FROM outlet_tax_profiles otp
         JOIN outlets o ON o.id = otp.outlet_id
         LEFT JOIN outlet_tax_profile_lines otpl ON otpl.profile_id = otp.id
         LEFT JOIN taxes t ON t.id = otpl.tax_id
         GROUP BY otp.id, o.name
         ORDER BY o.name`
      );
      res.json({ profiles: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/outlet-tax-profiles/:id
  app.get("/api/outlet-tax-profiles/:id", feat, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM outlet_tax_profiles WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Profile not found" });
      const profile = rows[0];

      const { rows: lines } = await db.query(
        `SELECT otpl.*, t.name AS tax_name, t.rate AS tax_rate
         FROM outlet_tax_profile_lines otpl
         JOIN taxes t ON t.id = otpl.tax_id
         WHERE otpl.profile_id = $1
         ORDER BY otpl.priority DESC`,
        [profile.id]
      );
      profile.lines = lines;
      res.json({ profile });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/outlet-tax-profiles/:outletId
  // Body: { name, is_active, lines: [{ category_id?, product_id?, tax_id, priority }] }
  app.put("/api/outlet-tax-profiles/:outletId", feat, requirePerm("all_access"), async (req, res) => {
    const { name, is_active, lines } = req.body;
    const outletId = req.params.outletId;
    try {
      const result = await db.transaction(async (client) => {
        // Upsert profile
        const { rows } = await client.query(
          `INSERT INTO outlet_tax_profiles (outlet_id, name, is_active)
           VALUES ($1, $2, $3)
           ON CONFLICT (outlet_id) DO UPDATE SET
             name = COALESCE($2, outlet_tax_profiles.name),
             is_active = COALESCE($3, outlet_tax_profiles.is_active),
             updated_at = NOW()
           RETURNING *`,
          [outletId, name || "Default", is_active !== false]
        );
        const profile = rows[0];

        // Replace lines if provided
        if (Array.isArray(lines)) {
          await client.query("DELETE FROM outlet_tax_profile_lines WHERE profile_id = $1", [profile.id]);
          for (const line of lines) {
            await client.query(
              `INSERT INTO outlet_tax_profile_lines (profile_id, category_id, product_id, tax_id, priority)
               VALUES ($1, $2, $3, $4, $5)`,
              [profile.id, line.category_id || null, line.product_id || null, line.tax_id, line.priority || 0]
            );
          }
        }
        return profile;
      });
      res.json({ profile: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/outlet-tax-profiles/:outletId
  app.delete("/api/outlet-tax-profiles/:outletId", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM outlet_tax_profiles WHERE outlet_id = $1", [req.params.outletId]);
      if (!rowCount) return res.status(404).json({ error: "No tax profile for this outlet" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/outlet-tax-profiles/resolve?outlet_id=X&product_id=Y&category_id=Z
  // Resolves the effective tax for a product at a specific outlet
  app.get("/api/outlet-tax-profiles/resolve", feat, async (req, res) => {
    const { outlet_id, product_id, category_id } = req.query;
    if (!outlet_id) return res.status(400).json({ error: "outlet_id required" });
    try {
      // Check outlet profile first
      const { rows: profileLines } = await db.query(
        `SELECT otpl.*, t.name AS tax_name, t.rate AS tax_rate
         FROM outlet_tax_profiles otp
         JOIN outlet_tax_profile_lines otpl ON otpl.profile_id = otp.id
         LEFT JOIN taxes t ON t.id = otpl.tax_id
         WHERE otp.outlet_id = $1 AND otp.is_active = TRUE
           AND (otpl.product_id = $2 OR otpl.category_id = $3 OR (otpl.product_id IS NULL AND otpl.category_id IS NULL))
         ORDER BY otpl.priority DESC
         LIMIT 1`,
        [outlet_id, product_id || null, category_id || null]
      );

      if (profileLines.length) {
        return res.json({ tax: profileLines[0], source: "outlet_profile" });
      }

      // Fall back to product/category default tax
      if (product_id) {
        const { rows } = await db.query(
          `SELECT t.id AS tax_id, t.name AS tax_name, t.rate AS tax_rate
           FROM products p
           LEFT JOIN taxes t ON t.id = p.tax_id
           WHERE p.id = $1`,
          [product_id]
        );
        if (rows.length && rows[0].tax_id) {
          return res.json({ tax: rows[0], source: "product_default" });
        }
      }

      res.json({ tax: null, source: "none" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 2: Mount in registerAllRoutes.js**

```javascript
  // --- ROUTES: OUTLET TAX PROFILES (Phase 2B) ---
  require("./outlet-tax-profiles")(app, deps);
```

### Task 1.4: Scheduled Catalog Changes Backend

**Files:**
- Create: `backend/routes/scheduled-changes.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new route)
- Modify: `backend/boot/workers.js` (add scheduler worker)

**Step 1: Create route handler**

Create `backend/routes/scheduled-changes.js`:

```javascript
module.exports = function registerScheduledChangesRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_scheduled_changes");

  // GET /api/catalog/scheduled-changes
  app.get("/api/catalog/scheduled-changes", feat, async (req, res) => {
    const { status, change_type } = req.query;
    try {
      let where = "1=1";
      const params = [];
      let idx = 1;

      if (status) { where += ` AND scc.status = $${idx}`; params.push(status); idx++; }
      if (change_type) { where += ` AND scc.change_type = $${idx}`; params.push(change_type); idx++; }

      const { rows } = await db.query(
        `SELECT scc.*, e.name AS created_by_name
         FROM scheduled_catalog_changes scc
         LEFT JOIN employees e ON e.id = scc.created_by
         WHERE ${where}
         ORDER BY scc.scheduled_at ASC`,
        params
      );
      res.json({ changes: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/catalog/scheduled-changes
  app.post("/api/catalog/scheduled-changes", feat, requirePerm("all_access"), async (req, res) => {
    const { change_type, entity_type, entity_id, field_name, new_value, scheduled_at, notes } = req.body;
    if (!change_type || !entity_type || !entity_id || !field_name || !new_value || !scheduled_at) {
      return res.status(400).json({ error: "change_type, entity_type, entity_id, field_name, new_value, and scheduled_at are required" });
    }
    if (new Date(scheduled_at) <= new Date()) {
      return res.status(400).json({ error: "scheduled_at must be in the future" });
    }
    try {
      // Capture current value for audit trail
      let old_value = null;
      if (entity_type === "product") {
        const { rows } = await db.query(`SELECT ${field_name} FROM products WHERE id = $1`, [entity_id]);
        if (rows.length) old_value = String(rows[0][field_name]);
      } else if (entity_type === "variant") {
        const { rows } = await db.query(`SELECT ${field_name} FROM product_variants WHERE id = $1`, [entity_id]);
        if (rows.length) old_value = String(rows[0][field_name]);
      } else if (entity_type === "price_list") {
        // Price list changes reference price_list_items
        old_value = null; // captured at apply time
      }

      const { rows } = await db.query(
        `INSERT INTO scheduled_catalog_changes
         (change_type, entity_type, entity_id, field_name, old_value, new_value, scheduled_at, created_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [change_type, entity_type, entity_id, field_name, old_value, new_value, scheduled_at, req.employee?.id, notes || null]
      );
      res.status(201).json({ change: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/catalog/scheduled-changes/:id
  app.put("/api/catalog/scheduled-changes/:id", feat, requirePerm("all_access"), async (req, res) => {
    const { new_value, scheduled_at, notes, status } = req.body;
    try {
      const { rows } = await db.query("SELECT * FROM scheduled_catalog_changes WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Scheduled change not found" });
      if (rows[0].status !== "pending") return res.status(400).json({ error: "Only pending changes can be edited" });

      const sets = [];
      const vals = [];
      let idx = 1;
      if (new_value !== undefined) { sets.push(`new_value = $${idx}`); vals.push(new_value); idx++; }
      if (scheduled_at !== undefined) { sets.push(`scheduled_at = $${idx}`); vals.push(scheduled_at); idx++; }
      if (notes !== undefined) { sets.push(`notes = $${idx}`); vals.push(notes); idx++; }
      if (status === "cancelled") { sets.push(`status = $${idx}`); vals.push("cancelled"); idx++; }

      if (!sets.length) return res.status(400).json({ error: "No fields to update" });

      vals.push(req.params.id);
      const { rows: updated } = await db.query(
        `UPDATE scheduled_catalog_changes SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
      );
      res.json({ change: updated[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 2: Create the catalog scheduler worker logic**

Add to `backend/boot/workers.js` (inside the main function, after existing worker blocks):

```javascript
  // --- Scheduled catalog changes worker ---
  if (process.env.SCHEDULED_CATALOG_WORKER_ENABLED === "1") {
    const catalogInterval = setInterval(async () => {
      try {
        const { rows } = await db.query(
          `SELECT * FROM scheduled_catalog_changes
           WHERE status = 'pending' AND scheduled_at <= NOW()
           ORDER BY scheduled_at ASC
           LIMIT 50`
        );
        for (const change of rows) {
          try {
            let updateSql;
            if (change.entity_type === "product") {
              updateSql = `UPDATE products SET ${change.field_name} = $1 WHERE id = $2`;
            } else if (change.entity_type === "variant") {
              updateSql = `UPDATE product_variants SET ${change.field_name} = $1 WHERE id = $2`;
            } else {
              await db.query("UPDATE scheduled_catalog_changes SET status = 'failed', applied_at = NOW() WHERE id = $1", [change.id]);
              continue;
            }
            await db.transaction(async (client) => {
              await client.query(updateSql, [change.new_value, change.entity_id]);
              await client.query(
                "UPDATE scheduled_catalog_changes SET status = 'applied', applied_at = NOW() WHERE id = $1",
                [change.id]
              );
            });
          } catch (err) {
            await db.query("UPDATE scheduled_catalog_changes SET status = 'failed', applied_at = NOW() WHERE id = $1", [change.id]);
          }
        }
      } catch (err) {
        // Log but don't crash
        console.error("[catalog-scheduler] poll error:", err.message);
      }
    }, 60_000); // Check every minute

    global.__catalogSchedulerStatus = { lastPollAt: null, processedToday: 0 };
  }
```

**Step 3: Mount in registerAllRoutes.js**

```javascript
  // --- ROUTES: SCHEDULED CATALOG CHANGES (Phase 2B) ---
  require("./scheduled-changes")(app, deps);
```

### Task 1.5: Catalog Depth Frontend — Smart Collections Page

**Files:**
- Create: `frontend/src/pages/redesign/SmartCollectionsRedesign.jsx`
- Create: `frontend/src/pages/SmartCollectionsRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx` (add route)
- Modify: `frontend/src/ui/nav-config.js` (add nav entry)
- Modify: `frontend/src/ui/Breadcrumbs.jsx` (add label)

**Implementation guidance:**

The Smart Collections page should follow the pattern of existing CRUD pages (e.g., `ReturnPoliciesRedesign.jsx`). Key UI elements:

1. List view: table of collections with name, rule count, product count, active/inactive status, edit/delete actions
2. Create/Edit modal with:
   - Name, description fields
   - AND/OR toggle for `disjunctive` mode
   - Dynamic rule builder: field dropdown, operator dropdown (changes based on field), value input
   - Add/remove rule buttons
   - Sort order dropdown
3. Click-through detail view showing matched products

**Route wrapper** (`SmartCollectionsRoute.jsx`):
```jsx
import SmartCollectionsRedesign from "./redesign/SmartCollectionsRedesign";
export default function SmartCollectionsRoute() { return <SmartCollectionsRedesign />; }
```

**Nav entry** in `nav-config.js` — add to the Products/Catalog group:
```javascript
{ name: "Smart Collections", path: "/smart-collections", icon: Layers, requiredPerm: "all_access", requiredFlag: "phase2_smart_collections" }
```

**Breadcrumb** — add to LABELS in `Breadcrumbs.jsx`:
```javascript
"smart-collections": "Smart Collections",
```

**Route** in `appRoutes.jsx`:
```jsx
const SmartCollectionsRoute = lazy(() => import("../pages/SmartCollectionsRoute"));
// Inside route tree:
<Route path="/smart-collections" element={<RequireAuth><RequirePerm perm="all_access"><SmartCollectionsRoute /></RequirePerm></RequireAuth>} />
```

### Task 1.6: Catalog Depth Frontend — Outlet Visibility Tab in Product Detail

**Files:**
- Modify: `frontend/src/pages/redesign/ProductDetailRedesign.jsx` (or the product edit page — add Outlet Visibility tab)

**Implementation guidance:**

Add an "Outlet Visibility" tab to the product detail/edit page. This tab should:
1. Fetch `GET /api/products/:id/outlet-visibility`
2. Display a table of outlets with toggle switches for visibility
3. Save changes via `PUT /api/products/:id/outlet-visibility`
4. Feature-gated: only show tab if `phase2_outlet_visibility` flag is on

### Task 1.7: Catalog Depth Frontend — Outlet Tax Profiles Page

**Files:**
- Create: `frontend/src/pages/redesign/OutletTaxProfilesRedesign.jsx`
- Create: `frontend/src/pages/OutletTaxProfilesRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

**Implementation guidance:**

Page shows one tax profile per outlet. For each outlet:
1. A card showing the outlet name and profile status
2. Expandable section with tax override lines (category → tax rate, product → tax rate)
3. Add/remove line buttons
4. Tax dropdown from existing `taxes` table
5. Category and product pickers for targeted overrides

**Nav entry**: Settings group, `{ name: "Outlet Tax Profiles", path: "/settings/outlet-tax-profiles", icon: Receipt, requiredPerm: "all_access", requiredFlag: "phase2_outlet_tax" }`

### Task 1.8: Catalog Depth Frontend — Scheduled Changes Page

**Files:**
- Create: `frontend/src/pages/redesign/ScheduledChangesRedesign.jsx`
- Create: `frontend/src/pages/ScheduledChangesRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

**Implementation guidance:**

A dashboard-style page showing:
1. Upcoming changes (pending, sorted by scheduled_at)
2. Applied changes (recently applied, last 30 days)
3. Create form: entity picker (product/variant), field, new value, date/time picker, notes
4. Cancel button for pending changes
5. Status badges: pending (yellow), applied (green), cancelled (gray), failed (red)

**Nav entry**: Products/Catalog group, `{ name: "Scheduled Changes", path: "/scheduled-changes", icon: Clock, requiredPerm: "all_access", requiredFlag: "phase2_scheduled_changes" }`

### Task 1.9: Commit Workstream 1

```bash
git add backend/routes/smart-collections.js backend/routes/outlet-visibility.js backend/routes/outlet-tax-profiles.js backend/routes/scheduled-changes.js backend/schemas/smart-collections.js backend/routes/registerAllRoutes.js backend/boot/workers.js frontend/src/pages/redesign/SmartCollectionsRedesign.jsx frontend/src/pages/SmartCollectionsRoute.jsx frontend/src/pages/redesign/OutletTaxProfilesRedesign.jsx frontend/src/pages/OutletTaxProfilesRoute.jsx frontend/src/pages/redesign/ScheduledChangesRedesign.jsx frontend/src/pages/ScheduledChangesRoute.jsx frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js frontend/src/ui/Breadcrumbs.jsx
git commit -m "feat(phase2b): add smart collections, outlet visibility, outlet tax profiles, scheduled catalog changes"
```

---

## Workstream 2: Commissions

### Task 2.1: Commission Plans Backend

**Files:**
- Create: `backend/routes/commissions.js`
- Create: `backend/schemas/commissions.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new route)

**Step 1: Create Zod schema**

Create `backend/schemas/commissions.js`:

```javascript
const { z } = require("zod");

const ruleSchema = z.object({
  scope_type: z.enum(["all", "category", "product", "brand"]).default("all"),
  scope_id: z.number().int().positive().nullable().optional(),
  rate: z.number().min(0).max(100),
  min_threshold: z.number().min(0).optional().default(0),
  max_cap: z.number().min(0).nullable().optional(),
  priority: z.number().int().min(0).optional().default(0),
});

const createPlanSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  type: z.enum(["percentage", "fixed_per_sale", "fixed_per_item", "tiered"]).default("percentage"),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  rules: z.array(ruleSchema).min(1).max(50),
});

const updatePlanSchema = createPlanSchema.partial().extend({
  is_active: z.boolean().optional(),
});

module.exports = { createPlanSchema, updatePlanSchema };
```

**Step 2: Create route handler**

Create `backend/routes/commissions.js`:

```javascript
const { validate } = require("../middleware/validate");
const { createPlanSchema, updatePlanSchema } = require("../schemas/commissions");

module.exports = function registerCommissionRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature } = deps;
  const feat = requireFeature("phase2_commissions");

  // ── Commission Plans CRUD ──────────────────────────────────────────

  // GET /api/commission-plans
  app.get("/api/commission-plans", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT cp.*,
                json_agg(json_build_object(
                  'id', cpr.id, 'scope_type', cpr.scope_type, 'scope_id', cpr.scope_id,
                  'rate', cpr.rate, 'min_threshold', cpr.min_threshold, 'max_cap', cpr.max_cap,
                  'priority', cpr.priority
                ) ORDER BY cpr.priority DESC) FILTER (WHERE cpr.id IS NOT NULL) AS rules,
                (SELECT COUNT(*) FROM employees e WHERE e.commission_plan_id = cp.id AND e.deleted_at IS NULL) AS assigned_employees
         FROM commission_plans cp
         LEFT JOIN commission_plan_rules cpr ON cpr.plan_id = cp.id
         GROUP BY cp.id
         ORDER BY cp.name`
      );
      res.json({ plans: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/commission-plans
  app.post("/api/commission-plans", feat, requirePerm("all_access"), validate(createPlanSchema), async (req, res) => {
    const { name, description, type, starts_at, ends_at, rules } = req.body;
    try {
      const result = await db.transaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO commission_plans (name, description, type, starts_at, ends_at)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [name, description || null, type, starts_at || null, ends_at || null]
        );
        const plan = rows[0];
        for (const rule of rules) {
          await client.query(
            `INSERT INTO commission_plan_rules (plan_id, scope_type, scope_id, rate, min_threshold, max_cap, priority)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [plan.id, rule.scope_type, rule.scope_id || null, rule.rate, rule.min_threshold || 0, rule.max_cap || null, rule.priority || 0]
          );
        }
        return plan;
      });
      res.status(201).json({ plan: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/commission-plans/:id
  app.put("/api/commission-plans/:id", feat, requirePerm("all_access"), validate(updatePlanSchema), async (req, res) => {
    const { name, description, type, is_active, starts_at, ends_at, rules } = req.body;
    try {
      const result = await db.transaction(async (client) => {
        const { rows: existing } = await client.query("SELECT * FROM commission_plans WHERE id = $1", [req.params.id]);
        if (!existing.length) return null;

        const sets = [];
        const vals = [];
        let idx = 1;
        if (name !== undefined) { sets.push(`name = $${idx}`); vals.push(name); idx++; }
        if (description !== undefined) { sets.push(`description = $${idx}`); vals.push(description); idx++; }
        if (type !== undefined) { sets.push(`type = $${idx}`); vals.push(type); idx++; }
        if (is_active !== undefined) { sets.push(`is_active = $${idx}`); vals.push(is_active); idx++; }
        if (starts_at !== undefined) { sets.push(`starts_at = $${idx}`); vals.push(starts_at); idx++; }
        if (ends_at !== undefined) { sets.push(`ends_at = $${idx}`); vals.push(ends_at); idx++; }
        sets.push(`updated_at = NOW()`);

        vals.push(req.params.id);
        const { rows: updated } = await client.query(
          `UPDATE commission_plans SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
        );

        if (rules) {
          await client.query("DELETE FROM commission_plan_rules WHERE plan_id = $1", [req.params.id]);
          for (const rule of rules) {
            await client.query(
              `INSERT INTO commission_plan_rules (plan_id, scope_type, scope_id, rate, min_threshold, max_cap, priority)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [req.params.id, rule.scope_type, rule.scope_id || null, rule.rate, rule.min_threshold || 0, rule.max_cap || null, rule.priority || 0]
            );
          }
        }
        return updated[0];
      });
      if (!result) return res.status(404).json({ error: "Plan not found" });
      res.json({ plan: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/commission-plans/:id
  app.delete("/api/commission-plans/:id", feat, requirePerm("all_access"), async (req, res) => {
    try {
      // Unassign employees first
      await db.query("UPDATE employees SET commission_plan_id = NULL WHERE commission_plan_id = $1", [req.params.id]);
      const { rowCount } = await db.query("DELETE FROM commission_plans WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Plan not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/commission-plans/:id/assign
  // Body: { employee_ids: [1, 2, 3] }
  app.post("/api/commission-plans/:id/assign", feat, requirePerm("all_access"), async (req, res) => {
    const { employee_ids } = req.body;
    if (!Array.isArray(employee_ids)) return res.status(400).json({ error: "employee_ids array required" });
    try {
      const { rows } = await db.query("SELECT id FROM commission_plans WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Plan not found" });

      await db.query(
        "UPDATE employees SET commission_plan_id = $1 WHERE id = ANY($2) AND deleted_at IS NULL",
        [req.params.id, employee_ids]
      );
      res.json({ success: true, assigned: employee_ids.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Commission Earnings ────────────────────────────────────────────

  // GET /api/commissions/earnings
  app.get("/api/commissions/earnings", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    const { employee_id, status, from, to } = req.query;
    try {
      let where = "1=1";
      const params = [];
      let idx = 1;

      if (employee_id) { where += ` AND ce.employee_id = $${idx}`; params.push(employee_id); idx++; }
      if (status) { where += ` AND ce.status = $${idx}`; params.push(status); idx++; }
      if (from) { where += ` AND ce.created_at >= $${idx}`; params.push(from); idx++; }
      if (to) { where += ` AND ce.created_at < $${idx}`; params.push(to); idx++; }

      const { rows } = await db.query(
        `SELECT ce.*, e.name AS employee_name, cp.name AS plan_name, s.invoice_number
         FROM commission_earnings ce
         JOIN employees e ON e.id = ce.employee_id
         JOIN commission_plans cp ON cp.id = ce.plan_id
         JOIN sales s ON s.id = ce.sale_id
         WHERE ${where}
         ORDER BY ce.created_at DESC
         LIMIT 500`,
        params
      );

      // Summary aggregation
      const { rows: summary } = await db.query(
        `SELECT
           COUNT(*) AS total_records,
           SUM(commission_amount) FILTER (WHERE status = 'pending') AS pending_total,
           SUM(commission_amount) FILTER (WHERE status = 'approved') AS approved_total,
           SUM(commission_amount) FILTER (WHERE status = 'paid') AS paid_total
         FROM commission_earnings ce
         WHERE ${where}`,
        params
      );

      res.json({ earnings: rows, summary: summary[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/commissions/earnings/:id/status
  // Body: { status: "approved" | "paid" | "reversed", reversal_reason? }
  app.put("/api/commissions/earnings/:id/status", feat, requirePerm("all_access"), async (req, res) => {
    const { status, reversal_reason } = req.body;
    const validTransitions = {
      pending: ["approved", "reversed"],
      approved: ["paid", "reversed"],
    };
    try {
      const { rows } = await db.query("SELECT * FROM commission_earnings WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Earning not found" });

      const current = rows[0];
      if (!validTransitions[current.status]?.includes(status)) {
        return res.status(400).json({ error: `Cannot transition from ${current.status} to ${status}` });
      }

      const sets = [`status = $1`];
      const vals = [status];
      if (status === "approved") { sets.push("approved_at = NOW()"); }
      if (status === "paid") { sets.push("paid_at = NOW()"); }
      if (status === "reversed") { sets.push("reversed_at = NOW()"); sets.push(`reversal_reason = $2`); vals.push(reversal_reason || null); }

      vals.push(req.params.id);
      const { rows: updated } = await db.query(
        `UPDATE commission_earnings SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
      );
      res.json({ earning: updated[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/commissions/calculate — calculate commissions for a sale (called after sale finalization)
  // Body: { sale_id }
  app.post("/api/commissions/calculate", feat, async (req, res) => {
    const { sale_id } = req.body;
    if (!sale_id) return res.status(400).json({ error: "sale_id required" });
    try {
      // Get sale with items
      const { rows: saleRows } = await db.query(
        `SELECT s.*, e.commission_plan_id
         FROM sales s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.id = $1 AND s.voided = FALSE`,
        [sale_id]
      );
      if (!saleRows.length) return res.status(404).json({ error: "Sale not found or voided" });
      const sale = saleRows[0];
      if (!sale.commission_plan_id) return res.json({ earnings: [], message: "Employee has no commission plan" });

      // Check plan is active
      const { rows: planRows } = await db.query(
        `SELECT * FROM commission_plans WHERE id = $1 AND is_active = TRUE
         AND (starts_at IS NULL OR starts_at <= $2) AND (ends_at IS NULL OR ends_at >= $2)`,
        [sale.commission_plan_id, sale.timestamp]
      );
      if (!planRows.length) return res.json({ earnings: [], message: "Commission plan not active" });
      const plan = planRows[0];

      // Get rules
      const { rows: rules } = await db.query(
        "SELECT * FROM commission_plan_rules WHERE plan_id = $1 ORDER BY priority DESC", [plan.id]
      );

      // Get sale items with product info
      const { rows: items } = await db.query(
        `SELECT si.*, p.category_id, p.brand_id
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = $1`,
        [sale_id]
      );

      let totalCommission = 0;
      const earnings = [];

      if (plan.type === "percentage" || plan.type === "tiered") {
        // Match each item to best rule
        for (const item of items) {
          const matchedRule = rules.find(r => {
            if (r.scope_type === "all") return true;
            if (r.scope_type === "product" && r.scope_id === item.product_id) return true;
            if (r.scope_type === "category" && r.scope_id === item.category_id) return true;
            if (r.scope_type === "brand" && r.scope_id === item.brand_id) return true;
            return false;
          });
          if (!matchedRule) continue;

          const itemTotal = Number(item.price_at_sale) * item.quantity;
          if (itemTotal < Number(matchedRule.min_threshold)) continue;

          let commission = itemTotal * Number(matchedRule.rate) / 100;
          if (matchedRule.max_cap && commission > Number(matchedRule.max_cap)) {
            commission = Number(matchedRule.max_cap);
          }
          totalCommission += commission;
        }

        if (totalCommission > 0) {
          // Find the best-matching rule for the overall sale (for audit)
          const bestRule = rules[0];
          const { rows: inserted } = await db.query(
            `INSERT INTO commission_earnings (employee_id, sale_id, plan_id, rule_id, sale_amount, commission_amount)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [sale.employee_id, sale_id, plan.id, bestRule?.id || null,
             Number(sale.total_amount), Math.round(totalCommission * 100) / 100]
          );
          earnings.push(inserted[0]);
        }
      } else if (plan.type === "fixed_per_sale") {
        const rule = rules[0];
        if (rule && Number(sale.total_amount) >= Number(rule.min_threshold)) {
          const commission = Math.min(Number(rule.rate), rule.max_cap ? Number(rule.max_cap) : Infinity);
          const { rows: inserted } = await db.query(
            `INSERT INTO commission_earnings (employee_id, sale_id, plan_id, rule_id, sale_amount, commission_amount)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [sale.employee_id, sale_id, plan.id, rule.id, Number(sale.total_amount), commission]
          );
          earnings.push(inserted[0]);
        }
      } else if (plan.type === "fixed_per_item") {
        const rule = rules[0];
        if (rule) {
          const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
          const commission = Math.min(totalQty * Number(rule.rate), rule.max_cap ? Number(rule.max_cap) : Infinity);
          const { rows: inserted } = await db.query(
            `INSERT INTO commission_earnings (employee_id, sale_id, plan_id, rule_id, sale_amount, commission_amount)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [sale.employee_id, sale_id, plan.id, rule.id, Number(sale.total_amount), commission]
          );
          earnings.push(inserted[0]);
        }
      }

      res.json({ earnings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 3: Mount in registerAllRoutes.js**

```javascript
  // --- ROUTES: COMMISSIONS (Phase 2B) ---
  require("./commissions")(app, deps);
```

### Task 2.2: Commission Calculation Hook in Sales Route

**Files:**
- Modify: `backend/routes/sales.js` (add commission calculation after sale creation)

**Implementation guidance:**

After the sale is successfully created in `POST /api/sales` (inside the transaction success path, after stock deduction and FBR enqueue), add:

```javascript
// Calculate commissions (fire-and-forget, don't block sale response)
if (employee?.commission_plan_id) {
  db.query(
    `INSERT INTO commission_earnings (employee_id, sale_id, plan_id, rule_id, sale_amount, commission_amount)
     SELECT $1, $2, cpr.plan_id, cpr.id, $3,
       CASE cp.type
         WHEN 'percentage' THEN LEAST($3 * cpr.rate / 100, COALESCE(cpr.max_cap, $3 * cpr.rate / 100))
         WHEN 'fixed_per_sale' THEN LEAST(cpr.rate, COALESCE(cpr.max_cap, cpr.rate))
         ELSE 0
       END
     FROM commission_plans cp
     JOIN commission_plan_rules cpr ON cpr.plan_id = cp.id
     WHERE cp.id = $4 AND cp.is_active = TRUE
       AND (cp.starts_at IS NULL OR cp.starts_at <= NOW())
       AND (cp.ends_at IS NULL OR cp.ends_at >= NOW())
       AND $3 >= cpr.min_threshold
     ORDER BY cpr.priority DESC
     LIMIT 1`,
    [employee.id, saleId, total_amount, employee.commission_plan_id]
  ).catch(err => console.error("[commission] auto-calc error:", err.message));
}
```

**Note:** The full `/api/commissions/calculate` endpoint exists for manual recalculation and detailed per-item commission. The inline hook above is a lightweight path for the common case.

### Task 2.3: Wire Commission Earnings into Payroll Generation

**Files:**
- Modify: `backend/routes/tier4/hr.js` (payroll generation endpoint)

**Implementation guidance:**

The existing `POST /api/hr/payroll/periods/:id/generate` already calculates commissions inline from sales data. With the new `commission_earnings` table, update this endpoint to:

1. After generating base payroll lines, query `commission_earnings` for the period date range:
```javascript
const { rows: commissions } = await client.query(
  `SELECT employee_id, SUM(commission_amount) AS total_commission
   FROM commission_earnings
   WHERE status IN ('pending','approved') AND created_at >= $1 AND created_at < $2
   GROUP BY employee_id`,
  [period.start_date, period.end_date]
);
```

2. Add the commission total to each employee's payroll line as `commission_amount`
3. Include commission in `gross_pay` calculation
4. Auto-mark included commission_earnings as `status = 'approved'` (if pending) during generation
5. The `GET /api/hr/payroll-export` endpoint already returns payroll lines — commission will flow through automatically

**Do NOT remove the existing inline commission calculation** — it serves as a fallback when employees don't have formal commission plans. The new path takes priority when `commission_earnings` records exist.

### Task 2.4: Commission Reversal on Void/Return (was 2.3)

**Files:**
- Modify: `backend/routes/sales.js` (void handler)
- Modify: `backend/routes/returns.js` (return handler)

**Implementation guidance:**

In the void handler (after marking `voided = TRUE`):
```javascript
// Reverse any pending/approved commissions
await db.query(
  `UPDATE commission_earnings SET status = 'reversed', reversed_at = NOW(), reversal_reason = 'Sale voided'
   WHERE sale_id = $1 AND status IN ('pending','approved')`,
  [saleId]
);
```

In the return handler (after creating the return record):
```javascript
// Partially reverse commission proportional to refund amount
// This is a design choice — flag for user decision
```

### Task 2.5: Commissions Frontend — Commission Plans Page

**Files:**
- Create: `frontend/src/pages/redesign/CommissionPlansRedesign.jsx`
- Create: `frontend/src/pages/CommissionPlansRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

**Implementation guidance:**

The Commission Plans page should have:

1. **Plans list**: table showing name, type, active/inactive, assigned employee count, date range
2. **Create/Edit plan modal**:
   - Name, description, type dropdown (percentage/fixed_per_sale/fixed_per_item/tiered)
   - Date range picker (starts_at, ends_at) — optional
   - Rules builder: scope type dropdown, scope picker (category/product/brand), rate input, threshold, cap
   - Add/remove rule buttons
3. **Assign employees modal**: multi-select employee list with current plan displayed
4. **Earnings tab**: filterable table of commission earnings with status badges and bulk approve/pay actions

**Nav entry**: HR group, `{ name: "Commissions", path: "/commissions", icon: Percent, requiredPerm: "all_access", requiredFlag: "phase2_commissions" }`

**Breadcrumb**: `"commissions": "Commissions"`

### Task 2.6: Commissions Report Tab

**Files:**
- Create: `frontend/src/pages/reports/ReportsCommissions.jsx`
- Modify: `frontend/src/pages/Reports.jsx` (register tab)

**Implementation guidance:**

Add a "Commission Summary" report tab in the HR report group. This tab should:
1. Date range filter, employee filter, status filter
2. Summary cards: total pending, total approved, total paid
3. Table: employee name, plan name, sale count, total sales, total commission, status breakdown
4. CSV export using `downloadCsv()`
5. Backend data comes from `GET /api/commissions/earnings` with aggregation

### Task 2.7: Commit Workstream 2

```bash
git add backend/routes/commissions.js backend/schemas/commissions.js backend/routes/registerAllRoutes.js backend/routes/sales.js backend/routes/returns.js frontend/src/pages/redesign/CommissionPlansRedesign.jsx frontend/src/pages/CommissionPlansRoute.jsx frontend/src/pages/reports/ReportsCommissions.jsx frontend/src/pages/Reports.jsx frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js frontend/src/ui/Breadcrumbs.jsx
git commit -m "feat(phase2b): add commission plans, rules, and earnings tied to payroll"
```

---

## Workstream 3: Report Builder, Smart Grid & Item Suggestions

### Task 3.1: Custom Report Builder Backend

**Files:**
- Create: `backend/routes/report-builder.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new route)

**Step 1: Create route handler**

Create `backend/routes/report-builder.js`:

```javascript
module.exports = function registerReportBuilderRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature } = deps;
  const feat = requireFeature("phase2_report_builder");

  // Available datasets — curated, not arbitrary SQL
  const DATASETS = {
    sales_summary: {
      label: "Sales Summary",
      dimensions: ["date", "outlet", "employee", "payment_method", "customer"],
      measures: ["total_amount", "discount_amount", "sale_count", "item_count", "avg_bill"],
      base_table: "sales",
    },
    product_performance: {
      label: "Product Performance",
      dimensions: ["product", "category", "brand", "outlet", "date"],
      measures: ["quantity_sold", "revenue", "cost", "margin", "margin_percent"],
      base_table: "sale_items",
    },
    inventory_snapshot: {
      label: "Inventory Snapshot",
      dimensions: ["product", "category", "brand", "outlet"],
      measures: ["stock_on_hand", "stock_value", "reorder_point", "days_of_supply"],
      base_table: "products",
    },
    customer_analysis: {
      label: "Customer Analysis",
      dimensions: ["customer", "customer_group", "date", "outlet"],
      measures: ["total_spent", "visit_count", "avg_order_value", "points_balance"],
      base_table: "customers",
    },
    employee_performance: {
      label: "Employee Performance",
      dimensions: ["employee", "outlet", "date", "role"],
      measures: ["sale_count", "total_revenue", "avg_bill", "items_sold", "discount_given", "commission_earned"],
      base_table: "sales",
    },
  };

  // Build SQL from dataset + dimensions + measures + filters
  function buildQuery(dataset, dimensions, measures, filters, sortBy, sortOrder) {
    const ds = DATASETS[dataset];
    if (!ds) throw new Error("Unknown dataset");

    // Validate requested dimensions/measures are in the allowed set
    for (const d of dimensions) {
      if (!ds.dimensions.includes(d)) throw new Error(`Invalid dimension: ${d}`);
    }
    for (const m of measures) {
      if (!ds.measures.includes(m)) throw new Error(`Invalid measure: ${m}`);
    }

    // Build query based on dataset
    let selectCols = [];
    let groupCols = [];
    let joins = [];
    let whereConditions = ["1=1"];
    const params = [];
    let idx = 1;

    // --- Dimension column mapping ---
    const dimMap = {
      date: { col: "s.timestamp::date", alias: "date", group: "s.timestamp::date" },
      outlet: { col: "o.name", alias: "outlet", join: "JOIN outlets o ON o.id = s.outlet_id", group: "o.name" },
      employee: { col: "e.name", alias: "employee", join: "JOIN employees e ON e.id = s.employee_id", group: "e.name" },
      payment_method: { col: "s.payment_method", alias: "payment_method", group: "s.payment_method" },
      customer: { col: "c.name", alias: "customer", join: "LEFT JOIN customers c ON c.id = s.customer_id", group: "c.name" },
      product: { col: "p.name", alias: "product", join: "JOIN products p ON p.id = si.product_id", group: "p.name" },
      category: { col: "cat.name", alias: "category", join: "LEFT JOIN categories cat ON cat.id = p.category_id", group: "cat.name" },
      brand: { col: "b.name", alias: "brand", join: "LEFT JOIN brands b ON b.id = p.brand_id", group: "b.name" },
      customer_group: { col: "cg.name", alias: "customer_group", join: "LEFT JOIN customer_groups cg ON cg.id = c.group_id", group: "cg.name" },
      role: { col: "e.role", alias: "role", group: "e.role" },
    };

    // --- Measure column mapping ---
    const measureMap = {
      total_amount: "SUM(s.total_amount)",
      discount_amount: "SUM(s.discount_amount)",
      sale_count: "COUNT(DISTINCT s.id)",
      item_count: "SUM(si.quantity)",
      avg_bill: "ROUND(AVG(s.total_amount)::numeric, 2)",
      quantity_sold: "SUM(si.quantity)",
      revenue: "SUM(si.price_at_sale * si.quantity)",
      cost: "SUM(si.cost_price_at_sale * si.quantity)",
      margin: "SUM((si.price_at_sale - si.cost_price_at_sale) * si.quantity)",
      margin_percent: "ROUND(CASE WHEN SUM(si.price_at_sale * si.quantity) = 0 THEN 0 ELSE SUM((si.price_at_sale - si.cost_price_at_sale) * si.quantity) * 100.0 / SUM(si.price_at_sale * si.quantity) END::numeric, 2)",
      total_spent: "SUM(s.total_amount)",
      visit_count: "COUNT(DISTINCT s.id)",
      avg_order_value: "ROUND(AVG(s.total_amount)::numeric, 2)",
      points_balance: "SUM(c.loyalty_points)",
      stock_on_hand: "SUM(p.stock)",
      stock_value: "SUM(p.stock * p.cost_price)",
      reorder_point: "SUM(p.min_qty)",
      days_of_supply: "0", // placeholder
      items_sold: "SUM(si.quantity)",
      discount_given: "SUM(s.discount_amount)",
      commission_earned: "COALESCE(SUM(ce.commission_amount), 0)",
    };

    // Add dimensions
    const joinSet = new Set();
    for (const d of dimensions) {
      const dm = dimMap[d];
      if (!dm) continue;
      selectCols.push(`${dm.col} AS ${dm.alias}`);
      groupCols.push(dm.group);
      if (dm.join) joinSet.add(dm.join);
    }

    // Add measures
    for (const m of measures) {
      const expr = measureMap[m];
      if (!expr) continue;
      selectCols.push(`${expr} AS ${m}`);
    }

    // Need sale_items join for product-level measures
    if (measures.some(m => ["quantity_sold", "revenue", "cost", "margin", "margin_percent", "item_count", "items_sold"].includes(m))) {
      if (ds.base_table === "sales") joinSet.add("JOIN sale_items si ON si.sale_id = s.id");
    }
    if (measures.includes("commission_earned")) {
      joinSet.add("LEFT JOIN commission_earnings ce ON ce.sale_id = s.id AND ce.status != 'reversed'");
    }

    // Base FROM
    let fromClause;
    if (ds.base_table === "sales") {
      fromClause = "sales s";
      whereConditions.push("s.voided = FALSE");
    } else if (ds.base_table === "sale_items") {
      fromClause = "sale_items si JOIN sales s ON s.id = si.sale_id";
      whereConditions.push("s.voided = FALSE");
    } else if (ds.base_table === "products") {
      fromClause = "products p";
      whereConditions.push("p.deleted_at IS NULL");
    } else if (ds.base_table === "customers") {
      fromClause = "customers c JOIN sales s ON s.customer_id = c.id";
      whereConditions.push("s.voided = FALSE");
    }

    // Apply filters
    if (filters) {
      const parsed = typeof filters === "string" ? JSON.parse(filters) : filters;
      if (parsed.from) { whereConditions.push(`s.timestamp >= $${idx}`); params.push(parsed.from); idx++; }
      if (parsed.to) { whereConditions.push(`s.timestamp < $${idx}`); params.push(parsed.to); idx++; }
      if (parsed.outlet_id) { whereConditions.push(`s.outlet_id = $${idx}`); params.push(parsed.outlet_id); idx++; }
      if (parsed.employee_id) { whereConditions.push(`s.employee_id = $${idx}`); params.push(parsed.employee_id); idx++; }
    }

    const orderCol = sortBy && [...dimensions, ...measures].includes(sortBy) ? sortBy : measures[0] || dimensions[0];
    const orderDir = sortOrder === "asc" ? "ASC" : "DESC";

    const sql = `
      SELECT ${selectCols.join(", ")}
      FROM ${fromClause}
      ${[...joinSet].join("\n")}
      WHERE ${whereConditions.join(" AND ")}
      ${groupCols.length ? "GROUP BY " + groupCols.join(", ") : ""}
      ORDER BY ${orderCol} ${orderDir}
      LIMIT 1000
    `;

    return { sql, params };
  }

  // GET /api/reports/builder/datasets
  app.get("/api/reports/builder/datasets", feat, requireAnyPerm(["all_access", "view_reports"]), (req, res) => {
    const datasets = Object.entries(DATASETS).map(([key, val]) => ({
      key,
      label: val.label,
      dimensions: val.dimensions,
      measures: val.measures,
    }));
    res.json({ datasets });
  });

  // POST /api/reports/builder/run
  // Body: { dataset, dimensions, measures, filters, sort_by, sort_order }
  app.post("/api/reports/builder/run", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    const { dataset, dimensions, measures, filters, sort_by, sort_order } = req.body;
    if (!dataset || !dimensions?.length || !measures?.length) {
      return res.status(400).json({ error: "dataset, dimensions, and measures are required" });
    }
    try {
      const { sql, params } = buildQuery(dataset, dimensions, measures, filters, sort_by, sort_order);
      const { rows } = await db.query(sql, params);
      res.json({ rows, count: rows.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/reports/builder/definitions
  app.get("/api/reports/builder/definitions", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT crd.*, e.name AS created_by_name
         FROM custom_report_definitions crd
         LEFT JOIN employees e ON e.id = crd.created_by
         WHERE crd.is_shared = TRUE OR crd.created_by = $1
         ORDER BY crd.updated_at DESC`,
        [req.employee?.id]
      );
      res.json({ definitions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reports/builder/definitions
  app.post("/api/reports/builder/definitions", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    const { name, description, dataset, dimensions, measures, filters_json, sort_by, sort_order, is_shared } = req.body;
    if (!name || !dataset || !dimensions?.length || !measures?.length) {
      return res.status(400).json({ error: "name, dataset, dimensions, and measures are required" });
    }
    try {
      const { rows } = await db.query(
        `INSERT INTO custom_report_definitions
         (name, description, dataset, dimensions, measures, filters_json, sort_by, sort_order, created_by, is_shared)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [name, description || null, dataset, dimensions, measures,
         filters_json ? JSON.stringify(filters_json) : "{}", sort_by || null,
         sort_order || "desc", req.employee?.id, is_shared === true]
      );
      res.status(201).json({ definition: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/reports/builder/definitions/:id
  app.put("/api/reports/builder/definitions/:id", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    const { name, description, dimensions, measures, filters_json, sort_by, sort_order, is_shared } = req.body;
    try {
      const { rows: existing } = await db.query("SELECT * FROM custom_report_definitions WHERE id = $1", [req.params.id]);
      if (!existing.length) return res.status(404).json({ error: "Definition not found" });
      // Only creator or admin can edit
      if (existing[0].created_by !== req.employee?.id && !req.permissions?.includes("all_access")) {
        return res.status(403).json({ error: "Not authorized to edit this definition" });
      }

      const sets = [];
      const vals = [];
      let idx = 1;
      if (name !== undefined) { sets.push(`name = $${idx}`); vals.push(name); idx++; }
      if (description !== undefined) { sets.push(`description = $${idx}`); vals.push(description); idx++; }
      if (dimensions !== undefined) { sets.push(`dimensions = $${idx}`); vals.push(dimensions); idx++; }
      if (measures !== undefined) { sets.push(`measures = $${idx}`); vals.push(measures); idx++; }
      if (filters_json !== undefined) { sets.push(`filters_json = $${idx}`); vals.push(JSON.stringify(filters_json)); idx++; }
      if (sort_by !== undefined) { sets.push(`sort_by = $${idx}`); vals.push(sort_by); idx++; }
      if (sort_order !== undefined) { sets.push(`sort_order = $${idx}`); vals.push(sort_order); idx++; }
      if (is_shared !== undefined) { sets.push(`is_shared = $${idx}`); vals.push(is_shared); idx++; }
      sets.push(`updated_at = NOW()`);

      vals.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE custom_report_definitions SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
      );
      res.json({ definition: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/reports/builder/definitions/:id
  app.delete("/api/reports/builder/definitions/:id", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM custom_report_definitions WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Definition not found" });
      if (rows[0].created_by !== req.employee?.id && !req.permissions?.includes("all_access")) {
        return res.status(403).json({ error: "Not authorized to delete this definition" });
      }
      await db.query("DELETE FROM custom_report_definitions WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reports/builder/definitions/:id/schedule — create a governance schedule from a saved definition
  // Bridges the builder to the existing report_schedules system
  app.post("/api/reports/builder/definitions/:id/schedule", feat, requirePerm("all_access"), async (req, res) => {
    const { frequency, run_hour, run_minute, timezone, recipient, export_format } = req.body;
    if (!frequency || !recipient) return res.status(400).json({ error: "frequency and recipient required" });
    try {
      const { rows: defRows } = await db.query("SELECT * FROM custom_report_definitions WHERE id = $1", [req.params.id]);
      if (!defRows.length) return res.status(404).json({ error: "Definition not found" });
      const def = defRows[0];

      // Create a report_schedule with report_key = "builder:<id>"
      const { rows } = await db.query(
        `INSERT INTO report_schedules
         (name, report_key, frequency, run_hour, run_minute, timezone, recipient, export_format, filters_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          `Custom: ${def.name}`, `builder:${def.id}`, frequency,
          run_hour || 8, run_minute || 0, timezone || "UTC",
          recipient, export_format || "csv", def.filters_json,
          req.employee?.id
        ]
      );
      res.status(201).json({ schedule: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 2: Mount in registerAllRoutes.js**

```javascript
  // --- ROUTES: REPORT BUILDER (Phase 2B) ---
  require("./report-builder")(app, deps);
```

### Task 3.2: POS Layouts Backend

**Files:**
- Create: `backend/routes/pos-layouts.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new route)

**Step 1: Create route handler**

Create `backend/routes/pos-layouts.js`:

```javascript
module.exports = function registerPOSLayoutRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_pos_layouts");

  // GET /api/pos-layouts — returns the best matching layout for current context
  app.get("/api/pos-layouts", feat, async (req, res) => {
    const { outlet_id, role_id, employee_id } = req.query;
    try {
      // Priority: employee > role > outlet > global
      const { rows } = await db.query(
        `SELECT * FROM pos_layouts
         WHERE is_active = TRUE
         ORDER BY
           CASE scope_type
             WHEN 'employee' THEN 1
             WHEN 'role' THEN 2
             WHEN 'outlet' THEN 3
             WHEN 'global' THEN 4
           END,
           id DESC`
      );

      // Find best match
      let layout = null;
      for (const row of rows) {
        if (row.scope_type === "employee" && row.scope_id === Number(employee_id)) { layout = row; break; }
        if (row.scope_type === "role" && row.scope_id === Number(role_id)) { layout = row; break; }
        if (row.scope_type === "outlet" && row.scope_id === Number(outlet_id)) { layout = row; break; }
        if (row.scope_type === "global") { layout = row; break; }
      }

      res.json({ layout: layout ? { ...layout, layout_json: JSON.parse(layout.layout_json) } : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/pos-layouts/all — admin list of all layouts
  app.get("/api/pos-layouts/all", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT pl.*, e.name AS created_by_name
         FROM pos_layouts pl
         LEFT JOIN employees e ON e.id = pl.created_by
         ORDER BY pl.scope_type, pl.name`
      );
      res.json({ layouts: rows.map(r => ({ ...r, layout_json: JSON.parse(r.layout_json) })) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/pos-layouts
  app.post("/api/pos-layouts", feat, requirePerm("all_access"), async (req, res) => {
    const { name, scope_type, scope_id, layout_json } = req.body;
    if (!name || !layout_json) return res.status(400).json({ error: "name and layout_json required" });
    try {
      const { rows } = await db.query(
        `INSERT INTO pos_layouts (name, scope_type, scope_id, layout_json, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, scope_type || "global", scope_id || null, JSON.stringify(layout_json), req.employee?.id]
      );
      res.status(201).json({ layout: { ...rows[0], layout_json: JSON.parse(rows[0].layout_json) } });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "Layout already exists for this scope" });
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/pos-layouts/:id
  app.put("/api/pos-layouts/:id", feat, requirePerm("all_access"), async (req, res) => {
    const { name, layout_json, is_active } = req.body;
    try {
      const sets = [];
      const vals = [];
      let idx = 1;
      if (name !== undefined) { sets.push(`name = $${idx}`); vals.push(name); idx++; }
      if (layout_json !== undefined) { sets.push(`layout_json = $${idx}`); vals.push(JSON.stringify(layout_json)); idx++; }
      if (is_active !== undefined) { sets.push(`is_active = $${idx}`); vals.push(is_active); idx++; }
      sets.push(`updated_at = NOW()`);

      vals.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE pos_layouts SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
      );
      if (!rows.length) return res.status(404).json({ error: "Layout not found" });
      res.json({ layout: { ...rows[0], layout_json: JSON.parse(rows[0].layout_json) } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/pos-layouts/:id
  app.delete("/api/pos-layouts/:id", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM pos_layouts WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Layout not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 2: Mount in registerAllRoutes.js**

```javascript
  // --- ROUTES: POS LAYOUTS (Phase 2B) ---
  require("./pos-layouts")(app, deps);
```

### Task 3.3: Item Suggestions Backend

**Files:**
- Create: `backend/routes/item-suggestions.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new route)

**Step 1: Create route handler**

Create `backend/routes/item-suggestions.js`:

```javascript
module.exports = function registerItemSuggestionRoutes(app, deps) {
  const { db, requireFeature } = deps;
  const feat = requireFeature("phase2_item_suggestions");

  // GET /api/pos/suggestions?product_ids=1,2,3
  // Deterministic: manual affinities first, then co-purchase frequency
  app.get("/api/pos/suggestions", feat, async (req, res) => {
    const { product_ids } = req.query;
    if (!product_ids) return res.json({ suggestions: [] });

    const ids = product_ids.split(",").map(Number).filter(Boolean);
    if (!ids.length) return res.json({ suggestions: [] });

    try {
      // 1. Manual affinities (highest priority)
      const { rows: manualRows } = await db.query(
        `SELECT DISTINCT pa.target_product_id AS product_id, pa.affinity_type, pa.score,
                p.name, p.price, p.image_url, p.barcode, 'manual' AS source
         FROM product_affinities pa
         JOIN products p ON p.id = pa.target_product_id
         WHERE pa.source_product_id = ANY($1)
           AND pa.target_product_id != ALL($1)
           AND p.deleted_at IS NULL AND p.status = 'active'
         ORDER BY pa.score DESC
         LIMIT 10`,
        [ids]
      );

      // 2. Co-purchase frequency (deterministic, from historical sales)
      const { rows: coPurchaseRows } = await db.query(
        `SELECT si2.product_id, COUNT(*) AS frequency,
                p.name, p.price, p.image_url, p.barcode, 'co_purchase' AS source
         FROM sale_items si1
         JOIN sale_items si2 ON si2.sale_id = si1.sale_id AND si2.product_id != si1.product_id
         JOIN products p ON p.id = si2.product_id
         WHERE si1.product_id = ANY($1)
           AND si2.product_id != ALL($1)
           AND p.deleted_at IS NULL AND p.status = 'active'
         GROUP BY si2.product_id, p.name, p.price, p.image_url, p.barcode
         ORDER BY frequency DESC
         LIMIT 10`,
        [ids]
      );

      // Deduplicate: manual affinities take priority
      const seen = new Set(manualRows.map(r => r.product_id));
      const merged = [...manualRows];
      for (const row of coPurchaseRows) {
        if (!seen.has(row.product_id)) {
          seen.add(row.product_id);
          merged.push({ ...row, score: Number(row.frequency) });
        }
      }

      res.json({ suggestions: merged.slice(0, 8) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Product Affinities CRUD (admin) ────────────────────────────────

  // GET /api/product-affinities?product_id=X
  app.get("/api/product-affinities", feat, async (req, res) => {
    const { product_id } = req.query;
    try {
      let where = "1=1";
      const params = [];
      if (product_id) { where = "pa.source_product_id = $1"; params.push(product_id); }

      const { rows } = await db.query(
        `SELECT pa.*, ps.name AS source_name, pt.name AS target_name
         FROM product_affinities pa
         JOIN products ps ON ps.id = pa.source_product_id
         JOIN products pt ON pt.id = pa.target_product_id
         WHERE ${where}
         ORDER BY pa.score DESC`,
        params
      );
      res.json({ affinities: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/product-affinities
  app.post("/api/product-affinities", feat, deps.requirePerm("all_access"), async (req, res) => {
    const { source_product_id, target_product_id, affinity_type, score } = req.body;
    if (!source_product_id || !target_product_id) {
      return res.status(400).json({ error: "source_product_id and target_product_id required" });
    }
    if (source_product_id === target_product_id) {
      return res.status(400).json({ error: "Source and target must be different products" });
    }
    try {
      const { rows } = await db.query(
        `INSERT INTO product_affinities (source_product_id, target_product_id, affinity_type, score, is_manual)
         VALUES ($1,$2,$3,$4,TRUE)
         ON CONFLICT (source_product_id, target_product_id, affinity_type) DO UPDATE SET
           score = $4
         RETURNING *`,
        [source_product_id, target_product_id, affinity_type || "frequently_bought_together", score || 1.0]
      );
      res.status(201).json({ affinity: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/product-affinities/:id
  app.delete("/api/product-affinities/:id", feat, deps.requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM product_affinities WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Affinity not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/product-affinities/regenerate — rebuild affinities from sales history
  app.post("/api/product-affinities/regenerate", feat, deps.requirePerm("all_access"), async (req, res) => {
    try {
      // Delete auto-generated affinities
      await db.query("DELETE FROM product_affinities WHERE is_manual = FALSE");

      // Rebuild from co-purchase data (last 90 days)
      const { rowCount } = await db.query(`
        INSERT INTO product_affinities (source_product_id, target_product_id, affinity_type, score, is_manual)
        SELECT si1.product_id, si2.product_id, 'frequently_bought_together',
               COUNT(*)::numeric / 10.0, FALSE
        FROM sale_items si1
        JOIN sale_items si2 ON si2.sale_id = si1.sale_id AND si2.product_id > si1.product_id
        JOIN sales s ON s.id = si1.sale_id
        WHERE s.voided = FALSE AND s.timestamp >= NOW() - INTERVAL '90 days'
        GROUP BY si1.product_id, si2.product_id
        HAVING COUNT(*) >= 3
        ORDER BY COUNT(*) DESC
        LIMIT 500
        ON CONFLICT (source_product_id, target_product_id, affinity_type) DO UPDATE SET
          score = EXCLUDED.score
      `);

      res.json({ success: true, affinities_created: rowCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 2: Mount in registerAllRoutes.js**

```javascript
  // --- ROUTES: ITEM SUGGESTIONS (Phase 2B) ---
  require("./item-suggestions")(app, deps);
```

### Task 3.4: Report Builder Frontend

**Files:**
- Create: `frontend/src/pages/redesign/ReportBuilderRedesign.jsx`
- Create: `frontend/src/pages/ReportBuilderRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

**Implementation guidance:**

The Report Builder page is the most complex frontend piece in Phase 2B. It should have:

1. **Dataset picker**: cards or dropdown showing the 5 available datasets with descriptions
2. **Builder panel** (once dataset selected):
   - Dimension checkboxes (from dataset's allowed dimensions)
   - Measure checkboxes (from dataset's allowed measures)
   - Filter builder: date range, outlet, employee (contextual to dataset)
   - Sort selector: pick any selected dimension or measure
3. **Preview area**: run query and show results in a table
4. **Actions**:
   - "Run" button → `POST /api/reports/builder/run`
   - "Save" button → saves definition via `POST /api/reports/builder/definitions`
   - "Export CSV" → uses `downloadCsv()` from `utils/csvExport.js`
   - "Schedule" → links to existing governance schedule creation (pre-fill report_key)
5. **Saved definitions panel**: sidebar or tab showing saved report definitions with load/delete

**Key UX decisions for the implementer:**
- Keep the builder constrained — no free-text SQL, no custom joins
- Show a "Preview" of first 10 rows before full run
- Use column header clicks for sort toggle

**Nav entry**: Reports group, `{ name: "Report Builder", path: "/report-builder", icon: BarChart2, requiredPerm: "view_reports", requiredFlag: "phase2_report_builder" }`

**Breadcrumb**: `"report-builder": "Report Builder"`

### Task 3.5: POS Layouts Frontend — Layout Editor Page

**Files:**
- Create: `frontend/src/pages/redesign/POSLayoutsRedesign.jsx`
- Create: `frontend/src/pages/POSLayoutsRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

**Implementation guidance:**

The POS Layout editor should:

1. **Layout list**: table of all layouts with scope (global/outlet/role/employee), active status, edit/delete
2. **Layout editor** (visual grid):
   - Use a grid system (e.g., CSS Grid or a simple drag system — no need for react-grid-layout dependency unless complex)
   - Tiles can be: product shortcut (linked to a product_id), category shortcut, action button (park, discount, customer search)
   - Each tile: icon/image, label, color, size (1x1 or 2x1), action type + action data
   - Save as JSON array in `layout_json`
3. **Scope selector**: dropdown to pick global, specific outlet, specific role, specific employee
4. **Preview mode**: render the layout as it would appear in POS

**Layout JSON structure:**
```json
[
  { "id": "tile-1", "type": "product", "product_id": 42, "label": "Coffee", "color": "#3B82F6", "size": "1x1", "position": { "row": 0, "col": 0 } },
  { "id": "tile-2", "type": "category", "category_id": 5, "label": "Drinks", "color": "#10B981", "size": "2x1", "position": { "row": 0, "col": 1 } },
  { "id": "tile-3", "type": "action", "action": "park_sale", "label": "Park", "color": "#F59E0B", "size": "1x1", "position": { "row": 1, "col": 0 } }
]
```

**Nav entry**: Settings group, `{ name: "POS Layouts", path: "/settings/pos-layouts", icon: LayoutGrid, requiredPerm: "all_access", requiredFlag: "phase2_pos_layouts" }`

### Task 3.6: POS Integration — Layout Tiles and Suggestions

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx` (add layout + suggestions state)
- Modify: `frontend/src/pages/redesign/POSRedesign.jsx` (render tiles + suggestion bar)

**Implementation guidance:**

In `POSContext.jsx`:
1. Add state: `posLayout` (fetched from `GET /api/pos-layouts`), `suggestions` (fetched from `GET /api/pos/suggestions`)
2. Fetch layout once on mount (pass outlet_id, role_id, employee_id from context)
3. Fetch suggestions whenever cart items change (debounce 500ms)
4. Export: `posLayout`, `suggestions`, `refreshSuggestions()`

In `POSRedesign.jsx`:
1. If `posLayout` exists, render a tile grid above or beside the product search
2. Each tile: clickable, adds product to cart or navigates to category
3. Below the cart or at checkout, show a horizontal suggestion bar (max 4 items)
4. Each suggestion: small card with product name, price, "Add" button
5. Feature-gated: only render tiles if `phase2_pos_layouts` flag is on, suggestions if `phase2_item_suggestions` is on

### Task 3.7: Commit Workstream 3

```bash
git add backend/routes/report-builder.js backend/routes/pos-layouts.js backend/routes/item-suggestions.js backend/routes/registerAllRoutes.js frontend/src/pages/redesign/ReportBuilderRedesign.jsx frontend/src/pages/ReportBuilderRoute.jsx frontend/src/pages/redesign/POSLayoutsRedesign.jsx frontend/src/pages/POSLayoutsRoute.jsx frontend/src/pages/redesign/pos/POSContext.jsx frontend/src/pages/redesign/POSRedesign.jsx frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js frontend/src/ui/Breadcrumbs.jsx
git commit -m "feat(phase2b): add custom report builder, configurable POS tile layouts, item suggestions"
```

---

## Task 4: Governance Runner Hook for Builder Reports

**Files:**
- Modify: `backend/routes/reports/governance.js` (add `builder:*` report_key handling)

**Implementation guidance:**

The existing `getRowsForScheduleReport(reportKey, filters)` function in governance.js handles known report keys ("profit-by-product", "stock-aging", etc.). Add a handler for `builder:*` keys:

```javascript
// Inside getRowsForScheduleReport or runSingleSchedule:
if (reportKey.startsWith("builder:")) {
  const defId = parseInt(reportKey.split(":")[1], 10);
  const { rows: defRows } = await db.query("SELECT * FROM custom_report_definitions WHERE id = $1", [defId]);
  if (!defRows.length) throw new Error(`Builder definition ${defId} not found`);
  const def = defRows[0];

  // Re-use the report-builder's buildQuery function
  const { buildQuery } = require("./report-builder"); // Export buildQuery from the module
  const { sql, params } = buildQuery(def.dataset, def.dimensions, def.measures, def.filters_json, def.sort_by, def.sort_order);
  const { rows } = await db.query(sql, params);
  return { columns: [...def.dimensions, ...def.measures], rows };
}
```

**Note:** This requires exporting `buildQuery` from `report-builder.js`. Refactor to make it a standalone function that can be imported, or extract it into a shared module like `backend/services/report-query-builder.js`.

---

## Task 5: Testing

### Task 5.1: Unit Tests

**Files:**
- Create: `backend/tests/unit/smart-collections.test.js`
- Create: `backend/tests/unit/commissions.test.js`
- Create: `backend/tests/unit/report-builder.test.js`

**Tests to write (from implementation plan Section 8):**

1. **Smart collection rule matching** — test `buildRuleQuery()` with various field/operator/value combinations, disjunctive vs conjunctive mode
2. **Scheduled catalog activation logic** — test that pending changes with `scheduled_at <= NOW()` are picked up and applied
3. **Commission calculations** — test percentage, fixed_per_sale, fixed_per_item, tiered types; threshold filtering; max_cap enforcement; reversal on void
4. **Item-affinity ranking** — test that manual affinities rank above co-purchase, deduplication works
5. **Report-builder dataset validation** — test that invalid dimensions/measures are rejected, SQL injection via field names is prevented

### Task 5.2: Integration Tests

**Files:**
- Create: `backend/tests/integration/pg-phase2b-catalog.test.js`
- Create: `backend/tests/integration/pg-phase2b-commissions.test.js`
- Create: `backend/tests/integration/pg-phase2b-reports.test.js`

**Tests to write:**

1. **Outlet visibility + tax profile resolution** — create product, set outlet visibility to hidden, verify POS product list excludes it; set outlet tax profile, verify tax resolution endpoint returns outlet override
2. **Smart collection CRUD + evaluation** — create collection with rules, verify matched products; update rules, verify match changes; toggle disjunctive, verify AND vs OR behavior
3. **Scheduled catalog change lifecycle** — create pending change, advance time (or directly apply), verify product field updated
4. **Commission plan assign + calculate** — create plan, assign to employee, create sale, verify commission_earnings row created with correct amount
5. **Commission reversal on void** — void a sale, verify commission_earnings status = 'reversed'
6. **Custom report save, run, schedule** — save definition, run it, verify results match direct query; create schedule via `/definitions/:id/schedule`, verify report_schedules row created
7. **POS layout CRUD + priority resolution** — create global layout, create outlet-specific layout, verify GET returns outlet layout (higher priority)
8. **Product affinity suggestions** — create manual affinity, call `/api/pos/suggestions`, verify manual appears first

### Task 5.3: Frontend Tests

**Files:**
- Add test cases to: `frontend/tests/unit/` (vitest)

**Tests to write:**

1. **Smart grid layout persistence** — mock API, render POSLayoutsRedesign, verify layout saves and restores
2. **Item suggestions rendering** — mock suggestions API, verify suggestion bar renders in POS
3. **Report builder save and export** — mock datasets API, select dimensions/measures, verify run produces table, verify CSV export triggers download

### Task 5.4: Commit Tests

```bash
git add backend/tests/ frontend/tests/
git commit -m "test(phase2b): add unit and integration tests for catalog, commissions, reports, POS layouts"
```

---

## Cross-Cutting Verification

After all workstreams are committed, verify:

1. **Migration applies cleanly**: `node backend/migrate-pg.js` — no errors
2. **Server starts**: `node backend/index.js` — no require/import errors
3. **Frontend builds**: `cd frontend && npm run build` — no compile errors
4. **Feature flags gate everything**: with all `phase2_*` flags OFF, no Phase 2B routes or UI should be accessible
5. **No regressions**: existing Phase 2A routes still work (spot-check `/api/draft-orders`, `/api/return-policies`, `/api/schedules`)
6. **Price resolution still works**: verify `GET /api/price-resolve?product_id=X&outlet_id=Y` returns correct prices through the existing `resolvePriceForContext()` chain
7. **Payroll includes commissions**: verify `POST /api/hr/payroll/periods/:id/generate` picks up `commission_earnings` for the period

---

## Summary

| Workstream | New Route Files | New Frontend Pages | New Tables | Feature Flags |
|---|---|---|---|---|
| 0: Foundations | — | — | 11 tables + 1 column | 8 flags |
| 1: Catalog Depth | 4 (smart-collections, outlet-visibility, outlet-tax-profiles, scheduled-changes) | 3 pages + 1 tab | smart_collections, smart_collection_rules, outlet_product_visibility, outlet_tax_profiles, outlet_tax_profile_lines, scheduled_catalog_changes | 4 |
| 2: Commissions | 1 (commissions) | 1 page + 1 report tab + payroll integration | commission_plans, commission_plan_rules, commission_earnings + employees.commission_plan_id | 1 |
| 3: Report Builder + POS | 3 (report-builder, pos-layouts, item-suggestions) | 2 pages + POS integration | custom_report_definitions, custom_report_widgets, pos_layouts, product_affinities | 3 |
| 4: Governance Hook | — (modify governance.js) | — | — | — |
| 5: Testing | — | — | — | — |

**Total: 8 new route files, 6 new pages, 11 new tables, 8 feature flags, 5 commits.**

## Existing Services Touched (not new, modified only)

| File | Change |
|---|---|
| `backend/services/quote.js` | No changes needed — existing `resolvePriceForContext()` already handles the resolution chain |
| `backend/routes/tier4/hr.js` | Wire `commission_earnings` into payroll generation |
| `backend/routes/reports/governance.js` | Add `builder:*` report_key handler for scheduled builder reports |
| `backend/routes/sales.js` | Add commission auto-calculation hook + reversal on void |
| `backend/routes/returns.js` | Add commission reversal on return |

## Done Criteria (from design doc)

Phase 2B is complete when:

1. **Outlet visibility** — a product can be hidden at specific outlets without deleting it globally
2. **Outlet tax resolution** — tax profiles resolve deterministically per outlet, with fallback to product/category default
3. **Smart collections** — rule-based collections evaluate correctly (AND/OR mode), matched products update dynamically
4. **Scheduled catalog changes** — pending changes activate automatically at the scheduled time
5. **Commission plans** — plans can be defined, assigned to employees, and auto-calculated on sale finalization
6. **Commission-to-payroll** — payroll generation includes commission earnings from the new system
7. **Custom report builder** — users can choose dataset, dimensions, measures, filters; save definitions; export CSV; schedule via governance
8. **Smart grid layouts** — POS tile layouts can be configured per outlet/role/employee and rendered in POS
9. **Item suggestions** — deterministic suggestions appear at checkout from manual affinities and co-purchase history
10. **All new surfaces gated** — feature flags OFF = no Phase 2B routes or UI accessible
11. **No regressions** — Phase 2A features, existing reports, POS checkout, and payroll all still work
