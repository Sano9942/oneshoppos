/**
 * Booking reminder scheduler — uses pg-boss to send reminders.
 */

async function processPendingReminders(db, boss) {
  const { rows: reminders } = await db.query(
    `SELECT ar.*, a.customer_email, a.customer_phone, a.customer_name, a.start_at AS appt_start,
       bs.name AS service_name
     FROM appointment_reminders ar
     JOIN appointments a ON a.id = ar.appointment_id
     JOIN booking_services bs ON bs.id = a.service_id
     WHERE ar.status = 'pending' AND ar.scheduled_for <= NOW()
     AND a.status NOT IN ('cancelled','no_show')
     LIMIT 50`
  );

  for (const r of reminders) {
    try {
      if (r.channel === "email" && r.customer_email) {
        await boss.send("email", {
          to: r.customer_email,
          from: process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>",
          subject: `Reminder: ${r.service_name} appointment`,
          html: `<p>Hi ${r.customer_name || ""},</p><p>This is a reminder for your <b>${r.service_name}</b> appointment at ${new Date(r.appt_start).toLocaleString()}.</p>`,
        });
      }
      await db.query(
        "UPDATE appointment_reminders SET status = 'sent', sent_at = NOW() WHERE id = $1",
        [r.id]
      );
    } catch (err) {
      await db.query(
        "UPDATE appointment_reminders SET status = 'failed' WHERE id = $1",
        [r.id]
      );
    }
  }
  return reminders.length;
}

module.exports = { processPendingReminders };
