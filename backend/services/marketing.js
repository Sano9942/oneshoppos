/**
 * backend/services/marketing.js — Campaign audience resolution and delivery orchestration.
 */

const logger = require("./logger").child({ component: "marketing-service" });

/**
 * Resolve audience from filter rules against the customers table.
 * @param {object} db - tenant-scoped DB proxy
 * @param {Array<{filter_type: string, filter_value: string}>} filters
 * @param {object} [opts]
 * @param {boolean} [opts.previewOnly] - if true, return count + sample only (no IDs)
 * @returns {Promise<{count: number, customer_ids?: number[], sample?: object[]}>}
 */
async function resolveAudience(db, filters, opts = {}) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  for (const f of filters) {
    switch (f.filter_type) {
      case "group":
        conditions.push(`c.customer_group_id = $${paramIdx}`);
        params.push(Number(f.filter_value));
        paramIdx++;
        break;
      case "tag":
        conditions.push(`$${paramIdx} = ANY(c.tags)`);
        params.push(f.filter_value);
        paramIdx++;
        break;
      case "loyalty_tier":
        conditions.push(`c.loyalty_tier_id = $${paramIdx}`);
        params.push(Number(f.filter_value));
        paramIdx++;
        break;
      case "city":
        conditions.push(`c.city ILIKE $${paramIdx}`);
        params.push(`%${f.filter_value}%`);
        paramIdx++;
        break;
      case "birth_month":
        conditions.push(`EXTRACT(MONTH FROM c.date_of_birth) = $${paramIdx}`);
        params.push(Number(f.filter_value));
        paramIdx++;
        break;
      case "last_purchase_days":
        conditions.push(
          `c.id IN (SELECT DISTINCT customer_id FROM sales WHERE timestamp > NOW() - INTERVAL '1 day' * $${paramIdx})`
        );
        params.push(Number(f.filter_value));
        paramIdx++;
        break;
      case "min_spend":
        conditions.push(`c.total_spend >= $${paramIdx}`);
        params.push(Number(f.filter_value));
        paramIdx++;
        break;
      case "max_spend":
        conditions.push(`c.total_spend <= $${paramIdx}`);
        params.push(Number(f.filter_value));
        paramIdx++;
        break;
      case "has_email":
        conditions.push(`c.email IS NOT NULL AND c.email_consent = true`);
        break;
      case "has_mobile":
        conditions.push(`c.mobile IS NOT NULL AND c.sms_consent = true`);
        break;
      default:
        logger.warn({ filter_type: f.filter_type }, "Unknown audience filter type — skipped");
    }
  }

  const where = conditions.length > 0 ? `WHERE c.deleted_at IS NULL AND ${conditions.join(" AND ")}` : "WHERE c.deleted_at IS NULL";

  if (opts.previewOnly) {
    const countResult = await db.query(`SELECT COUNT(*)::int AS cnt FROM customers c ${where}`, params);
    const sampleResult = await db.query(
      `SELECT c.id, c.name, c.email, c.mobile FROM customers c ${where} ORDER BY c.id LIMIT 10`,
      params
    );
    return { count: countResult.rows[0].cnt, sample: sampleResult.rows };
  }

  const result = await db.query(`SELECT c.id FROM customers c ${where}`, params);
  return { count: result.rowCount, customer_ids: result.rows.map((r) => r.id) };
}

/**
 * Enqueue campaign delivery: creates delivery rows + pg-boss jobs.
 *
 * @param {object} boss - pg-boss instance
 * @param {number} campaignId
 * @param {object} db - tenant-scoped db proxy
 * @param {string} tenantSlug - required: each campaign-email job must carry
 *   the slug so the consumer worker can set search_path when updating
 *   marketing_campaign_deliveries rows.
 */
async function enqueueCampaignSend(boss, campaignId, db, tenantSlug) {
  if (!tenantSlug) {
    throw new Error("enqueueCampaignSend requires tenantSlug for per-delivery pg-boss payloads");
  }
  const { rows: [campaign] } = await db.query(
    `SELECT mc.*, mt.body_html AS tmpl_html, mt.subject AS tmpl_subject
     FROM marketing_campaigns mc
     LEFT JOIN marketing_templates mt ON mt.id = mc.template_id
     WHERE mc.id = $1`,
    [campaignId]
  );
  if (!campaign) throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    throw Object.assign(new Error("Campaign already sent or sending"), { statusCode: 400 });
  }

  // Resolve audience from saved filters
  const { rows: filterRows } = await db.query(
    "SELECT filter_type, filter_value FROM marketing_campaign_audiences WHERE campaign_id = $1",
    [campaignId]
  );
  const { customer_ids } = await resolveAudience(db, filterRows);

  if (!customer_ids || customer_ids.length === 0) {
    throw Object.assign(new Error("No recipients match campaign audience"), { statusCode: 400 });
  }

  // Determine subject + body (campaign override > template)
  const subject = campaign.subject || campaign.tmpl_subject || campaign.name;
  const bodyHtml = campaign.body_html || campaign.tmpl_html || "";

  // Load recipient emails
  const { rows: customers } = await db.query(
    `SELECT id, name, email FROM customers WHERE id = ANY($1) AND email IS NOT NULL AND email_consent = true`,
    [customer_ids]
  );

  if (customers.length === 0) {
    throw Object.assign(new Error("No recipients have valid email + consent"), { statusCode: 400 });
  }

  // Create delivery rows
  const deliveryIds = [];
  for (const cust of customers) {
    const { rows: [row] } = await db.query(
      `INSERT INTO marketing_campaign_deliveries (campaign_id, customer_id, channel, recipient, status)
       VALUES ($1, $2, 'email', $3, 'pending') RETURNING id`,
      [campaignId, cust.id, cust.email]
    );
    deliveryIds.push({ deliveryId: row.id, to: cust.email, name: cust.name });
  }

  // Enqueue pg-boss jobs — each delivery carries tenantSlug so the
  // consumer worker can route its status-update queries to the right schema.
  for (const d of deliveryIds) {
    await boss.send("campaign-email", {
      tenantSlug,
      deliveryId: d.deliveryId,
      campaignId,
      to: d.to,
      subject,
      html: bodyHtml,
    });
  }

  // Update campaign status
  await db.query(
    "UPDATE marketing_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1",
    [campaignId]
  );

  logger.info({ campaignId, recipientCount: customers.length }, "Campaign send enqueued");
  return { recipientCount: customers.length };
}

module.exports = { resolveAudience, enqueueCampaignSend };
