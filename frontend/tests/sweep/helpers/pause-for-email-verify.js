/**
 * Pause-for-email-verify helper.
 *
 * After signup, the tenant is in `verification_required` state. The merchant
 * receives an email at `sano9942@hotmail.com` containing a verify URL of the
 * shape:
 *
 *   https://sanopos.com/verify-email?token=<uuid>&tenant=<slug>
 *
 * The operator clicks that link from Hotmail. Because Hotmail opens links
 * in a new browser, we cannot rely on the click landing inside the
 * Playwright window. Instead, this helper polls a backend endpoint until
 * verification is observed, then resumes the spec.
 *
 * There is no "is tenant verified" public endpoint, but the storefront
 * status page returns 200 once the wizard is reachable. We use a simpler
 * signal: poll the public country-pack endpoint with the slug — once
 * verified, the tenant becomes resolvable. If that doesn't reflect the
 * verification state, we fall back to direct admin-API check.
 *
 * The cleanest signal in production is GET /api/admin/tenants?search=<slug>
 * which returns the tenant row including `email_verified_at`. The sweep
 * is logged in as super-admin (separate auth) for the cleanup step
 * regardless, so we use that channel.
 *
 * For v1 simplicity: we poll a status endpoint exposed by the verify-email
 * page. If the tenant has been verified, the page renders a success state.
 * Easier: poll `POST /api/auth/mt-login` — once verified, login no longer
 * returns "EMAIL_NOT_VERIFIED".
 */

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — generous for human-in-loop

/**
 * Poll until the tenant becomes login-able (= email has been verified).
 *
 * @param {object} opts
 * @param {string} opts.backend - e.g. "https://api.sanopos.com"
 * @param {string} opts.slug
 * @param {string} opts.username
 * @param {string} opts.password
 * @param {function} opts.onTick - optional, called each poll with elapsed seconds
 */
export async function waitForEmailVerified({
  backend,
  slug,
  username,
  password,
  onTick = null,
}) {
  const startedAt = Date.now();
  let elapsed = 0;

  // eslint-disable-next-line no-console
  console.log(
    `\n[verify] Waiting for email verification for tenant '${slug}'...`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[verify] OPEN sano9942@hotmail.com → click the link from noreply@sanopos.com`,
  );
  // eslint-disable-next-line no-console
  console.log(`[verify] Polling every ${POLL_INTERVAL_MS / 1000}s, up to 10 min`);

  while (elapsed < POLL_TIMEOUT_MS) {
    try {
      const r = await fetch(`${backend}/api/auth/mt-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_slug: slug,
          username,
          password,
        }),
      });
      const body = await r.json().catch(() => ({}));

      if (r.ok && body.token) {
        // eslint-disable-next-line no-console
        console.log(
          `[verify] ✓ Verified after ${Math.round(elapsed / 1000)}s — login token received\n`,
        );
        return { token: body.token, employee: body.employee };
      }

      // Common pre-verify response: 403 with a code like EMAIL_NOT_VERIFIED.
      // Anything else (other than 401 — wrong creds) we surface so the operator
      // can react if signup is genuinely broken.
      if (r.status !== 403 && r.status !== 401) {
        // eslint-disable-next-line no-console
        console.log(
          `[verify] Unexpected ${r.status}: ${JSON.stringify(body).slice(0, 200)}`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`[verify] poll error: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    elapsed = Date.now() - startedAt;
    if (onTick) onTick(Math.round(elapsed / 1000));

    // Light heartbeat every minute
    if (Math.round(elapsed / 1000) % 60 < 5) {
      // eslint-disable-next-line no-console
      console.log(`[verify] still waiting... (${Math.round(elapsed / 1000)}s)`);
    }
  }

  throw new Error(
    `Email verification did not complete within ${POLL_TIMEOUT_MS / 60000} minutes. ` +
      `Check sano9942@hotmail.com for the verify email and click the link.`,
  );
}
