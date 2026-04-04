// LEGACY — replaced by fbr-worker-boss.js (pg-boss). Kept as fallback.
/**
 * FBR Digital Invoicing Worker
 *
 * Polls fbr_invoices queue across all active tenants with fbr_integration enabled.
 * Posts invoices to FBR API with exponential backoff retry.
 *
 * Usage:
 *   Inline mode: require('./workers/fbr-worker').startFbrWorker(db)
 *   Standalone:  node backend/workers/fbr-worker.js
 */

const { postToFbr, getNextRetryDelay } = require("../services/fbr");

const POLL_INTERVAL = 30_000; // 30 seconds
const MAX_CONCURRENT_GLOBAL = 20;
const MAX_CONCURRENT_PER_TENANT = 5;

let activeGlobal = 0;
let stopping = false;
let pollTimer = null;

async function processTenant(pool, tenantSlug, logger) {
  const schema = `tenant_${tenantSlug}`;

  // Check if FBR is enabled
  try {
    const { rows: [flag] } = await pool.query(
      `SELECT enabled FROM ${schema}.feature_flags WHERE key = 'fbr_integration'`
    );
    if (!flag?.enabled) return;
  } catch {
    return; // table may not exist
  }

  // Get FBR credentials
  const { rows: [profile] } = await pool.query(
    `SELECT fbr_api_token, fbr_environment FROM ${schema}.company_profile WHERE id = 1`
  );
  if (!profile?.fbr_api_token) return;

  // Fetch pending invoices
  const { rows: pending } = await pool.query(
    `SELECT id FROM ${schema}.fbr_invoices
     WHERE status = 'pending' AND next_retry_at <= NOW()
     ORDER BY created_at ASC LIMIT $1`,
    [MAX_CONCURRENT_PER_TENANT]
  );

  for (const row of pending) {
    if (activeGlobal >= MAX_CONCURRENT_GLOBAL || stopping) break;
    activeGlobal++;

    // Process in background (don't await all sequentially)
    processInvoice(pool, schema, row.id, profile, logger)
      .catch((err) => logger.error({ err, schema, invoiceId: row.id }, "FBR invoice processing error"))
      .finally(() => activeGlobal--);
  }
}

async function processInvoice(pool, schema, invoiceId, profile, logger) {
  // Row-lock: mark as processing
  const { rows: [invoice] } = await pool.query(
    `UPDATE ${schema}.fbr_invoices SET status = 'processing'
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [invoiceId]
  );
  if (!invoice) return; // already picked up by another worker

  try {
    const result = await postToFbr(
      invoice.payload,
      profile.fbr_api_token,
      profile.fbr_environment
    );

    // Success — update queue and sale/return
    const fbrIrn = result.InvoiceNumber || result.irn || result.invoiceRefNo || null;
    const qrCode = result.qrCode || null;

    await pool.query(
      `UPDATE ${schema}.fbr_invoices
       SET status = 'posted', fbr_irn = $1, fbr_response = $2, posted_at = NOW()
       WHERE id = $3`,
      [fbrIrn, JSON.stringify(result), invoiceId]
    );

    // Update the source record
    if (invoice.sale_id) {
      await pool.query(
        `UPDATE ${schema}.sales SET fbr_status = 'posted', fbr_irn = $1, fbr_qr_code = $2 WHERE id = $3`,
        [fbrIrn, qrCode, invoice.sale_id]
      );
    }
    if (invoice.return_id) {
      await pool.query(
        `UPDATE ${schema}.returns SET fbr_status = 'posted', fbr_irn = $1 WHERE id = $2`,
        [fbrIrn, invoice.return_id]
      );
    }

    logger.info({ schema, invoiceId, fbrIrn }, "FBR invoice posted successfully");
    if (global.__fbrWorkerStatus) global.__fbrWorkerStatus.processedToday++;
  } catch (err) {
    const retryCount = (invoice.retry_count || 0) + 1;
    const maxRetries = invoice.max_retries || 5;

    if (retryCount >= maxRetries) {
      await pool.query(
        `UPDATE ${schema}.fbr_invoices
         SET status = 'failed', retry_count = $1, last_error = $2
         WHERE id = $3`,
        [retryCount, err.message, invoiceId]
      );
      logger.error({ schema, invoiceId, retryCount }, "FBR invoice failed permanently");

      // Update source record
      if (invoice.sale_id) {
        await pool.query(
          `UPDATE ${schema}.sales SET fbr_status = 'failed' WHERE id = $1`,
          [invoice.sale_id]
        );
      }
      if (invoice.return_id) {
        await pool.query(
          `UPDATE ${schema}.returns SET fbr_status = 'failed' WHERE id = $1`,
          [invoice.return_id]
        );
      }
    } else {
      const delaySecs = getNextRetryDelay(retryCount);
      await pool.query(
        `UPDATE ${schema}.fbr_invoices
         SET status = 'pending', retry_count = $1, last_error = $2,
             next_retry_at = NOW() + INTERVAL '1 second' * $3
         WHERE id = $4`,
        [retryCount, err.message, delaySecs, invoiceId]
      );
      logger.warn({ schema, invoiceId, retryCount, nextRetrySecs: delaySecs }, "FBR invoice retry scheduled");
    }
  }
}

async function pollOnce(pool, logger) {
  if (stopping) return;
  if (global.__fbrWorkerStatus) global.__fbrWorkerStatus.lastPollAt = Date.now();
  try {
    const { rows: tenants } = await pool.query(
      "SELECT slug FROM public.tenants WHERE status = 'active'"
    );
    let totalPending = 0;
    for (const tenant of tenants) {
      if (stopping) break;
      try {
        await processTenant(pool, tenant.slug, logger);
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS cnt FROM tenant_${tenant.slug}.fbr_invoices WHERE status = 'pending'`
        );
        totalPending += rows[0]?.cnt || 0;
      } catch (err) {
        logger.error({ err, tenant: tenant.slug }, "FBR worker tenant error");
      }
    }
    if (global.__fbrWorkerStatus) global.__fbrWorkerStatus.queueDepth = totalPending;
  } catch (err) {
    // If tenants table doesn't exist (single-tenant mode), silently skip
    if (!err.message.includes('relation "public.tenants"')) {
      logger.error({ err }, "FBR worker poll error");
    }
  }
}

function startFbrWorker(db) {
  global.__fbrWorkerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 };
  // db can be the pg pool or the db-pg module
  const pool = db.pool || db;
  const logger = require("../services/logger").child({ component: "fbr-worker" });

  logger.info("FBR worker started (inline mode)");

  async function tick() {
    await pollOnce(pool, logger);
    if (!stopping) {
      pollTimer = setTimeout(tick, POLL_INTERVAL);
    }
  }

  tick();

  return {
    stop() {
      stopping = true;
      if (pollTimer) clearTimeout(pollTimer);
    },
  };
}

// Standalone entry point
if (require.main === module) {
  require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const logger = require("../services/logger").child({ component: "fbr-worker" });

  const port = process.env.FBR_WORKER_PORT || 8081;
  require("http")
    .createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", activeGlobal }));
      } else {
        res.writeHead(404);
        res.end();
      }
    })
    .listen(port, () => logger.info({ port }, "FBR worker health endpoint listening"));

  logger.info("FBR worker started (standalone mode)");

  async function tick() {
    await pollOnce(pool, logger);
    if (!stopping) {
      pollTimer = setTimeout(tick, POLL_INTERVAL);
    }
  }

  tick();

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, stopping FBR worker...");
    stopping = true;
    if (pollTimer) clearTimeout(pollTimer);
    // Wait for in-flight to finish
    const waitForDrain = setInterval(() => {
      if (activeGlobal === 0) {
        clearInterval(waitForDrain);
        pool.end().then(() => process.exit(0));
      }
    }, 500);
  });
}

module.exports = { startFbrWorker };
