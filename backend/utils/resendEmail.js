const { Resend } = require("resend");

let _resend = null;
function getResend() {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not configured");
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM =
  process.env.RESEND_FROM_EMAIL || "SanoPOS <onboarding@resend.dev>";

async function sendPasswordResetEmail({
  toEmail,
  employeeName,
  resetLink,
  storeName,
}) {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `Reset your password — ${storeName || "SanoPOS"}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#059669;margin-bottom:16px">Password Reset</h2>
        <p>Hi ${employeeName},</p>
        <p>We received a request to reset your password for <strong>${storeName || "SanoPOS"}</strong>.</p>
        <p style="margin:24px 0">
          <a href="${resetLink}"
             style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Reset Password
          </a>
        </p>
        <p style="color:#64748b;font-size:14px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
        <p style="color:#94a3b8;font-size:12px">SanoPOS — Point of Sale</p>
      </div>
    `,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

function buildWelcomeEmailHtml({ ownerName, storeName, slug, setupUrl }) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#059669;margin-bottom:16px">Welcome to SanoPOS!</h2>
      <p>Hi ${ownerName},</p>
      <p>Your store <strong>${storeName}</strong> has been created and is ready to set up.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0">
        <p style="margin:0 0 4px 0;font-size:13px;color:#64748b">Your store code</p>
        <p style="margin:0;font-size:20px;font-weight:700;font-family:monospace;color:#059669">${slug}</p>
      </div>
      <p style="margin:24px 0">
        <a href="${setupUrl}"
           style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Complete Setup
        </a>
      </p>
      <p style="font-weight:600;margin-bottom:8px">What's next?</p>
      <ol style="color:#475569;padding-left:20px;line-height:1.8">
        <li>Configure your store — name, currency, timezone</li>
        <li>Add your products and open your first shift</li>
        <li>Start selling!</li>
      </ol>
      <p style="color:#64748b;font-size:13px;margin-top:20px">This setup link expires in 48 hours. If it expires, contact support for a new one.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="color:#94a3b8;font-size:12px">SanoPOS — Point of Sale</p>
    </div>
  `;
}

async function sendWelcomeEmail({ toEmail, ownerName, storeName, slug, setupUrl }) {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `Welcome to SanoPOS — Set up ${storeName}`,
    html: buildWelcomeEmailHtml({ ownerName, storeName, slug, setupUrl }),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

module.exports = { sendPasswordResetEmail, sendWelcomeEmail };
