/**
 * backend/services/customer-invoicing.js — Invoice lifecycle, totals, reminders.
 */

const logger = require("./logger").child({ component: "customer-invoicing" });

/**
 * Generate next invoice number: INV-000001, INV-000002, ...
 */
async function generateInvoiceNumber(db) {
  const { rows: [{ next_id }] } = await db.query(
    "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM customer_invoices"
  );
  return `INV-${String(next_id).padStart(6, "0")}`;
}

/**
 * Pure function: compute invoice totals from line items.
 */
function computeInvoiceTotals(items, discountAmount = 0) {
  let subtotal = 0;
  let taxTotal = 0;
  const computedItems = [];

  for (const item of items) {
    const lineSubtotal = Number(item.quantity) * Number(item.unit_price);
    const lineTax = lineSubtotal * (Number(item.tax_rate || 0) / 100);
    const lineTotal = lineSubtotal + lineTax;
    subtotal += lineSubtotal;
    taxTotal += lineTax;
    computedItems.push({ ...item, line_total: Math.round(lineTotal * 100) / 100 });
  }

  const totalAmount = Math.round((subtotal + taxTotal - Number(discountAmount)) * 100) / 100;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax_total: Math.round(taxTotal * 100) / 100,
    total_amount: Math.max(totalAmount, 0),
    items: computedItems,
  };
}

/**
 * Recompute balance from payments. Updates status accordingly.
 */
async function recomputeBalance(db, invoiceId) {
  const { rows: [{ paid }] } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END), 0) AS paid
     FROM customer_invoice_payments WHERE invoice_id = $1`,
    [invoiceId]
  );

  const { rows: [invoice] } = await db.query(
    "SELECT total_amount, due_date, status FROM customer_invoices WHERE id = $1",
    [invoiceId]
  );
  if (!invoice) return;

  const amountPaid = Number(paid);
  const totalAmount = Number(invoice.total_amount);
  const balanceDue = Math.round((totalAmount - amountPaid) * 100) / 100;

  let newStatus = invoice.status;
  if (balanceDue <= 0) {
    newStatus = "paid";
  } else if (amountPaid > 0) {
    newStatus = "partial";
  } else if (invoice.due_date && new Date(invoice.due_date) < new Date() && invoice.status !== "draft") {
    newStatus = "overdue";
  }

  await db.query(
    `UPDATE customer_invoices SET amount_paid = $1, balance_due = $2, status = $3, updated_at = NOW() WHERE id = $4`,
    [amountPaid, Math.max(balanceDue, 0), newStatus, invoiceId]
  );

  return { amount_paid: amountPaid, balance_due: Math.max(balanceDue, 0), status: newStatus };
}

/**
 * Convert an accepted quotation into a customer invoice.
 */
async function convertQuotationToInvoice(db, quotationId, employeeId) {
  const { rows: [quotation] } = await db.query(
    "SELECT * FROM quotations WHERE id = $1",
    [quotationId]
  );
  if (!quotation) throw Object.assign(new Error("Quotation not found"), { statusCode: 404 });
  if (quotation.status !== "accepted") {
    throw Object.assign(new Error("Only accepted quotations can be converted"), { statusCode: 400 });
  }
  if (quotation.converted_invoice_id) {
    throw Object.assign(new Error("Quotation already converted to invoice"), { statusCode: 400 });
  }

  const { rows: qItems } = await db.query(
    "SELECT * FROM quotation_items WHERE quotation_id = $1",
    [quotationId]
  );

  const items = qItems.map((qi) => ({
    description: qi.product_name || qi.description || "Item",
    quantity: Number(qi.quantity),
    unit_price: Number(qi.price),
    tax_rate: Number(qi.effective_tax_rate || 0) * 100, // quotation stores as decimal
    product_id: qi.product_id,
    variant_id: qi.variant_id || null,
  }));

  const totals = computeInvoiceTotals(items, Number(quotation.discount_amount || 0));
  const invoiceNumber = await generateInvoiceNumber(db);

  // Tier 0.2 — quotations don't carry payment terms; derive due_date from
  // the customer's payment_terms_days at conversion time. Net 0 / missing
  // leaves due_date null (COD).
  let dueDate = null;
  try {
    const { rows: [cust] } = await db.query(
      "SELECT payment_terms_days FROM customers WHERE id = $1",
      [quotation.customer_id]
    );
    const days = Number(cust?.payment_terms_days || 0);
    if (days > 0) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      dueDate = d.toISOString().slice(0, 10);
    }
  } catch { /* keep null on lookup error */ }

  const { rows: [invoice] } = await db.query(
    `INSERT INTO customer_invoices
       (invoice_number, customer_id, quotation_id, outlet_id, employee_id, status,
        subtotal, tax_total, discount_amount, total_amount, balance_due, due_date)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $9, $10) RETURNING *`,
    [
      invoiceNumber, quotation.customer_id, quotationId, quotation.outlet_id, employeeId,
      totals.subtotal, totals.tax_total, Number(quotation.discount_amount || 0), totals.total_amount,
      dueDate,
    ]
  );

  for (const item of totals.items) {
    await db.query(
      `INSERT INTO customer_invoice_items (invoice_id, product_id, variant_id, description, quantity, unit_price, tax_rate, line_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [invoice.id, item.product_id || null, item.variant_id || null, item.description, item.quantity, item.unit_price, item.tax_rate, item.line_total]
    );
  }

  // Link quotation back
  await db.query("UPDATE quotations SET converted_invoice_id = $1 WHERE id = $2", [invoice.id, quotationId]);

  logger.info({ invoiceId: invoice.id, quotationId }, "Quotation converted to invoice");
  return invoice;
}

/**
 * Create invoices in batch for multiple customers with the same items.
 */
async function createBatchInvoices(db, { customerIds, items, dueDate, discountAmount, employeeId, outletId }) {
  const totals = computeInvoiceTotals(items, discountAmount || 0);
  const created = [];

  for (const customerId of customerIds) {
    // Tier 0.2 — when caller didn't supply a dueDate, derive per-customer
    // from customers.payment_terms_days. Buyers on different Net terms get
    // different due dates from the same batch — matches real billing intent.
    let effectiveDueDate = dueDate || null;
    if (!effectiveDueDate) {
      try {
        const { rows: [cust] } = await db.query(
          "SELECT payment_terms_days FROM customers WHERE id = $1",
          [customerId]
        );
        const days = Number(cust?.payment_terms_days || 0);
        if (days > 0) {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() + days);
          effectiveDueDate = d.toISOString().slice(0, 10);
        }
      } catch { /* keep null on lookup error — batch should continue */ }
    }

    // Idempotency: skip if same customer+due_date+total exists in last 24h
    const { rows: [dup] } = await db.query(
      `SELECT id FROM customer_invoices
       WHERE customer_id = $1 AND due_date = $2 AND total_amount = $3
         AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
      [customerId, effectiveDueDate, totals.total_amount]
    );
    if (dup) {
      logger.info({ customerId, existingInvoiceId: dup.id }, "Batch invoice skipped — duplicate");
      continue;
    }

    const invoiceNumber = await generateInvoiceNumber(db);
    const { rows: [invoice] } = await db.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, outlet_id, employee_id, status,
          subtotal, tax_total, discount_amount, total_amount, balance_due, due_date)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $8, $9) RETURNING *`,
      [invoiceNumber, customerId, outletId || null, employeeId, totals.subtotal, totals.tax_total, discountAmount || 0, totals.total_amount, effectiveDueDate]
    );

    for (const item of totals.items) {
      await db.query(
        `INSERT INTO customer_invoice_items (invoice_id, product_id, variant_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [invoice.id, item.product_id || null, item.variant_id || null, item.description, item.quantity, item.unit_price, item.tax_rate, item.line_total]
      );
    }

    created.push(invoice);
  }

  return created;
}

/**
 * Schedule reminder jobs via pg-boss.
 *
 * @param {object} boss - pg-boss instance
 * @param {object} db - tenant-scoped db proxy
 * @param {number} invoiceId
 * @param {Array} rules - reminder rule rows
 * @param {string} tenantSlug - required: each invoice-reminder job needs
 *   the slug so the worker can set search_path before reading invoice +
 *   customer rows.
 */
async function scheduleReminders(boss, db, invoiceId, rules, tenantSlug) {
  if (!tenantSlug) {
    throw new Error("scheduleReminders requires tenantSlug for pg-boss payloads");
  }
  const { rows: [invoice] } = await db.query(
    "SELECT due_date FROM customer_invoices WHERE id = $1",
    [invoiceId]
  );
  if (!invoice?.due_date) return [];

  const dueDate = new Date(invoice.due_date);
  const scheduled = [];

  for (const rule of rules) {
    let fireAt;
    if (rule.reminder_type === "before_due") {
      fireAt = new Date(dueDate.getTime() - rule.days_offset * 86400000);
    } else if (rule.reminder_type === "on_due") {
      fireAt = dueDate;
    } else {
      fireAt = new Date(dueDate.getTime() + rule.days_offset * 86400000);
    }

    // Don't schedule reminders in the past
    if (fireAt <= new Date()) continue;

    const { rows: [reminder] } = await db.query(
      `INSERT INTO customer_invoice_reminders (invoice_id, reminder_type, days_offset, channel, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [invoiceId, rule.reminder_type, rule.days_offset, rule.channel || "email"]
    );

    await boss.send(
      "invoice-reminder",
      { tenantSlug, reminderId: reminder.id, invoiceId },
      { startAfter: fireAt }
    );

    scheduled.push(reminder.id);
  }

  return scheduled;
}

module.exports = {
  generateInvoiceNumber,
  computeInvoiceTotals,
  recomputeBalance,
  convertQuotationToInvoice,
  createBatchInvoices,
  scheduleReminders,
};
