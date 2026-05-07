/**
 * backend/routes/sandbox.js — Sandbox payment simulation routes.
 *
 * GET  /api/sandbox/pay/:gatewayRef — Serves sandbox payment page (server-rendered HTML)
 * POST /api/sandbox/simulate-webhook — Simulates a webhook event for a given payment reference
 *
 * Only mounted when PAYMENT_GATEWAY=sandbox. No auth required.
 * These routes are development/testing tools — never available in production.
 */

module.exports = function registerSandboxRoutes(app, deps) {
  const masterDb = require("../master-db-pg");
  const logger = require("../services/logger").child({ component: "sandbox" });
  const { processWebhookEvent } = require("./webhooks");
  const tenantDbMgr = deps.tenantDbManager || require("../tenant-db-manager-pg");

  // W32: tenant-scoped sandbox lookups. The 3 sandbox-eligible tables
  // (customer_invoice_payment_links, storefront_payment_sessions,
  // restaurant_payment_sessions) live in each tenant schema, not public.
  // The original implementation queried `db-pg` (public pool) without a
  // search_path and the catch blocks silently swallowed the "relation does
  // not exist" error → context fell through to "unknown" → page rendered
  // "Payment reference not found in any context".
  //
  // Sandbox is dev/soft-launch only and tenant counts stay small, so a
  // cross-tenant scan is fine here. We iterate active tenants, get a
  // scoped DB handle from `tenantDbManager`, and try each table. Returns
  // both the row and the tenant slug so the webhook simulator can scope
  // its own queries the same way.
  async function findSandboxRefAcrossTenants(gatewayRef) {
    let tenants = [];
    try {
      const { rows } = await masterDb.query(
        "SELECT id, slug FROM tenants WHERE status = 'active' ORDER BY id"
      );
      tenants = rows;
    } catch (err) {
      logger.error({ err }, "sandbox tenant list failed");
      return null;
    }

    for (const t of tenants) {
      let db;
      try {
        db = await tenantDbMgr.getDb(t.id);
      } catch (err) {
        logger.warn({ err, slug: t.slug }, "sandbox getDb failed — skipping tenant");
        continue;
      }

      try {
        const { rows: [link] } = await db.query(
          "SELECT id, invoice_id, amount, status FROM customer_invoice_payment_links WHERE gateway_ref = $1",
          [gatewayRef]
        );
        if (link) return { kind: "invoice", row: link, tenant: t, db };
      } catch (err) {
        if (!/does not exist/i.test(err.message)) logger.warn({ err, slug: t.slug }, "invoice lookup error");
      }

      try {
        const { rows: [session] } = await db.query(
          "SELECT id, web_order_id, amount, status FROM storefront_payment_sessions WHERE provider_ref = $1",
          [gatewayRef]
        );
        if (session) return { kind: "storefront", row: session, tenant: t, db };
      } catch (err) {
        if (!/does not exist/i.test(err.message)) logger.warn({ err, slug: t.slug }, "storefront lookup error");
      }

      try {
        const { rows: [rps] } = await db.query(
          "SELECT id, amount, tip_amount, status, draft_order_id FROM restaurant_payment_sessions WHERE gateway_ref = $1",
          [gatewayRef]
        );
        if (rps) return { kind: "restaurant", row: rps, tenant: t, db };
      } catch (err) {
        if (!/does not exist/i.test(err.message)) logger.warn({ err, slug: t.slug }, "restaurant lookup error");
      }
    }
    return null;
  }

  // ── GET /api/sandbox/pay/:gatewayRef — Sandbox payment page ────────

  app.get("/api/sandbox/pay/:gatewayRef", async (req, res) => {
    const { gatewayRef } = req.params;

    try {
      // Look up the payment context to display relevant info
      let context = null;

      // Check payment_intents (platform billing)
      const { rows: [intent] } = await masterDb.query(
        "SELECT id, tenant_id, amount, plan, cycle, status FROM payment_intents WHERE gateway_ref = $1",
        [gatewayRef]
      );
      if (intent) {
        const { rows: [tenant] } = await masterDb.query(
          "SELECT name, slug FROM tenants WHERE id = $1",
          [intent.tenant_id]
        );
        context = {
          type: "billing",
          label: "Platform Billing",
          description: `${tenant?.name || "Unknown tenant"} — ${intent.plan} plan (${intent.cycle})`,
          amount: Number(intent.amount),
          currency: "PKR",
          status: intent.status,
          reference: gatewayRef,
        };
      }

      // Tenant-scoped lookups. Sandbox queries 3 per-tenant tables; we scan
      // active tenants because the gateway_ref shape doesn't carry tenant
      // info. See `findSandboxRefAcrossTenants` above.
      if (!context) {
        const hit = await findSandboxRefAcrossTenants(gatewayRef);
        if (hit?.kind === "invoice") {
          context = {
            type: "invoice",
            label: "Invoice Payment",
            description: `Invoice payment link #${hit.row.id}`,
            amount: Number(hit.row.amount),
            currency: "PKR",
            status: hit.row.status,
            reference: gatewayRef,
          };
        } else if (hit?.kind === "storefront") {
          context = {
            type: "storefront",
            label: "Storefront Checkout",
            description: `Order payment session #${hit.row.id}`,
            amount: Number(hit.row.amount),
            currency: "PKR",
            status: hit.row.status,
            reference: gatewayRef,
          };
        } else if (hit?.kind === "restaurant") {
          const total = Number(hit.row.amount) + Number(hit.row.tip_amount || 0);
          context = {
            type: "restaurant",
            label: "Restaurant Table Payment",
            description: `Table check #${hit.row.draft_order_id}`,
            amount: total,
            currency: "PKR",
            status: hit.row.status,
            reference: gatewayRef,
          };
        }
      }

      if (!context) {
        context = {
          type: "unknown",
          label: "Payment",
          description: "Payment reference not found in any context",
          amount: 0,
          currency: "PKR",
          status: "unknown",
          reference: gatewayRef,
        };
      }

      // Render server-side HTML payment page
      const html = renderSandboxPaymentPage(context);
      res.type("html").send(html);

    } catch (err) {
      logger.error({ err, gatewayRef }, "Sandbox payment page error");
      res.status(500).send("Internal error loading sandbox payment page");
    }
  });

  // ── POST /api/sandbox/simulate-webhook — Simulate payment outcome ──

  app.post("/api/sandbox/simulate-webhook", async (req, res) => {
    const { gatewayRef, outcome } = req.body;

    if (!gatewayRef || !outcome) {
      return res.status(400).json({ error: "gatewayRef and outcome are required" });
    }

    const validOutcomes = ["payment.completed", "payment.failed", "payment.cancelled"];
    if (!validOutcomes.includes(outcome)) {
      return res.status(400).json({ error: `Invalid outcome. Must be one of: ${validOutcomes.join(", ")}` });
    }

    try {
      // Resolve the amount from the payment context. Platform billing
      // (`payment_intents`) lives in public schema; the other 3 sources are
      // per-tenant and need a cross-tenant scan (W32).
      let amount = 0;

      const { rows: [intent] } = await masterDb.query(
        "SELECT amount FROM payment_intents WHERE gateway_ref = $1",
        [gatewayRef]
      );
      if (intent) {
        amount = Number(intent.amount);
      } else {
        const hit = await findSandboxRefAcrossTenants(gatewayRef);
        if (hit?.kind === "invoice" || hit?.kind === "storefront") {
          amount = Number(hit.row.amount);
        } else if (hit?.kind === "restaurant") {
          amount = Number(hit.row.amount) + Number(hit.row.tip_amount || 0);
        }
      }

      const statusMap = {
        "payment.completed": "completed",
        "payment.failed": "failed",
        "payment.cancelled": "cancelled",
      };

      const result = await processWebhookEvent({
        provider: "sandbox",
        event_type: outcome,
        transaction_id: gatewayRef,
        status: statusMap[outcome],
        amount,
        raw: {
          event_type: outcome,
          transaction_id: gatewayRef,
          status: statusMap[outcome],
          amount,
          currency: "PKR",
          sandbox: true,
          simulated_at: new Date().toISOString(),
        },
      });

      logger.info({ gatewayRef, outcome, result }, "Sandbox webhook simulated");

      if (result.error) {
        return res.status(result.statusCode || 400).json(result);
      }
      return res.json({ ok: true, message: result.message || `Simulated ${outcome}` });

    } catch (err) {
      logger.error({ err, gatewayRef, outcome }, "Sandbox webhook simulation error");
      return res.status(500).json({ error: "Simulation failed" });
    }
  });

  // ── POST /api/sandbox/tokenize — returns a fake saved-instrument token ──
  // For Item 22 (recurring auto-charge). Real xPay tokenization is not yet
  // wired; the sandbox provides a stand-in so the renewal worker can be
  // exercised end-to-end without a real card on file.
  app.post("/api/sandbox/tokenize", async (req, res) => {
    try {
      const { customerRef, last4 } = req.body || {};
      const token = `sbx_tok_${Buffer.from(
        `${customerRef || "anon"}-${Date.now()}-${Math.random()}`
      ).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
      logger.info({ token, customerRef, last4 }, "Sandbox tokenize");
      return res.json({
        ok: true,
        gateway_token: token,
        last4: last4 || "4242",
        brand: "VISA",
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/sandbox/charge-saved — charges a saved token ──
  // Synchronous result + simulated webhook for the renewal worker. The
  // outcome can be controlled via `forceOutcome` for failure-path tests.
  app.post("/api/sandbox/charge-saved", async (req, res) => {
    try {
      const { gateway_token, amount, reference, forceOutcome } = req.body || {};
      if (!gateway_token || !amount) {
        return res.status(400).json({ error: "gateway_token and amount required" });
      }
      const outcome = forceOutcome === "fail" ? "payment.failed" : "payment.completed";
      const transactionId = `sbx_chg_${Date.now()}_${reference || "ref"}`;

      // Fire the webhook synchronously so the caller can read the result.
      const result = await processWebhookEvent({
        provider: "sandbox",
        event_type: outcome,
        transaction_id: transactionId,
        status: outcome === "payment.completed" ? "completed" : "failed",
        amount: Number(amount),
        raw: {
          event_type: outcome,
          transaction_id: transactionId,
          gateway_token,
          status: outcome === "payment.completed" ? "completed" : "failed",
          amount: Number(amount),
          currency: "PKR",
          sandbox: true,
          source: "charge-saved",
          simulated_at: new Date().toISOString(),
        },
      });

      return res.json({
        ok: outcome === "payment.completed",
        gateway_ref: transactionId,
        amount: Number(amount),
        status: outcome === "payment.completed" ? "captured" : "failed",
        webhook_result: result,
      });
    } catch (err) {
      logger.error({ err }, "Sandbox charge-saved error");
      return res.status(500).json({ error: err.message });
    }
  });
};

// ── Server-rendered sandbox payment page ─────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderSandboxPaymentPage(ctx) {
  const alreadyProcessed = ctx.status === "completed" || ctx.status === "failed" || ctx.status === "cancelled";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SanoPay Sandbox — ${escapeHtml(ctx.label)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1e293b; border-radius: 16px; padding: 40px; max-width: 480px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.4); }
    .badge { display: inline-block; background: #f59e0b; color: #0f172a; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .desc { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .amount { font-size: 48px; font-weight: 700; color: #f8fafc; margin-bottom: 8px; }
    .currency { font-size: 14px; color: #64748b; margin-bottom: 32px; }
    .ref { font-size: 12px; color: #475569; word-break: break-all; margin-bottom: 24px; padding: 12px; background: #0f172a; border-radius: 8px; font-family: monospace; }
    .actions { display: flex; flex-direction: column; gap: 12px; }
    button { padding: 14px 24px; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-success { background: #10b981; color: white; }
    .btn-success:hover:not(:disabled) { background: #059669; }
    .btn-fail { background: #ef4444; color: white; }
    .btn-fail:hover:not(:disabled) { background: #dc2626; }
    .btn-cancel { background: #374151; color: #9ca3af; }
    .btn-cancel:hover:not(:disabled) { background: #4b5563; }
    .result { margin-top: 20px; padding: 16px; border-radius: 10px; font-size: 14px; display: none; }
    .result.success { display: block; background: #064e3b; color: #6ee7b7; }
    .result.error { display: block; background: #450a0a; color: #fca5a5; }
    .result.info { display: block; background: #1e3a5f; color: #93c5fd; }
    .processed { text-align: center; padding: 20px; color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Sandbox — No Real Money</div>
    <h1>${escapeHtml(ctx.label)}</h1>
    <p class="desc">${escapeHtml(ctx.description)}</p>
    ${ctx.amount > 0 ? `<div class="amount">${ctx.currency} ${ctx.amount.toLocaleString()}</div>` : ""}
    <div class="ref">Ref: ${escapeHtml(ctx.reference)}</div>

    ${alreadyProcessed ? `
      <div class="processed">This payment has already been processed (status: ${escapeHtml(ctx.status)})</div>
    ` : `
      <div class="actions">
        <button class="btn-success" onclick="simulate('payment.completed', this)">Pay Successfully</button>
        <button class="btn-fail" onclick="simulate('payment.failed', this)">Fail Payment</button>
        <button class="btn-cancel" onclick="simulate('payment.cancelled', this)">Cancel</button>
      </div>
      <div id="result" class="result"></div>
    `}
  </div>

  <script>
    async function simulate(outcome, btn) {
      const buttons = document.querySelectorAll('button');
      buttons.forEach(b => b.disabled = true);

      const resultEl = document.getElementById('result');
      resultEl.className = 'result info';
      resultEl.style.display = 'block';
      resultEl.textContent = 'Processing...';

      try {
        const res = await fetch('/api/sandbox/simulate-webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gatewayRef: ${JSON.stringify(ctx.reference)},
            outcome: outcome,
          }),
        });

        const data = await res.json();

        if (res.ok) {
          resultEl.className = 'result success';
          resultEl.textContent = data.message || 'Payment event processed successfully.';

          // Redirect after success if there's a return URL
          ${ctx.type === "billing" ? `
          setTimeout(() => {
            const params = new URLSearchParams(window.location.search);
            const returnUrl = params.get('returnUrl');
            if (returnUrl) window.location.href = returnUrl;
          }, 2000);
          ` : ""}
        } else {
          resultEl.className = 'result error';
          resultEl.textContent = data.error || 'Something went wrong.';
          buttons.forEach(b => b.disabled = false);
        }
      } catch (err) {
        resultEl.className = 'result error';
        resultEl.textContent = 'Network error: ' + err.message;
        buttons.forEach(b => b.disabled = false);
      }
    }
  </script>
</body>
</html>`;
}
