/**
 * Email templates for the unified email service.
 *
 * Each template function returns { subject, html }.
 * All use wrapEmailHtml() for consistent branding.
 */

// -- Shared HTML wrapper --------------------------------------------------
function wrapEmailHtml(title, bodyContent) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
<tr><td align="center">
  <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%">
    <tr><td style="background:linear-gradient(135deg,#059669,#047857);padding:24px 32px;border-radius:12px 12px 0 0">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">SanoPOS</h1>
      ${title ? `<p style="margin:4px 0 0;color:#a7f3d0;font-size:13px">${title}</p>` : ""}
    </td></tr>
    <tr><td style="background:#fff;padding:32px;border-radius:0 0 12px 12px">
      ${bodyContent}
    </td></tr>
    <tr><td style="padding:16px 32px;text-align:center">
      <p style="margin:0;color:#94a3b8;font-size:12px">SanoPOS — Point of Sale</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function btn(text, url) {
  return `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">${text}</a></p>`;
}

function footer(text) {
  return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/><p style="color:#94a3b8;font-size:12px;margin:0">${text}</p>`;
}

// -- Drip: Getting Started (Day 2) ----------------------------------------
function dripGettingStarted({ storeName, slug, frontendUrl }) {
  const url = `${frontendUrl}/?store=${slug}`;
  return {
    subject: `Get started with ${storeName} — 3 quick steps`,
    html: wrapEmailHtml("Getting Started", `
      <p>Hi there,</p>
      <p>Your store <strong>${storeName}</strong> is set up. Here's how to start selling in minutes:</p>
      <ol style="color:#475569;line-height:2;padding-left:20px">
        <li><strong>Add your products</strong> — go to Products and add your inventory</li>
        <li><strong>Open a shift</strong> — head to POS and open your cash register</li>
        <li><strong>Make your first sale</strong> — scan or search for products and checkout</li>
      </ol>
      ${btn("Open Your Store", url)}
      ${footer("You're receiving this because you recently signed up for SanoPOS.")}
    `),
  };
}

// -- Drip: Feature Highlights (Day 5) -------------------------------------
function dripFeatures({ storeName, slug, frontendUrl }) {
  const url = `${frontendUrl}/?store=${slug}`;
  return {
    subject: `Did you know? ${storeName} tips & tricks`,
    html: wrapEmailHtml("Tips & Tricks", `
      <p>Hi there,</p>
      <p>Here are some features you might not have tried yet:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:12px;border-bottom:1px solid #e2e8f0"><strong>Keyboard Shortcuts</strong></td>
            <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#64748b">Press F1 in POS for the full shortcut list</td></tr>
        <tr><td style="padding:12px;border-bottom:1px solid #e2e8f0"><strong>Receipt Customization</strong></td>
            <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#64748b">Add your logo, custom header/footer text</td></tr>
        <tr><td style="padding:12px;border-bottom:1px solid #e2e8f0"><strong>Reports</strong></td>
            <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#64748b">Sales summaries, inventory reports, shift reports</td></tr>
        <tr><td style="padding:12px"><strong>Install as App</strong></td>
            <td style="padding:12px;color:#64748b">Open SanoPOS in Chrome and click "Install" for a native-like experience</td></tr>
      </table>
      ${btn("Explore Features", url)}
      ${footer("You're receiving this because you recently signed up for SanoPOS.")}
    `),
  };
}

// -- Billing: Payment Recorded --------------------------------------------
function billingPaymentRecorded({ storeName, amount, plan, cycle, periodEnd }) {
  return {
    subject: `Payment received — ${storeName}`,
    html: wrapEmailHtml("Payment Confirmed", `
      <p>Hi,</p>
      <p>We've recorded your payment for <strong>${storeName}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f0fdf4;border-radius:8px">
        <tr><td style="padding:12px 16px;color:#64748b">Plan</td><td style="padding:12px 16px;font-weight:600">${plan} (${cycle})</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Amount</td><td style="padding:12px 16px;font-weight:600">${amount}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Valid Until</td><td style="padding:12px 16px;font-weight:600">${periodEnd}</td></tr>
      </table>
      <p>Thank you for choosing SanoPOS!</p>
      ${footer("This is a payment confirmation for your SanoPOS subscription.")}
    `),
  };
}

// -- Billing: Plan Changed ------------------------------------------------
function billingPlanChanged({ storeName, oldPlan, newPlan, newLimits }) {
  return {
    subject: `Plan updated — ${storeName}`,
    html: wrapEmailHtml("Plan Updated", `
      <p>Hi,</p>
      <p>Your plan for <strong>${storeName}</strong> has been changed.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:12px 16px;color:#64748b">Previous Plan</td><td style="padding:12px 16px">${oldPlan}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">New Plan</td><td style="padding:12px 16px;font-weight:600;color:#059669">${newPlan}</td></tr>
        ${newLimits ? `<tr><td style="padding:12px 16px;color:#64748b">Outlets</td><td style="padding:12px 16px">${newLimits.max_outlets}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Employees</td><td style="padding:12px 16px">${newLimits.max_employees}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Products</td><td style="padding:12px 16px">${newLimits.max_products}</td></tr>` : ""}
      </table>
      ${footer("This is a plan change notification for your SanoPOS account.")}
    `),
  };
}

// -- Billing: Expiry Warning ----------------------------------------------
function billingExpiryWarning({ storeName, plan, expiresAt, daysLeft }) {
  const urgency = daysLeft <= 1 ? "expires tomorrow" : `expires in ${daysLeft} days`;
  return {
    subject: `Your ${plan} plan ${urgency} — ${storeName}`,
    html: wrapEmailHtml("Subscription Expiring", `
      <p>Hi,</p>
      <p>Your <strong>${plan}</strong> plan for <strong>${storeName}</strong> ${urgency} (${expiresAt}).</p>
      <p>To continue without interruption, please contact us to renew your subscription.</p>
      <p style="color:#64748b;font-size:14px">If your plan expires, your account will remain accessible but some features may be limited.</p>
      ${footer("This is an automated reminder about your SanoPOS subscription.")}
    `),
  };
}

// -- Billing: Overdue -----------------------------------------------------
function billingOverdue({ storeName, plan, expiredAt }) {
  return {
    subject: `Payment overdue — ${storeName}`,
    html: wrapEmailHtml("Payment Overdue", `
      <p>Hi,</p>
      <p>Your <strong>${plan}</strong> plan for <strong>${storeName}</strong> expired on <strong>${expiredAt}</strong> and no renewal payment has been recorded.</p>
      <p>Please contact us to renew your subscription and restore full access.</p>
      ${footer("This is an automated reminder about your SanoPOS subscription.")}
    `),
  };
}

// -- Support: Ticket Received ---------------------------------------------
function supportReceived({ ticketId, type, message, storeName }) {
  return {
    subject: `Support ticket #${ticketId} received — ${storeName}`,
    html: wrapEmailHtml("Ticket Received", `
      <p>Hi,</p>
      <p>We've received your support ticket and will get back to you shortly.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px">
        <tr><td style="padding:12px 16px;color:#64748b">Ticket #</td><td style="padding:12px 16px;font-weight:600">${ticketId}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Type</td><td style="padding:12px 16px">${type}</td></tr>
      </table>
      <blockquote style="border-left:3px solid #e2e8f0;margin:16px 0;padding:12px 16px;color:#475569">${message}</blockquote>
      ${footer("This is an automated confirmation for your support ticket.")}
    `),
  };
}

// -- Support: Ticket Resolved ---------------------------------------------
function supportResolved({ ticketId, type, storeName }) {
  return {
    subject: `Support ticket #${ticketId} resolved — ${storeName}`,
    html: wrapEmailHtml("Ticket Resolved", `
      <p>Hi,</p>
      <p>Your support ticket <strong>#${ticketId}</strong> (${type}) has been resolved.</p>
      <p>If you're still experiencing issues, feel free to submit a new ticket using the support widget.</p>
      ${footer("This is an automated notification about your support ticket.")}
    `),
  };
}

// -- Broadcast: Downtime --------------------------------------------------
function downtime({ subject: subj, message }) {
  return {
    subject: `[SanoPOS] ${subj}`,
    html: wrapEmailHtml("Service Notice", `
      <p>Hi,</p>
      ${message}
      <p style="color:#64748b;font-size:14px;margin-top:20px">We apologize for any inconvenience. Thank you for your patience.</p>
      ${footer("This is a service notification from SanoPOS.")}
    `),
  };
}

// -- Broadcast: Announcement ----------------------------------------------
function announcement({ subject: subj, message }) {
  return {
    subject: `[SanoPOS] ${subj}`,
    html: wrapEmailHtml("Announcement", `
      <p>Hi,</p>
      ${message}
      ${footer("This is an announcement from SanoPOS.")}
    `),
  };
}

// -- Trial: Warning (7 days left) ------------------------------------------
function trialWarning({ storeName, daysLeft }) {
  const urgency = daysLeft <= 1 ? "expires tomorrow" : `ends in ${daysLeft} days`;
  return {
    subject: `Your Pro trial ${urgency} — ${storeName}`,
    html: wrapEmailHtml("Trial Ending Soon", `
      <p>Hi,</p>
      <p>Your Pro trial for <strong>${storeName}</strong> ${urgency}.</p>
      <p>After your trial ends, you'll have a <strong>7-day grace period</strong> to subscribe. After that, your account will become read-only — you'll still be able to view your data, but won't be able to make sales or changes.</p>
      <p>To continue using all features, please contact us to subscribe at <strong>PKR 8,000/month per outlet</strong>.</p>
      ${btn("View Billing", "https://sanopos.com/billing")}
      ${footer("This is an automated reminder about your SanoPOS trial.")}
    `),
  };
}

// -- Trial: Ended (grace period started) -----------------------------------
function trialEnded({ storeName }) {
  return {
    subject: `Trial ended — 7 days to subscribe — ${storeName}`,
    html: wrapEmailHtml("Trial Ended", `
      <p>Hi,</p>
      <p>Your Pro trial for <strong>${storeName}</strong> has ended.</p>
      <p>You have <strong>7 days</strong> to subscribe before your account becomes read-only. During this grace period, everything still works normally.</p>
      <p><strong>Pro plan: PKR 8,000/month per outlet.</strong></p>
      <p>Contact us to set up your subscription and keep selling without interruption.</p>
      ${btn("View Billing", "https://sanopos.com/billing")}
      ${footer("This is an automated notification about your SanoPOS trial.")}
    `),
  };
}

// -- Trial: Account Locked (grace expired) ---------------------------------
function accountLocked({ storeName }) {
  return {
    subject: `Account locked — action required — ${storeName}`,
    html: wrapEmailHtml("Account Locked", `
      <p>Hi,</p>
      <p>Your Pro trial and grace period for <strong>${storeName}</strong> have ended. Your account is now <strong>read-only</strong>.</p>
      <p>You can still:</p>
      <ul style="color:#475569;line-height:2;padding-left:20px">
        <li>Log in and view all your data</li>
        <li>Export reports and sales history</li>
        <li>Submit support tickets</li>
      </ul>
      <p>To resume selling and managing your store, subscribe to the Pro plan at <strong>PKR 8,000/month per outlet</strong>.</p>
      ${btn("View Billing", "https://sanopos.com/billing")}
      ${footer("This is an automated notification about your SanoPOS account.")}
    `),
  };
}

// -- Renewal: Due (7 days before expiry) ------------------------------------
function renewalDue({ storeName, plan, expiresAt, daysLeft }) {
  const urgency = daysLeft <= 1 ? "expires tomorrow" : `renews in ${daysLeft} days`;
  return {
    subject: `Your ${plan} subscription ${urgency} — ${storeName}`,
    html: wrapEmailHtml("Subscription Renewal Due", `
      <p>Hi,</p>
      <p>Your <strong>${plan}</strong> subscription for <strong>${storeName}</strong> ${urgency} (${expiresAt}).</p>
      <p>To continue using all features without interruption, please renew your subscription.</p>
      <p>After expiry, you'll have a <strong>7-day grace period</strong> before your account becomes read-only.</p>
      ${btn("Renew Now", "https://sanopos.com/billing")}
      ${footer("This is an automated reminder about your SanoPOS subscription.")}
    `),
  };
}

// -- Renewal: Overdue (entered grace period) --------------------------------
function renewalOverdue({ storeName, plan, expiredAt }) {
  return {
    subject: `Subscription lapsed — 7 days to renew — ${storeName}`,
    html: wrapEmailHtml("Subscription Lapsed", `
      <p>Hi,</p>
      <p>Your <strong>${plan}</strong> subscription for <strong>${storeName}</strong> expired on ${expiredAt}.</p>
      <p>You have <strong>7 days</strong> to renew before your account becomes read-only. During this grace period, everything still works normally.</p>
      <p>Renew now to keep selling without interruption.</p>
      ${btn("Renew Now", "https://sanopos.com/billing")}
      ${footer("This is an automated notification about your SanoPOS subscription.")}
    `),
  };
}

function campaignTest(data) {
  return {
    subject: `[TEST] ${data.subject || data.campaign_name || "Campaign Preview"}`,
    html: wrapEmailHtml(
      `Test: ${data.campaign_name || "Campaign"}`,
      data.html || "<p>No content</p>"
    ),
  };
}

function customerInvoice(data) {
  const itemRows = (data.items || [])
    .map(
      (i) =>
        `<tr><td style="padding:6px;border-bottom:1px solid #eee">${i.description}</td>
         <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${Number(i.quantity)}</td>
         <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${Number(i.unit_price).toLocaleString()}</td>
         <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${Number(i.line_total).toLocaleString()}</td></tr>`
    )
    .join("");

  return {
    subject: `Invoice ${data.invoice_number} from ${data.company_name || "Our Store"}`,
    html: wrapEmailHtml(
      `Invoice ${data.invoice_number}`,
      `<p>Hi ${data.customer_name || "Customer"},</p>
       <p>Here is your invoice from <strong>${data.company_name || "Our Store"}</strong>.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0">
         <tr style="background:#f5f5f5"><th style="padding:6px;text-align:left">Item</th><th style="padding:6px;text-align:right">Qty</th><th style="padding:6px;text-align:right">Price</th><th style="padding:6px;text-align:right">Total</th></tr>
         ${itemRows}
       </table>
       <p><strong>Subtotal:</strong> ${Number(data.subtotal).toLocaleString()}</p>
       ${Number(data.tax_total) > 0 ? `<p><strong>Tax:</strong> ${Number(data.tax_total).toLocaleString()}</p>` : ""}
       ${Number(data.discount_amount) > 0 ? `<p><strong>Discount:</strong> -${Number(data.discount_amount).toLocaleString()}</p>` : ""}
       <p style="font-size:18px"><strong>Total: ${Number(data.total_amount).toLocaleString()}</strong></p>
       <p><strong>Balance Due: ${Number(data.balance_due).toLocaleString()}</strong></p>
       ${data.due_date ? `<p><strong>Due Date:</strong> ${data.due_date}</p>` : ""}
       ${data.notes ? `<p><em>${data.notes}</em></p>` : ""}
       ${footer("This invoice was generated by " + (data.company_name || "Our Store") + ".")}`
    ),
  };
}

function invoiceReminder(data) {
  return {
    subject: `Reminder: Invoice ${data.invoice_number} — ${Number(data.balance_due).toLocaleString()} due`,
    html: wrapEmailHtml(
      `Payment Reminder`,
      `<p>Hi ${data.customer_name || "Customer"},</p>
       <p>This is a friendly reminder that invoice <strong>${data.invoice_number}</strong> has a balance of <strong>${Number(data.balance_due).toLocaleString()}</strong>.</p>
       ${data.due_date ? `<p><strong>Due Date:</strong> ${data.due_date}</p>` : ""}
       <p>Please arrange payment at your earliest convenience.</p>
       ${footer("This reminder was sent by " + (data.company_name || "Our Store") + ".")}`
    ),
  };
}

// -- Customer statement (Tier 0.4 wholesale) ------------------------------
// Bank-style A/R statement: opening balance + chronological invoices,
// payments, credit reversals + closing balance. Data shape provided by
// routes/customers.js GET /api/customers/:id/statement.
function customerStatement(data) {
  const fmtMoney = (n) => Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const rows = (data.entries || [])
    .map((e) => {
      const debit = Number(e.debit || 0);
      const credit = Number(e.credit || 0);
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;color:#475569">${e.date_label || ""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px">${e.label || ""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;text-align:right;color:#0f172a">${debit > 0 ? fmtMoney(debit) : ""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;text-align:right;color:#059669">${credit > 0 ? fmtMoney(credit) : ""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;text-align:right;font-weight:600">${fmtMoney(e.running_balance)}</td>
      </tr>`;
    })
    .join("");

  return {
    subject: `Statement of account — ${data.customer_name || "Customer"} (${data.from} to ${data.to})`,
    html: wrapEmailHtml(
      `Statement of Account`,
      `<p>Hi ${data.customer_name || "Customer"},</p>
       <p>Below is your statement of account from <strong>${data.company_name || "Our Store"}</strong> covering <strong>${data.from}</strong> to <strong>${data.to}</strong>.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;font-family:sans-serif">
         <thead>
           <tr style="background:#f1f5f9">
             <th style="padding:8px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase">Date</th>
             <th style="padding:8px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase">Description</th>
             <th style="padding:8px;text-align:right;font-size:11px;color:#475569;text-transform:uppercase">Debit</th>
             <th style="padding:8px;text-align:right;font-size:11px;color:#475569;text-transform:uppercase">Credit</th>
             <th style="padding:8px;text-align:right;font-size:11px;color:#475569;text-transform:uppercase">Balance</th>
           </tr>
         </thead>
         <tbody>
           <tr style="background:#f8fafc">
             <td colspan="4" style="padding:8px;font-size:12px;font-weight:600;color:#475569">Opening balance as of ${data.from}</td>
             <td style="padding:8px;font-size:12px;text-align:right;font-weight:700">${fmtMoney(data.opening_balance)}</td>
           </tr>
           ${rows || `<tr><td colspan="5" style="padding:16px;text-align:center;color:#94a3b8;font-size:12px">No activity in this period</td></tr>`}
           <tr style="background:#ecfdf5">
             <td colspan="4" style="padding:8px;font-size:13px;font-weight:700;color:#065f46">Closing balance as of ${data.to}</td>
             <td style="padding:8px;font-size:13px;text-align:right;font-weight:800;color:#065f46">${fmtMoney(data.closing_balance)}</td>
           </tr>
         </tbody>
       </table>
       <p style="font-size:13px;color:#475569">
         <strong>Period activity:</strong> ${fmtMoney(data.period_debits)} debits / ${fmtMoney(data.period_credits)} credits
       </p>
       ${data.closing_balance > 0 ? `<p style="font-size:13px;color:#b45309"><strong>Amount due:</strong> ${fmtMoney(data.closing_balance)}. Please arrange payment at your earliest convenience.</p>` : `<p style="font-size:13px;color:#059669">Your account is settled. Thank you.</p>`}
       ${footer("This statement was generated by " + (data.company_name || "Our Store") + ".")}`
    ),
  };
}

// -- Subscription renewal notifications -----------------------------------

function subscriptionRenewalAdmin(data) {
  return {
    subject: `Subscription renewal: ${data.customer_name} — ${data.plan_name}`,
    html: wrapEmailHtml(
      "Subscription Renewal Generated",
      `<p>A renewal invoice has been generated:</p>
       <p><strong>Customer:</strong> ${data.customer_name || "N/A"}</p>
       <p><strong>Plan:</strong> ${data.plan_name}</p>
       <p><strong>Amount:</strong> ${Number(data.amount).toLocaleString()}</p>
       <p><strong>Invoice #:</strong> ${data.invoice_number}</p>
       <p>The customer should be contacted for payment.</p>
       ${footer("This is an automated admin notification.")}`
    ),
  };
}

// -- Booking Confirmation (public booking page) ---------------------------
function bookingConfirmation(data) {
  const {
    storeName,
    customerName,
    serviceName,
    staffName,
    startAt,
    endAt,
    duration,
    notes,
    bookingId,
    storeAddress,
    storePhone,
    status,
    icsUrl,
  } = data || {};

  const pending = status === "pending";
  const title = pending ? "Booking Received" : "Booking Confirmed";
  const heading = pending ? "Your booking is pending confirmation" : "Your booking is confirmed";

  let startDisplay = startAt;
  let endDisplay = endAt;
  try {
    if (startAt) startDisplay = new Date(startAt).toLocaleString();
    if (endAt) endDisplay = new Date(endAt).toLocaleString();
  } catch { /* leave as-is */ }

  return {
    subject: pending
      ? `Booking received — ${storeName || "our store"}`
      : `Booking confirmed — ${storeName || "our store"}`,
    html: wrapEmailHtml(
      title,
      `<p>Hi ${customerName || "there"},</p>
       <p>${heading} at <strong>${storeName || "our store"}</strong>.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f0fdf4;border-radius:8px">
         ${serviceName ? `<tr><td style="padding:10px 16px;color:#64748b">Service</td><td style="padding:10px 16px;font-weight:600">${serviceName}</td></tr>` : ""}
         ${staffName ? `<tr><td style="padding:10px 16px;color:#64748b">With</td><td style="padding:10px 16px">${staffName}</td></tr>` : ""}
         <tr><td style="padding:10px 16px;color:#64748b">Starts</td><td style="padding:10px 16px;font-weight:600">${startDisplay || ""}</td></tr>
         ${endDisplay ? `<tr><td style="padding:10px 16px;color:#64748b">Ends</td><td style="padding:10px 16px">${endDisplay}</td></tr>` : ""}
         ${duration ? `<tr><td style="padding:10px 16px;color:#64748b">Duration</td><td style="padding:10px 16px">${duration} min</td></tr>` : ""}
         <tr><td style="padding:10px 16px;color:#64748b">Booking #</td><td style="padding:10px 16px;font-weight:600">${bookingId || ""}</td></tr>
       </table>
       ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ""}
       ${icsUrl ? btn("Add to calendar", icsUrl) : ""}
       ${(storeAddress || storePhone) ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
         <p style="color:#475569;margin:0 0 4px"><strong>${storeName || "Our store"}</strong></p>
         ${storeAddress ? `<p style="color:#64748b;font-size:14px;margin:0 0 4px">${storeAddress}</p>` : ""}
         ${storePhone ? `<p style="color:#64748b;font-size:14px;margin:0">If you need to cancel or reschedule, please call ${storePhone}.</p>` : ""}` : ""}
       ${footer("This is an automated confirmation of your booking.")}`
    ),
  };
}

function subscriptionRenewalDue(data) {
  return {
    subject: `Your subscription renewal is due — ${data.plan_name}`,
    html: wrapEmailHtml(
      "Subscription Renewal Due",
      `<p>Hi ${data.customer_name || "Customer"},</p>
       <p>Your <strong>${data.plan_name}</strong> subscription has been renewed.</p>
       <p><strong>Amount:</strong> ${Number(data.amount).toLocaleString()}</p>
       <p><strong>Period:</strong> ${data.period_start || ""} to ${data.period_end || ""}</p>
       <p>Please arrange payment to keep your subscription active.</p>
       ${footer("This notification was sent by " + (data.company_name || "Our Store") + ".")}`
    ),
  };
}

function rentalOverdue(data) {
  const {
    storeName,
    customerName,
    contractNumber,
    itemNames,
    expectedReturn,
    daysOverdue,
    contactUrl,
  } = data;
  let expectedDisplay = expectedReturn;
  try {
    if (expectedReturn) expectedDisplay = new Date(expectedReturn).toLocaleString();
  } catch { /* leave as-is */ }
  return {
    subject: `Overdue rental — ${contractNumber}`,
    html: wrapEmailHtml(
      "Rental Overdue",
      `<p>Hi ${customerName || "Customer"},</p>
       <p>Our records show your rental from <strong>${storeName || "our store"}</strong> is past its expected return date.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#fef2f2;border-radius:8px">
         <tr><td style="padding:10px 16px;color:#64748b">Contract</td><td style="padding:10px 16px;font-weight:600">${contractNumber || ""}</td></tr>
         ${itemNames ? `<tr><td style="padding:10px 16px;color:#64748b">Item(s)</td><td style="padding:10px 16px">${itemNames}</td></tr>` : ""}
         <tr><td style="padding:10px 16px;color:#64748b">Expected return</td><td style="padding:10px 16px;color:#b91c1c;font-weight:600">${expectedDisplay || ""}</td></tr>
         <tr><td style="padding:10px 16px;color:#64748b">Days overdue</td><td style="padding:10px 16px;color:#b91c1c;font-weight:700">${daysOverdue || 0}</td></tr>
       </table>
       <p>Please return the item as soon as possible. A late fee may apply to your final invoice.</p>
       ${contactUrl ? btn("Contact the store", contactUrl) : ""}
       ${footer("This is an automated overdue notice.")}`
    ),
  };
}

// -- Customer Portal (M8) -------------------------------------------------
function fmtDateTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
}

function customerPortalWelcome({ storeName, customerName, portalUrl }) {
  return {
    subject: `Welcome to ${storeName} — your customer portal is ready`,
    html: wrapEmailHtml("Portal Access", `
      <p>Hi ${customerName || "there"},</p>
      <p>Your account at <strong>${storeName}</strong> is now set up. From the portal you can view invoices, book appointments, and manage your profile.</p>
      ${portalUrl ? btn("Open your portal", portalUrl) : ""}
      ${footer("You're receiving this because you just signed up for the customer portal.")}
    `),
  };
}

function customerPortalOtpLogin({ storeName, customerName, code }) {
  return {
    subject: `Your login code for ${storeName}`,
    html: wrapEmailHtml("Login Code", `
      <p>Hi ${customerName || "there"},</p>
      <p>Enter this code to sign in to the <strong>${storeName}</strong> customer portal:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:700;background:#f1f5f9;padding:16px;border-radius:8px;text-align:center;margin:24px 0">${code}</p>
      <p style="color:#64748b">This code expires in 15 minutes. If you didn't request it, you can ignore this email.</p>
    `),
  };
}

function customerPortalPasswordReset({ storeName, customerName, code, resetUrl, expiresInMinutes }) {
  const body = resetUrl
    ? `${btn("Reset your password", resetUrl)}<p style="color:#64748b">This link expires in ${expiresInMinutes || 60} minutes.</p>`
    : `<p style="font-size:28px;letter-spacing:6px;font-weight:700;background:#f1f5f9;padding:16px;border-radius:8px;text-align:center;margin:24px 0">${code}</p><p style="color:#64748b">This code expires in 15 minutes.</p>`;
  return {
    subject: `Reset your password — ${storeName}`,
    html: wrapEmailHtml("Password Reset", `
      <p>Hi ${customerName || "there"},</p>
      <p>We received a request to reset your password for the <strong>${storeName}</strong> portal.</p>
      ${body}
      <p style="color:#64748b">If you didn't request this, you can ignore this email — your password will remain unchanged.</p>
    `),
  };
}

function customerPortalEmailVerify({ storeName, customerName, code }) {
  return {
    subject: `Verify your email — ${storeName}`,
    html: wrapEmailHtml("Verify Email", `
      <p>Hi ${customerName || "there"},</p>
      <p>Thanks for signing up to the <strong>${storeName}</strong> customer portal. Enter this code to confirm your email address:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:700;background:#f1f5f9;padding:16px;border-radius:8px;text-align:center;margin:24px 0">${code}</p>
      <p style="color:#64748b">This code expires in 15 minutes.</p>
    `),
  };
}

function customerPortalAppointmentConfirmation({ storeName, customerName, serviceName, startAt, endAt, status, storeAddress, storePhone }) {
  return {
    subject: `Appointment ${status === "pending" ? "requested" : "confirmed"} — ${storeName}`,
    html: wrapEmailHtml("Appointment", `
      <p>Hi ${customerName || "there"},</p>
      <p>Your appointment at <strong>${storeName}</strong> is ${status === "pending" ? "pending confirmation" : "confirmed"}.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f0fdf4;border-radius:8px">
        <tr><td style="padding:10px 16px;color:#64748b">Service</td><td style="padding:10px 16px;font-weight:600">${serviceName}</td></tr>
        <tr><td style="padding:10px 16px;color:#64748b">Starts</td><td style="padding:10px 16px;font-weight:600">${fmtDateTime(startAt)}</td></tr>
        <tr><td style="padding:10px 16px;color:#64748b">Ends</td><td style="padding:10px 16px">${fmtDateTime(endAt)}</td></tr>
        ${storeAddress ? `<tr><td style="padding:10px 16px;color:#64748b">Address</td><td style="padding:10px 16px">${storeAddress}</td></tr>` : ""}
        ${storePhone ? `<tr><td style="padding:10px 16px;color:#64748b">Phone</td><td style="padding:10px 16px">${storePhone}</td></tr>` : ""}
      </table>
      ${footer("Manage or reschedule this booking from your customer portal.")}
    `),
  };
}

function customerPortalAppointmentRescheduled({ storeName, customerName, serviceName, oldStartAt, newStartAt, endAt }) {
  return {
    subject: `Appointment rescheduled — ${storeName}`,
    html: wrapEmailHtml("Rescheduled", `
      <p>Hi ${customerName || "there"},</p>
      <p>Your <strong>${serviceName}</strong> appointment at <strong>${storeName}</strong> has been moved.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:10px 16px;color:#64748b">Was</td><td style="padding:10px 16px;text-decoration:line-through">${fmtDateTime(oldStartAt)}</td></tr>
        <tr><td style="padding:10px 16px;color:#64748b">Now</td><td style="padding:10px 16px;font-weight:700;color:#059669">${fmtDateTime(newStartAt)}</td></tr>
        <tr><td style="padding:10px 16px;color:#64748b">Ends</td><td style="padding:10px 16px">${fmtDateTime(endAt)}</td></tr>
      </table>
      ${footer("If this change wasn't you, please contact the store.")}
    `),
  };
}

function customerPortalAppointmentCancelled({ storeName, customerName, serviceName, startAt, reason }) {
  return {
    subject: `Appointment cancelled — ${storeName}`,
    html: wrapEmailHtml("Cancelled", `
      <p>Hi ${customerName || "there"},</p>
      <p>Your <strong>${serviceName}</strong> appointment at <strong>${storeName}</strong> scheduled for ${fmtDateTime(startAt)} has been cancelled.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      ${footer("You can book a new appointment any time from your customer portal.")}
    `),
  };
}

function customerPortalPaymentReceipt({ storeName, customerName, invoiceNumber, amount, paidAt, method }) {
  return {
    subject: `Payment received — ${storeName} invoice ${invoiceNumber}`,
    html: wrapEmailHtml("Payment Received", `
      <p>Hi ${customerName || "there"},</p>
      <p>We've received your payment for <strong>${storeName}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f0fdf4;border-radius:8px">
        <tr><td style="padding:10px 16px;color:#64748b">Invoice</td><td style="padding:10px 16px;font-weight:600">${invoiceNumber}</td></tr>
        <tr><td style="padding:10px 16px;color:#64748b">Amount</td><td style="padding:10px 16px;font-weight:600">${amount}</td></tr>
        <tr><td style="padding:10px 16px;color:#64748b">Method</td><td style="padding:10px 16px">${method || "online"}</td></tr>
        <tr><td style="padding:10px 16px;color:#64748b">Paid at</td><td style="padding:10px 16px">${fmtDateTime(paidAt)}</td></tr>
      </table>
      ${footer("Thank you for your payment.")}
    `),
  };
}

// -- M9 Room Management --------------------------------------------------
function roomBookingConfirmation({ storeName, guestName, bookingNumber, roomType, checkInDate, checkOutDate, nights, subtotal, depositPaymentUrl }) {
  return {
    subject: `Booking confirmed — ${bookingNumber}`,
    html: wrapEmailHtml("Stay Confirmed", `
      <p>Hi ${guestName || "Guest"},</p>
      <p>Your booking at <strong>${storeName || "our property"}</strong> is confirmed.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f0fdf4;border-radius:8px">
        <tr><td style="padding:10px 16px;color:#64748b">Booking</td><td style="padding:10px 16px;font-weight:600">${bookingNumber || ""}</td></tr>
        ${roomType ? `<tr><td style="padding:10px 16px;color:#64748b">Room</td><td style="padding:10px 16px">${roomType}</td></tr>` : ""}
        <tr><td style="padding:10px 16px;color:#64748b">Check-in</td><td style="padding:10px 16px;font-weight:600">${checkInDate || ""}</td></tr>
        <tr><td style="padding:10px 16px;color:#64748b">Check-out</td><td style="padding:10px 16px;font-weight:600">${checkOutDate || ""}</td></tr>
        <tr><td style="padding:10px 16px;color:#64748b">Nights</td><td style="padding:10px 16px">${nights || 0}</td></tr>
        ${subtotal ? `<tr><td style="padding:10px 16px;color:#64748b">Room total</td><td style="padding:10px 16px;font-weight:600">${subtotal}</td></tr>` : ""}
      </table>
      ${depositPaymentUrl ? btn("Pay your security deposit", depositPaymentUrl) : ""}
      ${footer("We look forward to your stay. Present this email at check-in.")}
    `),
  };
}

function roomDepositReceived({ storeName, guestName, bookingNumber, amount }) {
  return {
    subject: `Deposit received — ${bookingNumber}`,
    html: wrapEmailHtml("Deposit Received", `
      <p>Hi ${guestName || "Guest"},</p>
      <p>We've received your security deposit of <strong>${amount}</strong> for booking <strong>${bookingNumber}</strong> at <strong>${storeName}</strong>.</p>
      <p>The deposit is held as a pre-authorization and will be released after check-out if no damage or extra charges are incurred.</p>
      ${footer("Thank you — we look forward to welcoming you.")}
    `),
  };
}

function roomCheckinReminder({ storeName, guestName, bookingNumber, checkInDate, roomType, storeAddress, storePhone }) {
  return {
    subject: `Your stay at ${storeName} is tomorrow`,
    html: wrapEmailHtml("See you soon", `
      <p>Hi ${guestName || "Guest"},</p>
      <p>Just a reminder that your stay at <strong>${storeName}</strong> begins on <strong>${checkInDate}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:10px 16px;color:#64748b">Booking</td><td style="padding:10px 16px;font-weight:600">${bookingNumber || ""}</td></tr>
        ${roomType ? `<tr><td style="padding:10px 16px;color:#64748b">Room</td><td style="padding:10px 16px">${roomType}</td></tr>` : ""}
        ${storeAddress ? `<tr><td style="padding:10px 16px;color:#64748b">Address</td><td style="padding:10px 16px">${storeAddress}</td></tr>` : ""}
        ${storePhone ? `<tr><td style="padding:10px 16px;color:#64748b">Phone</td><td style="padding:10px 16px">${storePhone}</td></tr>` : ""}
      </table>
      ${footer("Safe travels.")}
    `),
  };
}

function roomFolioReceipt({ storeName, guestName, bookingNumber, invoiceNumber, grandTotal, depositApplied, depositStatus, balanceDue, invoiceUrl }) {
  const depositLine = depositApplied
    ? `<tr><td style="padding:10px 16px;color:#64748b">Deposit applied</td><td style="padding:10px 16px">−${depositApplied} (${depositStatus || "—"})</td></tr>`
    : "";
  return {
    subject: `Thanks for staying with us — ${invoiceNumber || bookingNumber}`,
    html: wrapEmailHtml("Folio & Invoice", `
      <p>Hi ${guestName || "Guest"},</p>
      <p>Thanks for staying at <strong>${storeName}</strong>. Here is a summary of your final bill.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f1f5f9;border-radius:8px">
        <tr><td style="padding:10px 16px;color:#64748b">Booking</td><td style="padding:10px 16px;font-weight:600">${bookingNumber || ""}</td></tr>
        ${invoiceNumber ? `<tr><td style="padding:10px 16px;color:#64748b">Invoice</td><td style="padding:10px 16px;font-weight:600">${invoiceNumber}</td></tr>` : ""}
        <tr><td style="padding:10px 16px;color:#64748b">Grand total</td><td style="padding:10px 16px;font-weight:700">${grandTotal || 0}</td></tr>
        ${depositLine}
        <tr><td style="padding:10px 16px;color:#64748b">Balance due</td><td style="padding:10px 16px;font-weight:700;color:${Number(balanceDue) > 0 ? "#b91c1c" : "#059669"}">${balanceDue || 0}</td></tr>
      </table>
      ${invoiceUrl ? btn("View invoice", invoiceUrl) : ""}
      ${footer("We hope to welcome you back.")}
    `),
  };
}

function roomOverdueCheckout({ storeName, guestName, bookingNumber, roomNumber, checkOutDate, daysOverdue }) {
  return {
    subject: `Overdue check-out — ${bookingNumber}`,
    html: wrapEmailHtml(
      "Overdue Check-out",
      `<p>Guest <strong>${guestName || "(unknown)"}</strong> is past the scheduled check-out date for booking <strong>${bookingNumber}</strong> at <strong>${storeName || "this property"}</strong>.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#fef2f2;border-radius:8px">
         <tr><td style="padding:10px 16px;color:#64748b">Room</td><td style="padding:10px 16px;font-weight:600">${roomNumber || "—"}</td></tr>
         <tr><td style="padding:10px 16px;color:#64748b">Check-out date</td><td style="padding:10px 16px;color:#b91c1c;font-weight:600">${checkOutDate || ""}</td></tr>
         <tr><td style="padding:10px 16px;color:#64748b">Days overdue</td><td style="padding:10px 16px;color:#b91c1c;font-weight:700">${daysOverdue || 0}</td></tr>
       </table>
       <p>Please contact the guest and process check-out or extend the stay.</p>
       ${footer("This is an automated staff alert.")}`
    ),
  };
}

// -- M10 Treatment Plans --------------------------------------------------

function treatmentPlanCreated({ storeName, customerName, planNumber, planTitle, totalSessions, depositAmount, nextSessionDate, portalUrl }) {
  let nextDisplay = nextSessionDate;
  try { if (nextSessionDate) nextDisplay = new Date(nextSessionDate).toLocaleString(); } catch {}
  return {
    subject: `Your treatment plan — ${planNumber}`,
    html: wrapEmailHtml(
      "Treatment Plan Created",
      `<p>Hi ${customerName || "there"},</p>
       <p>Your treatment plan at <strong>${storeName || "the clinic"}</strong> has been set up.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px">
         <tr><td style="padding:10px 16px;color:#64748b">Plan</td><td style="padding:10px 16px;font-weight:600">${planNumber || ""}</td></tr>
         ${planTitle ? `<tr><td style="padding:10px 16px;color:#64748b">Treatment</td><td style="padding:10px 16px">${planTitle}</td></tr>` : ""}
         ${totalSessions ? `<tr><td style="padding:10px 16px;color:#64748b">Sessions planned</td><td style="padding:10px 16px">${totalSessions}</td></tr>` : ""}
         ${depositAmount ? `<tr><td style="padding:10px 16px;color:#64748b">Deposit received</td><td style="padding:10px 16px;color:#059669;font-weight:600">${depositAmount}</td></tr>` : ""}
         ${nextDisplay ? `<tr><td style="padding:10px 16px;color:#64748b">Next session</td><td style="padding:10px 16px;font-weight:600">${nextDisplay}</td></tr>` : ""}
       </table>
       ${portalUrl ? btn("View in portal", portalUrl) : ""}
       ${footer("You can review and manage your plan in the patient portal.")}`
    ),
  };
}

function treatmentSessionReminder({ storeName, customerName, planNumber, sessionNumber, providerName, scheduledAt, portalUrl }) {
  let when = scheduledAt;
  try { if (scheduledAt) when = new Date(scheduledAt).toLocaleString(); } catch {}
  return {
    subject: `Reminder — session ${sessionNumber || ""} tomorrow`,
    html: wrapEmailHtml(
      "Upcoming Session",
      `<p>Hi ${customerName || "there"},</p>
       <p>This is a friendly reminder of your upcoming session at <strong>${storeName || "the clinic"}</strong>.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#eff6ff;border-radius:8px">
         <tr><td style="padding:10px 16px;color:#64748b">Plan</td><td style="padding:10px 16px;font-weight:600">${planNumber || ""}</td></tr>
         ${sessionNumber ? `<tr><td style="padding:10px 16px;color:#64748b">Session</td><td style="padding:10px 16px">#${sessionNumber}</td></tr>` : ""}
         ${providerName ? `<tr><td style="padding:10px 16px;color:#64748b">Provider</td><td style="padding:10px 16px">${providerName}</td></tr>` : ""}
         <tr><td style="padding:10px 16px;color:#64748b">When</td><td style="padding:10px 16px;font-weight:600">${when || ""}</td></tr>
       </table>
       <p>Please arrive 10 minutes early. If you need to reschedule, contact us as soon as possible.</p>
       ${portalUrl ? btn("View in portal", portalUrl) : ""}
       ${footer("This is an automated reminder.")}`
    ),
  };
}

function treatmentSessionCompleted({ storeName, customerName, planNumber, sessionNumber, soapSubjective, prescriptions, nextSessionDate, portalUrl }) {
  let nextDisplay = nextSessionDate;
  try { if (nextSessionDate) nextDisplay = new Date(nextSessionDate).toLocaleString(); } catch {}
  const rxList = Array.isArray(prescriptions) && prescriptions.length
    ? `<ul style="margin:8px 0 16px 24px;padding:0">${prescriptions.map((p) => `<li style="margin:4px 0">${p.medication_name}${p.strength ? ` ${p.strength}` : ""}${p.dosage ? ` — ${p.dosage}` : ""}</li>`).join("")}</ul>`
    : "";
  return {
    subject: `Session summary — ${planNumber}`,
    html: wrapEmailHtml(
      "Session Summary",
      `<p>Hi ${customerName || "there"},</p>
       <p>Here's a summary of your session at <strong>${storeName || "the clinic"}</strong>.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px">
         <tr><td style="padding:10px 16px;color:#64748b">Plan</td><td style="padding:10px 16px;font-weight:600">${planNumber || ""}</td></tr>
         ${sessionNumber ? `<tr><td style="padding:10px 16px;color:#64748b">Session</td><td style="padding:10px 16px">#${sessionNumber}</td></tr>` : ""}
         ${nextDisplay ? `<tr><td style="padding:10px 16px;color:#64748b">Next session</td><td style="padding:10px 16px;font-weight:600">${nextDisplay}</td></tr>` : ""}
       </table>
       ${soapSubjective ? `<p style="margin-top:16px"><strong>Visit notes:</strong><br>${soapSubjective}</p>` : ""}
       ${rxList ? `<p style="margin-top:16px"><strong>Prescriptions:</strong></p>${rxList}` : ""}
       ${portalUrl ? btn("View full record in portal", portalUrl) : ""}
       ${footer("Your full record is available in the patient portal.")}`
    ),
  };
}

function treatmentPlanCompleted({ storeName, customerName, planNumber, planTitle, totalSessions, invoiceUrl, portalUrl }) {
  return {
    subject: `Treatment complete — ${planNumber}`,
    html: wrapEmailHtml(
      "Treatment Plan Completed",
      `<p>Hi ${customerName || "there"},</p>
       <p>Congratulations — your treatment plan at <strong>${storeName || "the clinic"}</strong> is complete.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#ecfdf5;border-radius:8px">
         <tr><td style="padding:10px 16px;color:#64748b">Plan</td><td style="padding:10px 16px;font-weight:600">${planNumber || ""}</td></tr>
         ${planTitle ? `<tr><td style="padding:10px 16px;color:#64748b">Treatment</td><td style="padding:10px 16px">${planTitle}</td></tr>` : ""}
         ${totalSessions ? `<tr><td style="padding:10px 16px;color:#64748b">Sessions completed</td><td style="padding:10px 16px;color:#059669;font-weight:700">${totalSessions}</td></tr>` : ""}
       </table>
       <p>Follow-up care instructions and your final invoice are available below.</p>
       ${invoiceUrl ? btn("View final invoice", invoiceUrl) : ""}
       ${portalUrl ? `<p style="margin-top:12px"><a href="${portalUrl}" style="color:#2563eb">Open patient portal</a></p>` : ""}
       ${footer("Thank you for trusting us with your care.")}`
    ),
  };
}

function treatmentPlanOverdue({ storeName, providerName, planNumber, customerName, sessionsCompleted, sessionsPlanned, daysOverdue }) {
  return {
    subject: `Overdue treatment plan — ${planNumber}`,
    html: wrapEmailHtml(
      "Overdue Treatment Plan",
      `<p>Hi ${providerName || "Provider"},</p>
       <p>Plan <strong>${planNumber}</strong> at <strong>${storeName || "the clinic"}</strong> has not completed within the expected window.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#fef2f2;border-radius:8px">
         <tr><td style="padding:10px 16px;color:#64748b">Patient</td><td style="padding:10px 16px;font-weight:600">${customerName || ""}</td></tr>
         <tr><td style="padding:10px 16px;color:#64748b">Progress</td><td style="padding:10px 16px">${sessionsCompleted || 0} / ${sessionsPlanned || 0} sessions</td></tr>
         <tr><td style="padding:10px 16px;color:#64748b">Days overdue</td><td style="padding:10px 16px;color:#b91c1c;font-weight:700">${daysOverdue || 0}</td></tr>
       </table>
       <p>Please follow up with the patient to reschedule or discontinue the plan.</p>
       ${footer("This is an automated staff alert.")}`
    ),
  };
}

function treatmentLabResultReceived({ storeName, customerName, planNumber, testName, labVendor, portalUrl }) {
  return {
    subject: `Lab result available — ${testName || planNumber}`,
    html: wrapEmailHtml(
      "Lab Result Available",
      `<p>Hi ${customerName || "there"},</p>
       <p>A lab result has been received for your treatment at <strong>${storeName || "the clinic"}</strong>.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px">
         <tr><td style="padding:10px 16px;color:#64748b">Plan</td><td style="padding:10px 16px;font-weight:600">${planNumber || ""}</td></tr>
         ${testName ? `<tr><td style="padding:10px 16px;color:#64748b">Test</td><td style="padding:10px 16px">${testName}</td></tr>` : ""}
         ${labVendor ? `<tr><td style="padding:10px 16px;color:#64748b">Lab</td><td style="padding:10px 16px">${labVendor}</td></tr>` : ""}
       </table>
       ${portalUrl ? btn("View in portal", portalUrl) : ""}
       ${footer("Please review the result in the patient portal or contact your provider with any questions.")}`
    ),
  };
}

// -- Phase 2-G Wave 2 (2-G.2) Gift Card Issued ---------------------------
function giftCardIssued(data) {
  const {
    storeName,
    recipientName,
    code,
    initialValue,
    currencySymbol,
    balanceUrl,
    note,
  } = data || {};
  const pretty = (n) => {
    if (!Number.isFinite(Number(n))) return String(n);
    return Number(n).toLocaleString();
  };
  const symbol = currencySymbol || "PKR";
  return {
    subject: `You received a gift card from ${storeName || "us"}`,
    html: wrapEmailHtml(
      "Gift Card",
      `<p>Hi ${recipientName || "there"},</p>
       <p>You've received a gift card from <strong>${storeName || "our store"}</strong>.</p>
       ${note ? `<p style="color:#475569;font-style:italic">&ldquo;${note}&rdquo;</p>` : ""}
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f0fdf4;border-radius:8px">
         <tr>
           <td style="padding:14px 16px;color:#64748b">Balance</td>
           <td style="padding:14px 16px;font-weight:700;font-size:22px;color:#065f46">${symbol} ${pretty(initialValue)}</td>
         </tr>
         <tr>
           <td style="padding:14px 16px;color:#64748b">Code</td>
           <td style="padding:14px 16px;font-family:monospace;font-size:18px;letter-spacing:2px;font-weight:700;color:#0f172a">${code || ""}</td>
         </tr>
       </table>
       ${balanceUrl ? `<p style="margin:16px 0"><a href="${balanceUrl}" style="display:inline-block;padding:10px 20px;background:#059669;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Check balance anytime</a></p>` : ""}
       <p style="color:#64748b;font-size:13px;margin-top:24px">Show this code at checkout to redeem. The balance is good until depleted — no expiry.</p>`,
    ),
  };
}

// 2-G.16 Merchant home: weekly digest email wraps the existing digest HTML
// builder. Data payload mirrors the dashboard response so buildDigestEmailHtml
// can format it without a second query round-trip.
function retailWeeklyDigest({ companyName, dateStr, data }) {
  const { buildDigestEmailHtml } = require("../utils/digestEmail");
  return {
    subject: `Your weekly snapshot — ${companyName || "SanoPOS"}`,
    html: buildDigestEmailHtml(data || {}, companyName || "SanoPOS", dateStr || ""),
  };
}

// -- Tier 1.4 Manufacturer Portal -----------------------------------------
// Sent when a distributor invites a manufacturer-partner to monitor secondary
// sales of their brand. Contains a one-shot signup link that lands on the
// /manufacturer-portal/setup page where they set a password.
function manufacturerPartnerPasswordReset({ storeName, contactName, resetUrl, expiresInHours }) {
  return {
    subject: `Reset your ${storeName || "manufacturer portal"} password`,
    html: wrapEmailHtml("Password Reset", `
      <p>Hi ${contactName || "there"},</p>
      <p>We received a request to reset your password for the <strong>${storeName || "manufacturer"}</strong> portal. Click the button below to choose a new password.</p>
      ${resetUrl ? btn("Reset password", resetUrl) : ""}
      <p style="color:#64748b">This link expires in ${expiresInHours || 1} hour. If you didn't request a reset, you can safely ignore this email — your current password will still work.</p>
      ${footer("You're receiving this because a password reset was requested for your SanoPOS manufacturer-portal account.")}
    `),
  };
}

function manufacturerPartnerInvite({ storeName, contactName, brandList, setupUrl, expiresInDays }) {
  const brands = Array.isArray(brandList) && brandList.length
    ? brandList.join(", ")
    : "your brand";
  return {
    subject: `${storeName || "Your distributor"} has invited you to monitor ${brands} sales`,
    html: wrapEmailHtml("Manufacturer Portal Access", `
      <p>Hi ${contactName || "there"},</p>
      <p><strong>${storeName || "Your distributor"}</strong> has invited you to their manufacturer portal where you can monitor real-time onward sales of <strong>${brands}</strong> through their distribution network.</p>
      <p>You'll see daily sales volumes, SKU-level performance, regional breakdown, and scheme impact — all aggregated, with retailer identities never exposed.</p>
      ${setupUrl ? btn("Set up your account", setupUrl) : ""}
      <p style="color:#64748b">This invite link expires in ${expiresInDays || 7} days. Click it to set your password and access the portal.</p>
      ${footer("You're receiving this because a SanoPOS distributor added you as a manufacturer-partner. If you weren't expecting this, you can safely ignore the email.")}
    `),
  };
}

// -- F05 Customer Notifications: repair/service ticket status -------------
// Shared renderer — one builder per status keeps the notification_rules
// template_key → email TEMPLATES lookup 1:1. Data shape comes from the
// service-tickets consumer (services/service-tickets.js).
function ticketStatusEmail(headline, lead) {
  return (data) => {
    const { storeName, customerName, ticketNumber, ticketTitle, storePhone } = data || {};
    return {
      subject: `${headline}${ticketNumber ? ` — ${ticketNumber}` : ""}`,
      html: wrapEmailHtml(
        headline,
        `<p>Hi ${customerName || "there"},</p>
         <p>${lead} at <strong>${storeName || "our store"}</strong>.</p>
         <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px">
           ${ticketNumber ? `<tr><td style="padding:10px 16px;color:#64748b">Reference</td><td style="padding:10px 16px;font-weight:600">${ticketNumber}</td></tr>` : ""}
           ${ticketTitle ? `<tr><td style="padding:10px 16px;color:#64748b">Item</td><td style="padding:10px 16px">${ticketTitle}</td></tr>` : ""}
         </table>
         ${storePhone ? `<p style="color:#64748b;font-size:14px">Questions? Call us at ${storePhone}.</p>` : ""}
         ${footer("This is an automated update about your service request.")}`
      ),
    };
  };
}
const ticketApproved = ticketStatusEmail("Your repair has been approved", "Good news — your service request has been approved and queued");
const ticketInProgress = ticketStatusEmail("Your repair is in progress", "Work has started on your service request");
const ticketCompleted = ticketStatusEmail("Your item is ready for pickup", "Your service request is complete and ready for collection");
const ticketInvoiced = ticketStatusEmail("Your invoice is ready", "An invoice has been prepared for your completed service request");

// -- F05: appointment reminder (email channel of the reminders engine) ----
function appointmentReminder(data) {
  const { storeName, customerName, serviceName, staffName, apptStart } = data || {};
  let when = apptStart;
  try { if (apptStart) when = new Date(apptStart).toLocaleString(); } catch { /* leave as-is */ }
  return {
    subject: `Reminder: ${serviceName || "your appointment"}${storeName ? ` at ${storeName}` : ""}`,
    html: wrapEmailHtml(
      "Appointment Reminder",
      `<p>Hi ${customerName || "there"},</p>
       <p>This is a reminder for your upcoming appointment at <strong>${storeName || "our store"}</strong>.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#eff6ff;border-radius:8px">
         ${serviceName ? `<tr><td style="padding:10px 16px;color:#64748b">Service</td><td style="padding:10px 16px;font-weight:600">${serviceName}</td></tr>` : ""}
         ${staffName ? `<tr><td style="padding:10px 16px;color:#64748b">With</td><td style="padding:10px 16px">${staffName}</td></tr>` : ""}
         <tr><td style="padding:10px 16px;color:#64748b">When</td><td style="padding:10px 16px;font-weight:600">${when || ""}</td></tr>
       </table>
       ${footer("This is an automated appointment reminder.")}`
    ),
  };
}

// -- Template Registry ----------------------------------------------------
const TEMPLATES = {
  // F05 customer notifications (status-change engine)
  ticket_approved: ticketApproved,
  ticket_in_progress: ticketInProgress,
  ticket_completed: ticketCompleted,
  ticket_invoiced: ticketInvoiced,
  appointment_reminder: appointmentReminder,
  campaign_test: campaignTest,
  customer_invoice: customerInvoice,
  customer_statement: customerStatement,
  invoice_reminder: invoiceReminder,
  drip_getting_started: dripGettingStarted,
  drip_features: dripFeatures,
  billing_payment_recorded: billingPaymentRecorded,
  billing_plan_changed: billingPlanChanged,
  billing_expiry_warning: billingExpiryWarning,
  billing_overdue: billingOverdue,
  support_received: supportReceived,
  support_resolved: supportResolved,
  trial_warning: trialWarning,
  trial_ended: trialEnded,
  account_locked: accountLocked,
  renewal_due: renewalDue,
  renewal_overdue: renewalOverdue,
  downtime,
  announcement,
  subscription_renewal_admin: subscriptionRenewalAdmin,
  subscription_renewal_due: subscriptionRenewalDue,
  booking_confirmation: bookingConfirmation,
  rental_overdue: rentalOverdue,
  // M9 Room Management
  room_booking_confirmation: roomBookingConfirmation,
  room_deposit_received: roomDepositReceived,
  room_checkin_reminder: roomCheckinReminder,
  room_folio_receipt: roomFolioReceipt,
  room_overdue_checkout: roomOverdueCheckout,
  // M10 Treatment Plans
  treatment_plan_created: treatmentPlanCreated,
  treatment_session_reminder: treatmentSessionReminder,
  treatment_session_completed: treatmentSessionCompleted,
  treatment_plan_completed: treatmentPlanCompleted,
  treatment_plan_overdue: treatmentPlanOverdue,
  treatment_lab_result_received: treatmentLabResultReceived,
  // M8 Customer Portal
  customer_portal_welcome: customerPortalWelcome,
  customer_portal_otp_login: customerPortalOtpLogin,
  customer_portal_password_reset: customerPortalPasswordReset,
  customer_portal_email_verify: customerPortalEmailVerify,
  customer_portal_appointment_confirmation: customerPortalAppointmentConfirmation,
  customer_portal_appointment_rescheduled: customerPortalAppointmentRescheduled,
  customer_portal_appointment_cancelled: customerPortalAppointmentCancelled,
  customer_portal_payment_receipt: customerPortalPaymentReceipt,
  // Phase 2-G Wave 2 (2-G.2)
  gift_card_issued: giftCardIssued,
  // Phase 2-G Wave 6 (2-G.16)
  retail_weekly_digest: retailWeeklyDigest,
  // Tier 1.4 Manufacturer Portal
  manufacturer_partner_invite: manufacturerPartnerInvite,
  manufacturer_partner_password_reset: manufacturerPartnerPasswordReset,
};

module.exports = { TEMPLATES, wrapEmailHtml };
