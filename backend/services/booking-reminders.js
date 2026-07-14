/**
 * Booking reminder scheduler.
 *
 * Email-channel reminders enqueue directly onto the shared pg-boss "email" job
 * (tenant-agnostic once queued). SMS-channel reminders route through the F05
 * notification engine (services/customer-notify.js) so they actually deliver
 * and log provider truth — previously the SMS branch silently marked rows
 * 'sent' without sending anything (completion-03 verdict: a real latent bug,
 * not intentional design). A reminder is now only marked 'sent' when its
 * channel actually delivered; anything else (no provider, flag off, no rule,
 * no mobile, provider error) is marked 'failed' — the honest state.
 */

const customerNotify = require("./customer-notify");

async function processPendingReminders(db, boss, tenantSlug, deps = { notify: customerNotify.notify }) {
  // Feature-flag gate — no-op for tenants with the Appointments module off
  // (Business Modules rule: disabling a module stops its background
  // processing; pending reminders stay pending and resume on re-enable).
  // Pattern: workers/abc-worker-boss.js.
  const { rows: flagRows } = await db.query(
    `SELECT enabled FROM feature_flags WHERE key = 'phase4_appointments'`
  );
  if (!flagRows[0]?.enabled) return 0;

  // Step 9 (D1c): per-outlet gate — reminders for appointments at an outlet
  // where the Appointments module is off stay pending (same freeze semantics
  // as the company-level gate above). NULL-outlet appointments keep following
  // company state. Fast path: nothing disabled ⇒ no extra SQL.
  let disabledOutlets = [];
  try {
    disabledOutlets = await require("./business-modules").getDisabledOutletIds(db, "appointments");
  } catch { /* pre-v136 schema — no per-outlet state */ }
  const outletFilter = disabledOutlets.length
    ? "AND (a.outlet_id IS NULL OR NOT (a.outlet_id = ANY($1)))"
    : "";
  const outletParams = disabledOutlets.length ? [disabledOutlets] : [];

  const { rows: reminders } = await db.query(
    `SELECT ar.*, a.customer_id, a.customer_email, a.customer_phone, a.customer_name,
       a.start_at AS appt_start, bs.name AS service_name
     FROM appointment_reminders ar
     JOIN appointments a ON a.id = ar.appointment_id
     JOIN booking_services bs ON bs.id = a.service_id
     WHERE ar.status = 'pending' AND ar.scheduled_for <= NOW()
     AND a.status NOT IN ('cancelled','no_show')
     ${outletFilter}
     LIMIT 50`,
    outletParams
  );

  if (!reminders.length) return 0;

  // Store name for message copy — one lookup per poll (not per reminder).
  let storeName = "";
  try {
    const { rows } = await db.query("SELECT company_name, trading_name FROM company_profile WHERE id = 1");
    if (rows[0]) storeName = rows[0].trading_name || rows[0].company_name || "";
  } catch { /* best-effort */ }

  const markSent = (id) =>
    db.query("UPDATE appointment_reminders SET status = 'sent', sent_at = NOW() WHERE id = $1", [id]);
  const markFailed = (id) =>
    db.query("UPDATE appointment_reminders SET status = 'failed' WHERE id = $1", [id]);

  for (const r of reminders) {
    try {
      if (r.channel === "email" && r.customer_email) {
        await boss.send("email", {
          to: r.customer_email,
          from: process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>",
          subject: `Reminder: ${r.service_name} appointment`,
          html: `<p>Hi ${r.customer_name || ""},</p><p>This is a reminder for your <b>${r.service_name}</b> appointment at ${new Date(r.appt_start).toLocaleString()}.</p>`,
        });
        await markSent(r.id);
      } else if (r.channel === "sms") {
        // Route through the notification engine — real delivery + truth log.
        const result = await deps.notify(db, {
          event: "appointment.reminder",
          channelHints: ["sms"],
          customerId: r.customer_id || null,
          entityType: "appointment",
          entityId: r.appointment_id,
          tenantSlug,
          data: {
            storeName,
            serviceName: r.service_name,
            apptStart: r.appt_start,
            mobile: r.customer_phone,
            customerName: r.customer_name,
          },
        });
        const smsResult = (result.dispatched || []).find((d) => d.channel === "sms");
        if (smsResult && smsResult.status === "sent") {
          await markSent(r.id);
        } else {
          // Did NOT deliver — honest 'failed' instead of the old false 'sent'.
          await markFailed(r.id);
        }
      } else {
        // Unknown channel, or an email-channel row with no address to send to.
        await markFailed(r.id);
      }
    } catch (err) {
      await markFailed(r.id);
    }
  }
  return reminders.length;
}

module.exports = { processPendingReminders };
