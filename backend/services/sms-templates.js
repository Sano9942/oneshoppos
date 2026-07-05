/**
 * SMS templates for the customer-notification engine (F05).
 *
 * Plain-string templates with {{var}} substitution. Kept short — aim for a
 * single SMS segment (160 GSM-7 chars; ~70 chars if the store's copy contains
 * non-GSM/Urdu characters, which forces UCS-2 segmentation). Each builder
 * returns the final message string, or null if a template_key is unknown so
 * the engine can log a 'skipped' row instead of sending garbage.
 *
 * Registry key === notification_rules.template_key for sms/whatsapp channels.
 */

// Simple, safe {{var}} interpolation. Missing vars render as empty string.
function fill(tmpl, data = {}) {
  return tmpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = data[k];
    return v == null ? "" : String(v);
  }).replace(/\s+/g, " ").trim();
}

// Format an ISO timestamp for SMS (short, locale-default). Non-fatal.
function fmtWhen(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
}

const SMS_TEMPLATES = {
  // Repair / service tickets
  ticket_approved: (d) =>
    fill("{{storeName}}: Your service request {{ticketNumber}} has been approved. We'll update you as it progresses.", d),
  ticket_in_progress: (d) =>
    fill("{{storeName}}: Work has started on your service request {{ticketNumber}}.", d),
  ticket_completed: (d) =>
    fill("{{storeName}}: Your item ({{ticketNumber}}) is ready for pickup. {{storePhone}}", d),
  ticket_invoiced: (d) =>
    fill("{{storeName}}: Your invoice for {{ticketNumber}} is ready. {{storePhone}}", d),

  // Appointment reminders (shared by the reminders engine)
  appointment_reminder: (d) =>
    fill(
      "{{storeName}}: Reminder — your {{serviceName}} appointment is at {{apptTime}}.",
      { ...d, apptTime: d && d.apptTime != null ? d.apptTime : fmtWhen(d && d.apptStart) }
    ),

  // F06 scheduling — class sessions + waitlist offer flow
  class_cancelled: (d) =>
    fill(
      "{{storeName}}: {{className}} on {{classTime}} has been cancelled.{{reasonSuffix}}",
      {
        ...d,
        classTime: d && d.classTime != null ? d.classTime : fmtWhen(d && d.classStart),
        reasonSuffix: d && d.reason ? ` Reason: ${d.reason}` : "",
      }
    ),
  waitlist_offer: (d) =>
    fill(
      "{{storeName}}: A spot opened up for {{className}} at {{classTime}}. Claim it before {{expiresAt}}: {{claimUrl}}",
      {
        ...d,
        classTime: d && d.classTime != null ? d.classTime : fmtWhen(d && d.classStart),
        expiresAt: d && d.expiresAt != null ? d.expiresAt : fmtWhen(d && d.offerExpiresAt),
      }
    ),

  // F02 membership dunning
  subscription_payment_failed: (d) =>
    fill(
      "{{storeName}}: We couldn't charge your card for {{planName}} ({{currency}} {{amount}}). We'll retry — please update your payment details.",
      { ...d, planName: (d && d.planName) || "your membership", currency: (d && d.currency) || "PKR" }
    ),
  subscription_paused: (d) =>
    fill(
      "{{storeName}}: Your {{planName}} membership is paused after several failed payment attempts. Please update your card to reactivate.",
      { ...d, planName: (d && d.planName) || "" }
    ),
};

/**
 * Render an SMS body for a template_key. Returns the final string, or null if
 * the key isn't registered (engine logs 'skipped').
 */
function render(templateKey, data = {}) {
  const fn = SMS_TEMPLATES[templateKey];
  if (!fn) return null;
  return fn(data);
}

module.exports = { render, fill, SMS_TEMPLATES };
