require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const q = await p.query(
      `SELECT id, to_email, email_type, subject, status_text, created_at, sent_at
         FROM (
           SELECT id, to_email, email_type, subject,
                  CASE WHEN sent_at IS NOT NULL THEN 'sent'
                       WHEN error IS NOT NULL  THEN 'error'
                       ELSE 'pending' END AS status_text,
                  created_at, sent_at
             FROM public.email_queue
         ) sub
        WHERE to_email = 'oneshop349@hotmail.com'
        ORDER BY created_at DESC LIMIT 5`
    );
    console.log("Email queue rows for oneshop349@hotmail.com:");
    console.table(q.rows);
    if (q.rows.length === 0) {
      console.log("(none — storefront placement does NOT enqueue a customer email)");
    }
  } catch (e) { console.error("ERR", e.message); }
  finally { await p.end(); }
})();
