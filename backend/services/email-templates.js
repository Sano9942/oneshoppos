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

// -- Template Registry ----------------------------------------------------
const TEMPLATES = {
  campaign_test: campaignTest,
  customer_invoice: customerInvoice,
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
};

module.exports = { TEMPLATES, wrapEmailHtml };
