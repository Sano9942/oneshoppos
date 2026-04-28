/**
 * receiptEmail.js — Server-side HTML receipt builder for email delivery.
 *
 * Produces a self-contained HTML string (inline styles, no scripts, no external assets).
 * Mirrors the sections from frontend/src/utils/receipt.js buildReceiptSections().
 *
 * @param {object} sale     - Row from sales table (includes outlet_name, employee_name)
 * @param {Array}  items    - Rows from sale_items (with product_name)
 * @param {Array}  payments - Rows from sale_payments
 * @param {object|null} template - Row from receipt_templates (header_text, footer_text, show_barcode)
 * @returns {string} Complete HTML document string
 */
// Mirror of frontend/src/utils/receipt.js formatPaymentMethodLabel —
// keep the two in sync. Inlined here to avoid pulling frontend code
// into the backend bundle. Used to render "gift_card" → "Gift Card"
// on emailed receipts.
function formatPaymentMethodLabel(method) {
  if (!method) return "";
  const raw = String(method);
  const knownAliases = {
    gift_card: "Gift Card",
    return_credit: "Return Credit",
    store_credit: "Store Credit",
  };
  const lower = raw.toLowerCase();
  if (knownAliases[lower]) return knownAliases[lower];
  return raw
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(" ");
}

function buildReceiptEmailHtml(sale, items, payments, template, currencySymbol = "$") {
  const storeName = template?.header_text || sale.outlet_name || "SanoPOS";
  const footerText = template?.footer_text || "Thank you for your purchase!";

  // Bucket F: per-template toggles. Undefined/null defaults to TRUE
  // (preserve legacy behavior for tenants without designer v2 data).
  const showTaxBreakdown = template?.show_tax_breakdown !== false;
  const showFbr = template?.show_fbr !== false;
  const showQr = template?.show_qr !== false;
  const logoUrl = template?.logo_url || null;

  const subtotal = items.reduce(
    (s, i) => s + Number(i.price_at_sale || 0) * Number(i.quantity || 0),
    0
  );
  const total = Number(sale.total_amount || 0);
  const discount = Number(sale.discount_amount || 0);
  const tax = total - subtotal + discount; // derived

  function fmt(n) {
    return `${currencySymbol} ${Number(n || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  const itemRows = items
    .map(
      (i) => {
        // 2-R.8: inline seat chip when the sale_items row has a seat_number
        // (dine-in). Retail sales render unchanged.
        const seatChip = i.seat_number != null
          ? `<span style="display:inline-block;background:#eef2ff;color:#4f46e5;border-radius:4px;padding:1px 6px;font-size:11px;margin-right:6px;">S${i.seat_number}</span>`
          : "";
        return `
      <tr>
        <td style="padding:4px 0;border-bottom:1px solid #eee;">${seatChip}${i.product_name || "Item"}</td>
        <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:center;">${i.quantity}</td>
        <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right;">${fmt(i.price_at_sale)}</td>
        <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right;">${fmt(Number(i.price_at_sale) * Number(i.quantity))}</td>
      </tr>`;
      }
    )
    .join("");

  const paymentRows = payments
    .map(
      (p) => `
      <tr>
        <td style="padding:2px 0;color:#555;">${formatPaymentMethodLabel(p.payment_method)}</td>
        <td style="padding:2px 0;text-align:right;">${fmt(p.amount)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Receipt</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr><td align="center" style="padding:24px 0;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:32px;border:1px solid #e0e0e0;">

        <!-- Header -->
        <tr><td style="text-align:center;padding-bottom:16px;border-bottom:2px solid #222;">
          ${logoUrl ? `<div style="margin-bottom:8px;"><img src="${logoUrl}" alt="" style="max-width:200px;max-height:60px;" /></div>` : ""}
          <div style="font-size:20px;font-weight:bold;">${storeName}</div>
          ${sale.outlet_name ? `<div style="font-size:12px;color:#666;margin-top:4px;">${sale.outlet_name}</div>` : ""}
        </td></tr>

        <!-- Meta -->
        <tr><td style="padding:12px 0;border-bottom:1px solid #eee;font-size:13px;">
          <table width="100%">
            <tr>
              <td style="color:#555;">Invoice #</td>
              <td style="text-align:right;font-weight:bold;">${sale.invoice_number || sale.id}</td>
            </tr>
            <tr>
              <td style="color:#555;">Date</td>
              <td style="text-align:right;">${sale.timestamp || ""}</td>
            </tr>
            ${sale.employee_name ? `<tr><td style="color:#555;">Served by</td><td style="text-align:right;">${sale.employee_name}</td></tr>` : ""}
            ${sale.customer_name ? `<tr><td style="color:#555;">Customer</td><td style="text-align:right;">${sale.customer_name}</td></tr>` : ""}
          </table>
        </td></tr>

        <!-- Items -->
        <tr><td style="padding:12px 0;font-size:13px;">
          <table width="100%">
            <tr style="font-weight:bold;border-bottom:1px solid #222;">
              <td style="padding:4px 0;">Item</td>
              <td style="padding:4px 0;text-align:center;">Qty</td>
              <td style="padding:4px 0;text-align:right;">Price</td>
              <td style="padding:4px 0;text-align:right;">Total</td>
            </tr>
            ${itemRows}
          </table>
        </td></tr>

        <!-- Totals -->
        <tr><td style="padding:12px 0;border-top:1px solid #eee;font-size:13px;">
          <table width="100%">
            <tr><td style="color:#555;">Subtotal</td><td style="text-align:right;">${fmt(subtotal)}</td></tr>
            ${discount > 0 ? `<tr><td style="color:#e53e3e;">Discount</td><td style="text-align:right;color:#e53e3e;">-${fmt(discount)}</td></tr>` : ""}
            ${showTaxBreakdown && tax > 0 ? `<tr><td style="color:#555;">Tax</td><td style="text-align:right;">${fmt(tax)}</td></tr>` : ""}
            <tr><td style="font-weight:bold;font-size:15px;padding-top:6px;">Total</td><td style="text-align:right;font-weight:bold;font-size:15px;padding-top:6px;">${fmt(total)}</td></tr>
          </table>
        </td></tr>

        <!-- Payments -->
        ${paymentRows ? `
        <tr><td style="padding:12px 0;border-top:1px solid #eee;font-size:13px;">
          <div style="font-weight:bold;margin-bottom:6px;">Payment</div>
          <table width="100%">${paymentRows}</table>
        </td></tr>` : ""}

        <!-- FBR digital invoice reference (Bucket F) -->
        ${showFbr && sale.fbr_irn ? `
        <tr><td style="padding:12px 0;border-top:1px solid #eee;font-size:13px;text-align:center;">
          <div style="color:#555;margin-bottom:4px;">FBR Ref</div>
          <div style="font-family:monospace;font-size:12px;color:#111;">${sale.fbr_irn}</div>
          ${showQr && sale.fbr_qr_code && (String(sale.fbr_qr_code).startsWith("data:") || String(sale.fbr_qr_code).startsWith("http"))
            ? `<div style="margin-top:8px;"><img src="${sale.fbr_qr_code}" alt="FBR QR" style="max-width:120px;max-height:120px;" /></div>`
            : ""}
        </td></tr>` : ""}

        <!-- Footer -->
        <tr><td style="padding-top:16px;border-top:1px solid #eee;text-align:center;font-size:12px;color:#888;">
          ${footerText}
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildReceiptEmailHtml };
