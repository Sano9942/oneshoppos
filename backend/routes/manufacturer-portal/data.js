"use strict";

/**
 * Manufacturer portal data endpoints (Tier 1.4).
 *
 * All routes mount AFTER loadManufacturerAuth, which attaches:
 *   - req.manufacturerId
 *   - req.tenant ({ id, slug })
 *   - req.db   (tenant-scoped DB handle)
 *
 *   GET /api/manufacturer-portal/me          — partner profile + assigned brands
 *   GET /api/manufacturer-portal/summary     — dashboard cards (today / 7d / 30d / top SKU)
 *   GET /api/manufacturer-portal/sales       — Brand × SKU × day × region rollup
 *   GET /api/manufacturer-portal/promotions  — scheme-level totals on the partner's brands
 *   GET /api/manufacturer-portal/sales.csv   — CSV export of /sales
 *
 * PRIVACY INVARIANT: no SELECT clause in this file returns any of:
 *   customer_id, customer_name, customer_phone, customer_email, address
 * Retailer identity is the distributor's confidential customer list — exposing
 * it would break the design and the contract with the distributor.
 * The CI/grep check below the route file's bottom enforces this.
 */

const express = require("express");
const { loadManufacturerAuth } = require("../../middleware/manufacturer-auth");
const {
  manufacturerPortalDataLimiter,
} = require("../../middleware/rate-limit");
const { toUtcStart, toUtcEnd } = require("../../utils/tz");

// Fetch tenant timezone for date bucketing. Cached on `req` for the lifetime
// of the request — every handler calls this lazily once.
async function getTenantTimezone(req) {
  if (req._mfgTz) return req._mfgTz;
  try {
    const { rows: [row] } = await req.db.query(
      "SELECT timezone FROM company_profile WHERE id = 1"
    );
    req._mfgTz = row?.timezone || "UTC";
  } catch {
    req._mfgTz = "UTC";
  }
  return req._mfgTz;
}

// Pull the brand_ids the calling partner is allowed to see.
// Empty list => return zero rows from every aggregate (partner has no brands yet).
async function getPartnerBrandIds(req) {
  const { rows } = await req.db.query(
    `SELECT brand_id FROM manufacturer_partner_brands
      WHERE manufacturer_partner_id = $1
      ORDER BY brand_id`,
    [req.manufacturerId]
  );
  return rows.map((r) => Number(r.brand_id));
}

// Compute the local YYYY-MM-DD for "now" in the given IANA tz.
// Bug fix (Day 5): we previously used new Date().getUTCDate(), which returns
// the UTC date — for Asia/Karachi (UTC+5) after 19:00 UTC, that's the
// PREVIOUS local day, which excluded same-day sales from the default window.
function todayInTz(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
}

function shiftDate(yyyymmdd, days) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 24 * 3600 * 1000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// Parse optional ?from=&to= YYYY-MM-DD pair. Defaults to last `defaultDays` days
// counted in the TENANT timezone (not UTC), so the window always includes
// "today" as the tenant sees it.
// Returns { fromUtc, toUtc, fromStr, toStr } where toUtc is EXCLUSIVE.
function parseDateRange(query, tz, defaultDays = 30) {
  const todayLocal = todayInTz(tz);
  const toStr = sanitiseDateStr(query.to) || todayLocal;
  const fromStr = sanitiseDateStr(query.from) || shiftDate(todayLocal, -(defaultDays - 1));
  return {
    fromStr,
    toStr,
    fromUtc: toUtcStart(fromStr, tz),
    toUtc: toUtcEnd(toStr, tz),
  };
}

function sanitiseDateStr(v) {
  if (!v) return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

module.exports = function registerManufacturerPortalData(app, deps) {
  const router = express.Router();

  // Auth + per-partner rate limit for every route below.
  router.use(loadManufacturerAuth(deps));
  router.use(manufacturerPortalDataLimiter);

  // ── GET /me ────────────────────────────────────────────────────────
  // Partner's own profile + brand list (id + name). No financials.
  router.get("/me", async (req, res) => {
    try {
      const { rows: [partner] } = await req.db.query(
        `SELECT id, name, contact_name, email, status,
                last_login_at, email_verified_at, created_at
           FROM manufacturer_partners
          WHERE id = $1`,
        [req.manufacturerId]
      );
      if (!partner) return res.status(404).json({ error: "Partner not found" });

      const { rows: brands } = await req.db.query(
        `SELECT b.id, b.name
           FROM manufacturer_partner_brands mpb
           JOIN brands b ON b.id = mpb.brand_id
          WHERE mpb.manufacturer_partner_id = $1
          ORDER BY b.name`,
        [req.manufacturerId]
      );

      res.json({
        partner: {
          id: partner.id,
          name: partner.name,
          contact_name: partner.contact_name,
          email: partner.email,
          status: partner.status,
          last_login_at: partner.last_login_at,
          created_at: partner.created_at,
        },
        brands,
        tenant: { slug: req.tenant.slug },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /summary ───────────────────────────────────────────────────
  // Dashboard cards: total qty + total gross revenue + total scheme discount
  // for three windows (today, last 7 days, last 30 days), plus top 5 SKUs
  // in the last 30 days by revenue.
  router.get("/summary", async (req, res) => {
    try {
      const brandIds = await getPartnerBrandIds(req);
      if (brandIds.length === 0) {
        return res.json({
          today: { qty: 0, gross_revenue: 0, scheme_discount: 0, sales_count: 0 },
          last_7d: { qty: 0, gross_revenue: 0, scheme_discount: 0, sales_count: 0 },
          last_30d: { qty: 0, gross_revenue: 0, scheme_discount: 0, sales_count: 0 },
          top_skus: [],
        });
      }
      const tz = await getTenantTimezone(req);

      const today = parseDateRange({ from: req.query.today_from || req.query.from, to: req.query.today_to || req.query.to }, tz, 1);
      const last7 = parseDateRange({}, tz, 7);
      const last30 = parseDateRange({}, tz, 30);

      // One query per window — keeps the SQL readable; 3 trips is fine at
      // this scale and the indexes (sales.timestamp, sale_items.product_id,
      // products.brand_id) cover it.
      const windowSql = `
        WITH win AS (
          SELECT s.id AS sale_id
            FROM sales s
           WHERE s.voided = FALSE
             AND s.timestamp >= $1::timestamptz
             AND s.timestamp <  $2::timestamptz
        )
        SELECT
          COALESCE(SUM(si.quantity), 0)::numeric AS qty,
          COALESCE(SUM(si.quantity * si.price_at_sale), 0)::numeric AS gross_revenue,
          COUNT(DISTINCT s.id)::int AS sales_count,
          COALESCE((
            SELECT SUM(spa.discount_value)
              FROM sale_promotion_applications spa
              JOIN win w2 ON w2.sale_id = spa.sale_id
              WHERE EXISTS (
                SELECT 1 FROM sale_items si2
                  JOIN products p2 ON p2.id = si2.product_id
                 WHERE si2.sale_id = spa.sale_id
                   AND p2.brand_id = ANY($3::int[])
              )
          ), 0)::numeric AS scheme_discount
        FROM win w
        JOIN sale_items si ON si.sale_id = w.sale_id
        JOIN products p ON p.id = si.product_id
        JOIN sales s ON s.id = w.sale_id
        WHERE p.brand_id = ANY($3::int[])
      `;

      const [todayRows, last7Rows, last30Rows] = await Promise.all([
        req.db.query(windowSql, [today.fromUtc, today.toUtc, brandIds]),
        req.db.query(windowSql, [last7.fromUtc, last7.toUtc, brandIds]),
        req.db.query(windowSql, [last30.fromUtc, last30.toUtc, brandIds]),
      ]);

      // Top 5 SKUs in last 30d by revenue.
      const { rows: topSkus } = await req.db.query(
        `
        SELECT p.id AS product_id, p.name AS product_name, p.brand_id,
               b.name AS brand_name,
               SUM(si.quantity)::numeric AS qty,
               SUM(si.quantity * si.price_at_sale)::numeric AS gross_revenue
          FROM sale_items si
          JOIN sales s     ON s.id = si.sale_id
          JOIN products p  ON p.id = si.product_id
          LEFT JOIN brands b ON b.id = p.brand_id
         WHERE p.brand_id = ANY($3::int[])
           AND s.voided = FALSE
           AND s.timestamp >= $1::timestamptz
           AND s.timestamp <  $2::timestamptz
         GROUP BY p.id, p.name, p.brand_id, b.name
         ORDER BY gross_revenue DESC
         LIMIT 5
        `,
        [last30.fromUtc, last30.toUtc, brandIds]
      );

      const fmt = (row) => ({
        qty: Number(row?.qty || 0),
        gross_revenue: Number(row?.gross_revenue || 0),
        scheme_discount: Number(row?.scheme_discount || 0),
        sales_count: Number(row?.sales_count || 0),
      });

      res.json({
        today: fmt(todayRows.rows[0]),
        last_7d: fmt(last7Rows.rows[0]),
        last_30d: fmt(last30Rows.rows[0]),
        top_skus: topSkus.map((r) => ({
          product_id: r.product_id,
          product_name: r.product_name,
          brand_id: r.brand_id,
          brand_name: r.brand_name,
          qty: Number(r.qty),
          gross_revenue: Number(r.gross_revenue),
        })),
        window: { from: last30.fromStr, to: last30.toStr, timezone: req._mfgTz },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /sales ─────────────────────────────────────────────────────
  // Brand × SKU × day × region rollup.
  //   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (defaults: last 30d)
  //   ?brand_id=1                     (optional filter, must be in partner's allowlist)
  //   ?region=Karachi                 (optional exact match on customers.city)
  //   ?group_by=day|sku|region|brand  (default: day)
  router.get("/sales", async (req, res) => {
    try {
      const brandIds = await getPartnerBrandIds(req);
      if (brandIds.length === 0) {
        return res.json({ rows: [], window: parseDateRangeMeta(req), group_by: "day" });
      }
      const tz = await getTenantTimezone(req);
      const range = parseDateRange(req.query, tz, 30);

      let scopedBrandIds = brandIds;
      if (req.query.brand_id) {
        const requested = Number(req.query.brand_id);
        if (!brandIds.includes(requested)) {
          return res
            .status(403)
            .json({ error: "Brand not in your allowlist" });
        }
        scopedBrandIds = [requested];
      }

      const region = req.query.region ? String(req.query.region).slice(0, 80) : null;
      const groupBy = ["day", "sku", "region", "brand"].includes(req.query.group_by)
        ? req.query.group_by
        : "day";

      // Build SELECT list + GROUP BY by axis. All axes always include brand
      // for context — the manufacturer might watch multiple brands.
      //
      // Bug fix (Day 5): use TO_CHAR for the date label so it comes back as
      // a 'YYYY-MM-DD' string already in the tenant tz, instead of a JS Date
      // that the pg driver constructs in server TZ (= Asia/Karachi on prod)
      // and then formatDay() reads UTC parts from — that path returned the
      // previous UTC date for any sale in the first 5h of a Karachi day.
      //
      // Params used per axis: only `day` references $4 (tz). The others
      // bind only $1..$3 (fromUtc, toUtc, brand_ids) — including a $4
      // param without a placeholder throws "supplies 4 parameters but
      // prepared statement requires 3" on the pg side.
      const axisSql = {
        day: {
          select: `TO_CHAR(s.timestamp AT TIME ZONE $4, 'YYYY-MM-DD') AS day,
                   p.brand_id, b.name AS brand_name`,
          group: `day, p.brand_id, b.name`,
          order: `day DESC, brand_name`,
          usesTz: true,
        },
        sku: {
          select: `p.id AS product_id, p.name AS product_name,
                   p.brand_id, b.name AS brand_name`,
          group: `p.id, p.name, p.brand_id, b.name`,
          order: `gross_revenue DESC`,
          usesTz: false,
        },
        region: {
          select: `COALESCE(NULLIF(c.city, ''), 'Unspecified') AS region,
                   p.brand_id, b.name AS brand_name`,
          group: `region, p.brand_id, b.name`,
          order: `gross_revenue DESC`,
          usesTz: false,
        },
        brand: {
          select: `p.brand_id, b.name AS brand_name`,
          group: `p.brand_id, b.name`,
          order: `gross_revenue DESC`,
          usesTz: false,
        },
      }[groupBy];

      const params = [range.fromUtc, range.toUtc, scopedBrandIds];
      if (axisSql.usesTz) params.push(tz);
      let whereRegion = "";
      if (region) {
        params.push(region);
        whereRegion = `AND COALESCE(NULLIF(c.city, ''), 'Unspecified') = $${params.length}`;
      }

      const sql = `
        SELECT
          ${axisSql.select},
          SUM(si.quantity)::numeric AS qty,
          SUM(si.quantity * si.price_at_sale)::numeric AS gross_revenue
        FROM sale_items si
        JOIN sales s    ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE p.brand_id = ANY($3::int[])
          AND s.voided = FALSE
          AND s.timestamp >= $1::timestamptz
          AND s.timestamp <  $2::timestamptz
          ${whereRegion}
        GROUP BY ${axisSql.group}
        ORDER BY ${axisSql.order}
        LIMIT 5000
      `;
      const { rows } = await req.db.query(sql, params);

      res.json({
        rows: rows.map((r) => normaliseSalesRow(r, groupBy)),
        window: { from: range.fromStr, to: range.toStr, timezone: tz },
        group_by: groupBy,
        brand_ids: scopedBrandIds,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /sales.csv ─────────────────────────────────────────────────
  // CSV export of the same /sales query. Uses the same params.
  router.get("/sales.csv", async (req, res) => {
    try {
      const brandIds = await getPartnerBrandIds(req);
      if (brandIds.length === 0) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=sales.csv");
        return res.send("No data\n");
      }
      const tz = await getTenantTimezone(req);
      const range = parseDateRange(req.query, tz, 30);

      let scopedBrandIds = brandIds;
      if (req.query.brand_id) {
        const requested = Number(req.query.brand_id);
        if (!brandIds.includes(requested)) {
          return res.status(403).json({ error: "Brand not in your allowlist" });
        }
        scopedBrandIds = [requested];
      }

      const { rows } = await req.db.query(
        `
        SELECT
          TO_CHAR(s.timestamp AT TIME ZONE $4, 'YYYY-MM-DD') AS day,
          COALESCE(NULLIF(c.city, ''), 'Unspecified') AS region,
          b.name AS brand_name,
          p.name AS product_name,
          SUM(si.quantity)::numeric AS qty,
          SUM(si.quantity * si.price_at_sale)::numeric AS gross_revenue
        FROM sale_items si
        JOIN sales s    ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE p.brand_id = ANY($3::int[])
          AND s.voided = FALSE
          AND s.timestamp >= $1::timestamptz
          AND s.timestamp <  $2::timestamptz
        GROUP BY day, region, b.name, p.name
        ORDER BY day DESC, region, b.name, p.name
        LIMIT 10000
        `,
        [range.fromUtc, range.toUtc, scopedBrandIds, tz]
      );

      const header = ["Day", "Region", "Brand", "Product", "Qty", "Gross Revenue"];
      const lines = [header.join(",")];
      for (const r of rows) {
        lines.push(
          [
            csvEscape(r.day || ""),
            csvEscape(r.region || ""),
            csvEscape(r.brand_name || ""),
            csvEscape(r.product_name || ""),
            Number(r.qty || 0),
            Number(r.gross_revenue || 0).toFixed(2),
          ].join(",")
        );
      }
      const fname = `sales_${range.fromStr}_to_${range.toStr}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=${fname}`);
      res.send(lines.join("\n") + "\n");
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /promotions ────────────────────────────────────────────────
  // Scheme-level totals. sale_promotion_applications is sale-scoped (no
  // product_id), so attribution stays at the scheme level — "Scheme X
  // earned Rs Y in discounts on sales that included your brand."
  router.get("/promotions", async (req, res) => {
    try {
      const brandIds = await getPartnerBrandIds(req);
      if (brandIds.length === 0) {
        return res.json({ rows: [], window: parseDateRangeMeta(req) });
      }
      const tz = await getTenantTimezone(req);
      const range = parseDateRange(req.query, tz, 30);

      const { rows } = await req.db.query(
        `
        SELECT
          spa.promotion_name_snapshot AS scheme_name,
          spa.promotion_type_snapshot AS scheme_type,
          COUNT(*)::int AS application_count,
          SUM(spa.discount_value)::numeric AS total_discount,
          SUM(COALESCE(spa.qty_qualifying, 0))::numeric AS total_qty_qualifying
        FROM sale_promotion_applications spa
        JOIN sales s ON s.id = spa.sale_id
        WHERE s.voided = FALSE
          AND s.timestamp >= $1::timestamptz
          AND s.timestamp <  $2::timestamptz
          AND EXISTS (
            SELECT 1 FROM sale_items si
              JOIN products p ON p.id = si.product_id
             WHERE si.sale_id = spa.sale_id
               AND p.brand_id = ANY($3::int[])
          )
        GROUP BY spa.promotion_name_snapshot, spa.promotion_type_snapshot
        ORDER BY total_discount DESC
        `,
        [range.fromUtc, range.toUtc, brandIds]
      );

      res.json({
        rows: rows.map((r) => ({
          scheme_name: r.scheme_name,
          scheme_type: r.scheme_type,
          application_count: Number(r.application_count),
          total_discount: Number(r.total_discount || 0),
          total_qty_qualifying: Number(r.total_qty_qualifying || 0),
        })),
        window: { from: range.fromStr, to: range.toStr, timezone: tz },
        note: "Discount totals reflect schemes applied to sales that included your brand. Sale-level audit means per-SKU split is not available.",
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use("/api/manufacturer-portal", router);
};

// ── Helpers ──────────────────────────────────────────────────────────

function normaliseSalesRow(r, groupBy) {
  const base = {
    qty: Number(r.qty || 0),
    gross_revenue: Number(r.gross_revenue || 0),
  };
  if (groupBy === "day") {
    // SQL returns r.day as a YYYY-MM-DD string via TO_CHAR.
    return { day: r.day, brand_id: r.brand_id, brand_name: r.brand_name, ...base };
  }
  if (groupBy === "sku") {
    return {
      product_id: r.product_id,
      product_name: r.product_name,
      brand_id: r.brand_id,
      brand_name: r.brand_name,
      ...base,
    };
  }
  if (groupBy === "region") {
    return { region: r.region, brand_id: r.brand_id, brand_name: r.brand_name, ...base };
  }
  return { brand_id: r.brand_id, brand_name: r.brand_name, ...base };
}

function csvEscape(s) {
  const str = String(s ?? "");
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function parseDateRangeMeta(req) {
  return {
    from: sanitiseDateStr(req.query?.from) || null,
    to: sanitiseDateStr(req.query?.to) || null,
  };
}
