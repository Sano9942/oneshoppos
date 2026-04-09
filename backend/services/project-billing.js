/**
 * Project billing — links invoices/subscriptions to projects.
 */

async function attachInvoiceToProject(db, invoiceId, projectId, milestoneId = null, invoiceKind = "standard") {
  const { rows: [invoice] } = await db.query(
    `UPDATE customer_invoices SET project_id = $2, milestone_id = $3, invoice_kind = $4, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [invoiceId, projectId, milestoneId, invoiceKind]
  );
  if (!invoice) throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });

  const { logActivity } = require("./projects");
  await logActivity(db, projectId, null, "invoice_created", `Invoice #${invoice.invoice_number || invoice.id} attached`, { invoice_id: invoiceId });

  return invoice;
}

async function getProjectBillingSummary(db, projectId) {
  const { rows: invoices } = await db.query(
    `SELECT ci.*, pm.name AS milestone_name
     FROM customer_invoices ci
     LEFT JOIN project_milestones pm ON pm.id = ci.milestone_id
     WHERE ci.project_id = $1
     ORDER BY ci.created_at DESC`,
    [projectId]
  );

  const { rows: subscriptions } = await db.query(
    "SELECT * FROM customer_subscriptions WHERE project_id = $1 ORDER BY created_at DESC",
    [projectId]
  );

  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.total || 0), 0);
  const totalPaid = invoices.filter(i => i.status === "paid").reduce((sum, i) => sum + Number(i.total || 0), 0);

  return { invoices, subscriptions, totalInvoiced, totalPaid };
}

module.exports = { attachInvoiceToProject, getProjectBillingSummary };
