require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    // Check tenant email_queue
    const tq = await p.query(
      `SELECT id, to_email, email_type, subject,
              CASE WHEN sent_at IS NOT NULL THEN 'sent'
                   WHEN error IS NOT NULL  THEN 'error'
                   ELSE 'pending' END AS status, created_at, sent_at, error
         FROM tenant_livetest1.email_queue
        WHERE to_email = 'oneshop349@hotmail.com'
        ORDER BY created_at DESC LIMIT 5`
    ).catch(()=>({rows:[]}));
    console.log("tenant_livetest1.email_queue rows:");
    console.table(tq.rows);

    // Check OTP table
    const otp = await p.query(
      `SELECT id, customer_id, email, purpose, expires_at, used_at
         FROM tenant_livetest1.customer_portal_otps
        WHERE LOWER(email) = LOWER('oneshop349@hotmail.com')
        ORDER BY id DESC LIMIT 3`
    );
    console.log("\ncustomer_portal_otps rows:");
    console.table(otp.rows);

    // Check customer row
    const c = await p.query(
      `SELECT id, name, email, mobile, portal_enabled_at, portal_password_hash IS NOT NULL AS has_password
         FROM tenant_livetest1.customers
        WHERE LOWER(email) = LOWER('oneshop349@hotmail.com')`
    );
    console.log("\ncustomers row:");
    console.table(c.rows);
  } catch (e) { console.error("ERR", e.message); }
  finally { await p.end(); }
})();
