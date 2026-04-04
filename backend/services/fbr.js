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

  return {
    invoiceType: "Sale Invoice",
    invoiceDate: new Date(sale.timestamp).toISOString().split("T")[0],
    sellerBusinessName: company.company_name,
    sellerNTNCNIC: company.ntn || "",
    sellerProvince: company.fbr_province || "",
    sellerAddress: company.address || "",
    buyerNTNCNIC: customer?.ntn_cnic || "",
    buyerBusinessName: customer?.name || "Walk-in Customer",
    buyerRegistrationType: customer?.ntn_cnic ? "Registered" : "Unregistered",
    invoiceRefNo: sale.invoice_number,
    items: items.map((item) => {
      const hsCode = byId
        ? resolveInheritedField(byId, item.category_id, "hs_code")
        : null;
      const taxRate = Number(item.effective_tax_rate || item.tax_rate || 0);
      const valueExclTax =
        Number(item.price_at_sale || item.price) * Number(item.quantity);
      return {
        hsCode: hsCode || company.fbr_default_hs_code || "",
        productDescription: item.product_name || item.name || "",
        quantity: Number(item.quantity),
        uoM: "Numbers, pieces, units",
        valueSalesExcludingST: valueExclTax,
        salesTaxApplicable: (valueExclTax * taxRate) / 100,
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
  return {
    invoiceType: "Debit Note",
    invoiceDate: new Date().toISOString().split("T")[0],
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
