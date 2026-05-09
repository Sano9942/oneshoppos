/**
 * FBR invoice worker — pg-boss implementation.
 *
 * Replaces the polling loop in fbr-worker.js with durable pg-boss jobs.
 *
 * Job: "fbr-invoice" — { tenantSlug, invoiceId }
 *   Fetches the invoice from tenant_<slug>.fbr_invoices, posts to FBR API,
 *   updates fbr_invoices + sale/return on success or failure.
 *   pg-boss handles retryLimit: 5 with retryDelay: 60 (exponential via pg-boss policy).
 */

const { postToFbr } = require("../services/fbr");

async function handleFbrInvoiceJob(job, pool, logger) {
  const { tenantSlug, invoiceId } = job.data;
  const schema = `tenant_${tenantSlug}`;

  // Fetch invoice
  const { rows: [invoice] } = await pool.query(
    `SELECT * FROM ${schema}.fbr_invoices WHERE id = $1`,
    [invoiceId]
  );
  if (!invoice) {
    logger.warn({ tenantSlug, invoiceId }, "FBR invoice not found — skipping");
    return;
  }

  // Already posted — idempotent guard
  if (invoice.status === "posted") {
    logger.info({ tenantSlug, invoiceId }, "FBR invoice already posted — skipping");
    return;
  }

  // Mark as processing (best-effort — don't fail job if already processing)
  try {
    await pool.query(
      `UPDATE ${schema}.fbr_invoices SET status = 'processing' WHERE id = $1 AND status IN ('pending', 'processing')`,
      [invoiceId]
    );
  } catch (_) {}

  // Get credentials
  const { rows: [profile] } = await pool.query(
    `SELECT fbr_api_token, fbr_environment FROM ${schema}.company_profile WHERE id = 1`
  );
  if (!profile?.fbr_api_token) {
    // W41 fix: increment retry_count on missing-credentials path so the existing
    // 5-retry cap eventually trips. After 5 hourly attempts (~50 min), mark as
    // abandoned_no_creds so the row stops requeueing forever. Operator can
    // re-enqueue manually via /fbr dashboard once credentials are configured.
    const newRetryCount = (invoice.retry_count || 0) + 1;
    if (newRetryCount >= (invoice.max_retries || 5)) {
      logger.warn({ tenantSlug, invoiceId, newRetryCount }, "FBR invoice abandoned — credentials still missing after max retries");
      await pool.query(
        `UPDATE ${schema}.fbr_invoices
            SET status = 'abandoned_no_creds',
                retry_count = $1,
                last_error = 'Missing FBR credentials (abandoned after max retries)'
          WHERE id = $2`,
        [newRetryCount, invoiceId]
      );
      return;
    }
    logger.warn({ tenantSlug, invoiceId, newRetryCount }, "FBR credentials missing — cannot post invoice");
    await pool.query(
      `UPDATE ${schema}.fbr_invoices
          SET status = 'pending',
              retry_count = $1,
              last_error = 'Missing FBR credentials',
              next_retry_at = NOW() + INTERVAL '10 minutes'
        WHERE id = $2`,
      [newRetryCount, invoiceId]
    );
    return;
  }

  try {
    const result = await postToFbr(
      invoice.payload,
      profile.fbr_api_token,
      profile.fbr_environment
    );

    const fbrIrn = result.InvoiceNumber || result.irn || result.invoiceRefNo || null;
    const qrCode = result.qrCode || null;

    await pool.query(
      `UPDATE ${schema}.fbr_invoices
       SET status = 'posted', fbr_irn = $1, fbr_response = $2, posted_at = NOW()
       WHERE id = $3`,
      [fbrIrn, JSON.stringify(result), invoiceId]
    );

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

    if (global.__fbrWorkerStatus) global.__fbrWorkerStatus.processedToday++;
    logger.info({ tenantSlug, invoiceId, fbrIrn }, "FBR invoice posted successfully");
  } catch (err) {
    const retryCount = (job.retryCount || 0) + 1;
    const maxRetries = 5; // matches retryLimit in boss.send calls

    await pool.query(
      `UPDATE ${schema}.fbr_invoices
       SET retry_count = $1, last_error = $2, next_retry_at = NOW() + INTERVAL '60 seconds'
       WHERE id = $3`,
      [retryCount, err.message, invoiceId]
    );

    if (retryCount >= maxRetries) {
      // Final attempt failed — mark as permanently failed
      await pool.query(
        `UPDATE ${schema}.fbr_invoices SET status = 'failed' WHERE id = $1`,
        [invoiceId]
      );
      if (invoice.sale_id) {
        await pool.query(`UPDATE ${schema}.sales SET fbr_status = 'failed' WHERE id = $1`, [invoice.sale_id]);
      }
      if (invoice.return_id) {
        await pool.query(`UPDATE ${schema}.returns SET fbr_status = 'failed' WHERE id = $1`, [invoice.return_id]);
      }
      logger.error({ tenantSlug, invoiceId, retryCount }, "FBR invoice failed permanently");
      return; // don't rethrow — let pg-boss treat as completed (we've recorded failure)
    }

    // Reset to pending so status is consistent; re-throw so pg-boss retries
    await pool.query(
      `UPDATE ${schema}.fbr_invoices SET status = 'pending' WHERE id = $1`,
      [invoiceId]
    );
    logger.warn({ tenantSlug, invoiceId, retryCount }, "FBR invoice failed — will retry");
    throw err; // signal pg-boss to retry
  }
}

async function registerFbrWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "fbr-worker-boss" });

  global.__fbrWorkerStatus = global.__fbrWorkerStatus || { lastPollAt: null, processedToday: 0, queueDepth: 0 };

  // Create queue (pg-boss v12+ requires explicit queue creation before work/send)
  await boss.createQueue("fbr-invoice");

  // pg-boss v12 passes Job<T>[] to handlers (default batchSize=1 → array of 1).
  // Destructure the single job from the array.
  await boss.work("fbr-invoice", { teamSize: 10, teamConcurrency: 10 }, async ([job]) => {
    if (global.__fbrWorkerStatus) global.__fbrWorkerStatus.lastPollAt = Date.now();
    await handleFbrInvoiceJob(job, pool, logger);

    // Update queue depth for admin dashboard
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM pgboss.job WHERE name = 'fbr-invoice' AND state IN ('created', 'retry')`
      );
      if (global.__fbrWorkerStatus) global.__fbrWorkerStatus.queueDepth = rows[0]?.cnt || 0;
    } catch {
      // pgboss schema may not exist in test environments
    }
  });

  logger.info("FBR invoice worker (pg-boss) registered");
}

module.exports = { registerFbrWorker };
