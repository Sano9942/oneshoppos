/**
 * digestEmail.js — End-of-day digest email HTML builder.
 *
 * Produces a self-contained HTML string (inline styles, no scripts, no external assets).
 * Follows the same pattern as receiptEmail.js.
 *
 * @param {object} data        - Dashboard data object (see fetchDigestData in governance.js)
 * @param {string} companyName - Display name for the store/company
 * @param {string} dateStr     - YYYY-MM-DD date string for the digest header
 * @returns {string} Complete HTML document string
 */
function buildDigestEmailHtml(data, companyName, dateStr) {
  const store = companyName || "SanoPOS";
  const currency = data.currency?.symbol || "$";

  function fmt(n) {
    return `${currency} ${Number(n || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  // ── Payment breakdown rows ────────────────────────────────────────────────
  const zReport = data.zReport || [];
  const paymentRows = zReport.length
    ? zReport
        .map(
          (row) => `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;">${row.payment_method || "—"}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${fmt(row.total)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;color:#888;">${row.contribution_pct ?? "—"}%</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="3" style="padding:8px;color:#aaa;text-align:center;">No sales today</td></tr>`;

  // ── Top 5 products rows ───────────────────────────────────────────────────
  const topSelling = (data.topSelling || []).slice(0, 5);
  const topRows = topSelling.length
    ? topSelling
        .map(
          (row, i) => `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;color:#888;">${i + 1}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;">${row.name || "—"}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${fmtNum(row.total_sold)} units</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="3" style="padding:8px;color:#aaa;text-align:center;">No sales data</td></tr>`;

  // ── Low stock rows ────────────────────────────────────────────────────────
  const lowStock = (data.lowStock || []).slice(0, 8);
  const lowStockRows = lowStock.length
    ? lowStock
        .map(
          (row) => `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;">${row.name || "—"}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;color:#e53e3e;font-weight:bold;">${fmtNum(row.stock)}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="2" style="padding:8px;color:#aaa;text-align:center;">All stock levels healthy</td></tr>`;

  const refunds = data.refundsToday || {};
  const voids = data.voidsToday || {};
  const discounts = data.discountsToday || {};

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>End-of-Day Digest — ${dateStr}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr><td align="center" style="padding:24px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;border:1px solid #e0e0e0;">

        <!-- Header -->
        <tr><td style="background:#1a1a2e;border-radius:8px 8px 0 0;padding:24px 32px;text-align:center;">
          <div style="font-size:22px;font-weight:bold;color:#fff;">${store}</div>
          <div style="font-size:13px;color:#aaa;margin-top:4px;">End-of-Day Digest · ${dateStr}</div>
        </td></tr>

        <!-- Revenue Summary -->
        <tr><td style="padding:24px 32px 0;">
          <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:12px;">Revenue Summary</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px;background:#f9f9f9;border-radius:6px;text-align:center;width:33%;">
                <div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${fmt(data.totalRevenueToday)}</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">Total Revenue</div>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:8px;background:#f9f9f9;border-radius:6px;text-align:center;width:33%;">
                <div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${fmtNum(data.saleCount)}</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">Transactions</div>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:8px;background:#f9f9f9;border-radius:6px;text-align:center;width:33%;">
                <div style="font-size:20px;font-weight:bold;color:#1a1a2e;">${fmt(data.averageBill)}</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">Avg Bill</div>
              </td>
            </tr>
            <tr><td colspan="5" style="padding-top:8px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:8px;background:#f0fdf4;border-radius:6px;text-align:center;">
                    <div style="font-size:17px;font-weight:bold;color:#16a34a;">${fmt(data.todayProfit)}</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;">Net Profit (after expenses)</div>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Payment Breakdown -->
        <tr><td style="padding:20px 32px 0;">
          <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:10px;">Payment Breakdown</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr style="background:#f5f5f5;">
              <th style="padding:6px 8px;text-align:left;font-weight:bold;color:#555;">Method</th>
              <th style="padding:6px 8px;text-align:right;font-weight:bold;color:#555;">Amount</th>
              <th style="padding:6px 8px;text-align:right;font-weight:bold;color:#555;">Share</th>
            </tr>
            ${paymentRows}
          </table>
        </td></tr>

        <!-- Top 5 Products -->
        <tr><td style="padding:20px 32px 0;">
          <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:10px;">Top Products (Last 30 Days)</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr style="background:#f5f5f5;">
              <th style="padding:6px 8px;text-align:left;font-weight:bold;color:#555;">#</th>
              <th style="padding:6px 8px;text-align:left;font-weight:bold;color:#555;">Product</th>
              <th style="padding:6px 8px;text-align:right;font-weight:bold;color:#555;">Sold</th>
            </tr>
            ${topRows}
          </table>
        </td></tr>

        <!-- Exceptions -->
        <tr><td style="padding:20px 32px 0;">
          <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:10px;">Exceptions Today</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr style="background:#f5f5f5;">
              <th style="padding:6px 8px;text-align:left;font-weight:bold;color:#555;">Type</th>
              <th style="padding:6px 8px;text-align:right;font-weight:bold;color:#555;">Count</th>
              <th style="padding:6px 8px;text-align:right;font-weight:bold;color:#555;">Value</th>
              <th style="padding:6px 8px;text-align:right;font-weight:bold;color:#555;">% of Sales</th>
            </tr>
            <tr>
              <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;">Refunds</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${fmtNum(refunds.count)}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${fmt(refunds.value)}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;${(refunds.pct_of_sales || 0) > 5 ? "color:#e53e3e;" : ""}">${refunds.pct_of_sales ?? "—"}%</td>
            </tr>
            <tr>
              <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;">Voids</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${fmtNum(voids.count)}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${fmt(voids.value)}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right;${(voids.pct_of_sales || 0) > 3 ? "color:#e53e3e;" : ""}">${voids.pct_of_sales ?? "—"}%</td>
            </tr>
            <tr>
              <td style="padding:5px 8px;">Discounts</td>
              <td style="padding:5px 8px;text-align:right;">${fmtNum(discounts.count)}</td>
              <td style="padding:5px 8px;text-align:right;">${fmt(discounts.value)}</td>
              <td style="padding:5px 8px;text-align:right;">${discounts.pct_of_sales ?? "—"}%</td>
            </tr>
          </table>
        </td></tr>

        <!-- Low Stock Alerts -->
        ${lowStock.length ? `
        <tr><td style="padding:20px 32px 0;">
          <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:10px;">Low Stock Alerts</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr style="background:#fff5f5;">
              <th style="padding:6px 8px;text-align:left;font-weight:bold;color:#555;">Product</th>
              <th style="padding:6px 8px;text-align:right;font-weight:bold;color:#555;">On Hand</th>
            </tr>
            ${lowStockRows}
          </table>
        </td></tr>` : ""}

        <!-- Footer -->
        <tr><td style="padding:24px 32px;text-align:center;border-top:1px solid #eee;margin-top:20px;">
          <div style="font-size:11px;color:#aaa;">
            Generated by SanoPOS · ${dateStr}<br>
            This is an automated end-of-day digest.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildDigestEmailHtml };
