const logger = require("./logger");
const { resolveInheritedField } = require("../category-tree");

const FBR_URLS = {
  sandbox: "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb",
  production: "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata",
  validate: "https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata",
};

const BACKOFF_DELAYS = [60, 300, 900, 3600, 14400]; // seconds: 1m, 5m, 15m, 1h, 4h

function buildInvoicePayload(sale, items, company, customer, categoryTree) {
  const byId = categoryTree?.byId;
  // FBR wants the LOCAL invoice date. sale.timestamp is a UTC instant;
  // toISOString() gave the UTC date, which is the previous day for any PKT
  // sale before 5 AM — a compliance mismatch with the printed receipt.
  const { tenantToday } = require("../utils/tz");
  const fbrTz = company?.timezone || "Asia/Karachi";

  return {
    invoiceType: "Sale Invoice",
    invoiceDate: tenantToday(fbrTz, new Date(sale.timestamp)),
    sellerBusinessName: company.company_name,
    sellerNTNCNIC: company.ntn || "",
    sellerProvince: company.fbr_province || "",
    sellerAddress: company.address || "",
    buyerNTNCNIC: customer?.ntn_cnic || "",
    buyerBusinessName: customer?.name || "Walk-in Customer",
    buyerRegistrationType: customer?.ntn_cnic ? "Registered" : "Unregistered",
    invoiceRefNo: sale.invoice_number,
    items: items.map((item) => {
      // P8 (v83): prefer per-line snapshot fields written at sale-write time.
      // Fall back to live recompute paths only when the snapshot is unset
      // (pre-v83 enqueues).
      const snapshotHs = item.hs_code_at_sale || null;
      const inheritedHs = byId
        ? resolveInheritedField(byId, item.category_id, "hs_code")
        : null;
      const hsCode = snapshotHs || inheritedHs;
      const taxRate = Number(
        item.tax_rate_at_sale != null
          ? item.tax_rate_at_sale
          : item.effective_tax_rate || item.tax_rate || 0
      );
      const valueExclTax =
        Number(item.price_at_sale || item.price) * Number(item.quantity);
      const taxAmount =
        item.tax_amount_at_sale != null
          ? Number(item.tax_amount_at_sale)
          : (valueExclTax * taxRate) / 100;
      return {
        hsCode: hsCode || company.fbr_default_hs_code || "",
        productDescription: item.product_name || item.name || "",
        quantity: Number(item.quantity),
        uoM: "Numbers, pieces, units",
        valueSalesExcludingST: valueExclTax,
        salesTaxApplicable: taxAmount,
        furtherTax: 0,
        extraTax: 0,
        fedPayable: 0,
        discount: Number(item.discount_amount || 0),
        saleType: "Goods at standard rate (default)",
      };
    }),
  };
}

function buildCreditNotePayload(
  returnRecord,
  items,
  company,
  customer,
  categoryTree
) {
  const payload = buildInvoicePayload(
    {
      ...returnRecord,
      timestamp: returnRecord.created_at || returnRecord.timestamp,
    },
    items,
    company,
    customer,
    categoryTree
  );
  payload.invoiceType = "Credit Note";
  payload.invoiceRefNo =
    returnRecord.return_number || `RET-${returnRecord.id}`;
  return payload;
}

function buildDebitNotePayload(sale, company) {
  const { tenantToday } = require("../utils/tz");
  return {
    invoiceType: "Debit Note",
    invoiceDate: tenantToday(company?.timezone || "Asia/Karachi"),
    sellerBusinessName: company.company_name,
    sellerNTNCNIC: company.ntn || "",
    sellerProvince: company.fbr_province || "",
    invoiceRefNo: sale.invoice_number,
    originalInvoiceRefNo: sale.fbr_irn,
    reason: "Sale voided",
  };
}

async function postToFbr(payload, token, environment) {
  const url = FBR_URLS[environment] || FBR_URLS.sandbox;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `FBR API error: ${res.status}`);
    err.status = res.status;
    err.fbrResponse = body;
    throw err;
  }
  return body;
}

async function validateConnection(token, environment) {
  const url = FBR_URLS.validate;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ test: true }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    logger.error({ err }, "FBR connection test failed");
    return { ok: false, status: 0, error: err.message };
  }
}

async function enqueueFbrInvoice(
  db,
  { saleId, returnId, invoiceType, payload, tenantSlug }
) {
  // W31 gate: refuse to enqueue when the tenant cannot actually post to FBR.
  // The PK country pack auto-seeds `fbr_integration=true` regardless of the
  // wizard's tax_mode answer, so any tenant that picks "I don't charge GST"
  // (or never finishes /settings/fbr) used to silently grow `fbr_invoices`
  // by one stuck `pending` row per sale forever. The FBR worker correctly
  // halts at the credential check before any HTTP call, so there's no API
  // leak — but the queue grew unbounded. Two failure conditions:
  //   1. tax_mode = 'none' — the merchant declined GST; no invoice should
  //      be posted regardless of credentials.
  //   2. tax_mode is set but FBR credentials are missing — credentials may
  //      arrive later (merchant finishes /settings/fbr) but until then there
  //      is nothing the worker can do; better to skip than to backlog.
  // Read the gate from `company_profile` (one row per tenant). Fail-open if
  // the lookup throws — preserves prior behavior on any unexpected error.
  try {
    const { rows: [cp] } = await db.query(
      "SELECT tax_mode, fbr_api_token, ntn FROM company_profile WHERE id = 1"
    );
    if (!cp || cp.tax_mode === "none" || !cp.fbr_api_token || !cp.ntn) {
      logger.info(
        {
          tenantSlug,
          saleId: saleId || null,
          returnId: returnId || null,
          tax_mode: cp?.tax_mode || null,
          has_token: !!cp?.fbr_api_token,
          has_ntn: !!cp?.ntn,
        },
        "FBR enqueue skipped — tenant tax_mode=none or credentials missing"
      );
      return;
    }
  } catch (err) {
    logger.warn({ err, tenantSlug }, "FBR enqueue gate lookup failed — falling through to insert");
  }

  const { rows: [inserted] } = await db.query(
    `INSERT INTO fbr_invoices (sale_id, return_id, invoice_type, payload, status, next_retry_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     RETURNING id`,
    [saleId || null, returnId || null, invoiceType, JSON.stringify(payload)]
  );

  // Dispatch pg-boss job for immediate processing (non-blocking)
  if (tenantSlug && inserted?.id) {
    const invoiceId = inserted.id;
    // eslint-disable-next-line promise/catch-or-return
    Promise.resolve().then(async () => {
      try {
        const { getBoss } = require("./boss");
        const boss = await getBoss();
        await boss.send(
          "fbr-invoice",
          { tenantSlug, invoiceId },
          { retryLimit: 5, retryDelay: 60 }
        );
      } catch (_) {
        // Silently ignore — legacy FBR worker will still pick up via fbr_invoices poll
      }
    });
  }
}

function getNextRetryDelay(retryCount) {
  return BACKOFF_DELAYS[Math.min(retryCount, BACKOFF_DELAYS.length - 1)];
}

module.exports = {
  buildInvoicePayload,
  buildCreditNotePayload,
  buildDebitNotePayload,
  postToFbr,
  validateConnection,
  enqueueFbrInvoice,
  getNextRetryDelay,
  FBR_URLS,
  BACKOFF_DELAYS,
};
