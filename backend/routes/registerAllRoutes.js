module.exports = function registerAllRoutes(app, deps) {
  const {
    db,
    fs,
    path,
    multer,
    requirePerm,
    requireAnyPerm,
    requireFeature,
    requirePlanLimit,
    requireActiveSubscription,
    createNotification,
    notifyLowStockForSale,
    loadEmployeePerms,
    loadTenantAndPerms,
    resolveTenant,
    loadCompanyProfile,
    resolveContext,
    requireContextOutlet,
    ensureDefaultRolePermissions,
    PERMISSION_RULES,
    DEFAULT_FEATURE_FLAGS,
    runtimeState,
    authLimiter,
    webhookLimiter,
    PRODUCT_UPLOADS_DIR,
    COMPANY_UPLOADS_DIR,
    UPLOADS_DIR,
    DB_PATH,
    SHOPIFY_MAX_RETRY_ATTEMPTS,
    verifyConnection,
    fetchShopifyLocations,
    adjustShopifyInventory,
    fetchShopifyVariantCatalog,
    fetchShopifyProductsFull,
    fetchInventoryLevel,
    fetchInventoryLevelsBatch,
    fetchRecentOrders,
    retryDelayMinutesWithJitter,
    evaluateWebhookTimestampWindow,
    isRetryableInventoryEventStatus,
    canApproveReconciliationRequest,
    buildWebhookIdempotencyKey,
    verifyWebhookSignature,
    encryptShopifySecret,
    decryptShopifySecret,
    logShopifyEvent,
    invalidateFeatureFlagCache,
  } = deps;

  // Health check — registered BEFORE all auth/tenant middleware so Railway healthcheck always responds
  app.get("/api/health", async (req, res) => {
    // Quick mode (default) — unchanged behavior
    if (req.query.deep !== "true") {
      return res.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    // Deep mode — check external dependencies
    const alerting = require("../services/alerting");
    const logger = require("../services/logger");

    /**
     * Run a dependency check with a timeout.
     * Returns { status, latency_ms, error? }
     */
    async function checkDependency(name, fn, timeoutMs) {
      const start = Date.now();
      try {
        await Promise.race([
          fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${name} check timed out after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);
        return { status: "ok", latency_ms: Date.now() - start };
      } catch (err) {
        const latency = Date.now() - start;
        logger.warn({ dependency: name, error: err.message, latency_ms: latency }, "Health check dependency failed");
        alerting.recordHealthCheckFailure({ dependency: name, error: err.message });
        return { status: "down", error: err.message, latency_ms: latency };
      }
    }

    // Build list of checks to run
    const checks = [];

    // 1. Postgres — always checked (use raw pool, not tenant proxy)
    const rawDb = require("../db-pg");
    checks.push(
      checkDependency("database", async () => {
        await rawDb.query("SELECT 1");
      }, 3000)
    );

    // 2. Resend — only if API key is configured
    if (process.env.RESEND_API_KEY) {
      checks.push(
        checkDependency("resend", async () => {
          // POST with empty body returns 422 (valid key) or 401 (bad key)
          const resp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          });
          if (resp.status === 401 || resp.status === 403) {
            throw new Error(`Resend API key invalid (${resp.status})`);
          }
          // 422 = key valid, body invalid — that's expected and means Resend is reachable
        }, 5000)
      );
    }

    const checkNames = ["database"];
    if (process.env.RESEND_API_KEY) checkNames.push("resend");

    const results = await Promise.allSettled(checks);

    // Build checks object
    const checksResult = {};
    for (let i = 0; i < checkNames.length; i++) {
      const r = results[i];
      checksResult[checkNames[i]] = r.status === "fulfilled" ? r.value : { status: "down", error: r.reason?.message };
    }

    // Determine overall status
    let overall = "ok";
    if (checksResult.database?.status === "down") {
      overall = "down";
    } else {
      // Check if any optional dependency is down
      for (const [name, check] of Object.entries(checksResult)) {
        if (name !== "database" && check.status === "down") {
          overall = "degraded";
          break;
        }
      }
    }

    const statusCode = overall === "down" ? 503 : 200;
    res.status(statusCode).json({
      status: overall,
      timestamp: new Date().toISOString(),
      checks: checksResult,
    });
  });

  // Payment gateway webhooks — no auth, no tenant context (identifies via payment_intents)
  require("./webhooks")(app, deps);

  // Sandbox payment simulation — only available when PAYMENT_GATEWAY=sandbox
  if (process.env.PAYMENT_GATEWAY === "sandbox") {
    require("./sandbox")(app, deps);
  }

  // Public receipt endpoint — no auth required, manually resolves tenant DB
  require("./receipts")(app, deps);

  // Public gift-card balance (Phase 2-G Wave 2 — 2-G.2) — no auth,
  // same manual tenant-resolution pattern as receipts.
  require("./gift-cards-public")(app, deps);

  // Public storefront endpoints — no auth required, manually resolves tenant DB
  require("./storefront")(app, deps);

  // Public restaurant QR ordering — no auth required, manually resolves tenant DB
  // Tighter rate limit than globalLimiter so public submit can't be spammed.
  const { publicRestaurantLimiter } = require("../middleware/rate-limit");
  app.use("/api/public/restaurant", publicRestaurantLimiter);
  require("./public-restaurant")(app, deps);

  // Public pay-at-table (2-R.3) — bill view + confirm, no auth
  require("./restaurant/pay-at-table").registerPublicPayAtTableRoutes(app, deps);

  // Public reservations booking (2-R.4) — availability + POST, no auth
  require("./public-reservations")(app, deps);

  // Public booking page — no auth required, manually resolves tenant DB
  require("./public-bookings")(app, deps);

  // V09 — Public online rental booking. No auth; resolves tenant DB manually;
  // gated on the rental_online_booking flag inside the handlers.
  require("./public-rentals")(app, deps);

  // F03 — Public tokenized form fill (intake/waivers). No auth; single-use
  // token; resolves tenant via resolvePublicTenantDb; rate-limited.
  require("./public-forms")(app, deps);

  // V07 gym — Public member check-in kiosk. No auth; resolves tenant via
  // resolvePublicTenantDb; rate-limited; minimal PII response (first name +
  // verdict only). Mounted before tenant middleware to dodge the kiosk traps.
  require("./member-kiosk")(app, deps);

  // M8 — Customer portal (end-customer app). Mounted BEFORE tenant
  // middleware; each route resolves the tenant via resolvePublicTenantDb()
  // and verifies the portal JWT separately (scope="customer").
  require("./customer-portal/auth")(app, deps);
  require("./customer-portal/data")(app, deps);
  require("./customer-portal/payments")(app, deps);
  require("./customer-portal/appointments")(app, deps);
  require("./customer-portal/stays")(app, deps);
  require("./customer-portal/treatments")(app, deps);
  require("./customer-portal/packages")(app, deps);
  require("./customer-portal/forms")(app, deps);

  // Tier 1.4 — Manufacturer portal (distributor's brand-partners). Mounted
  // BEFORE tenant middleware; each route resolves tenant via
  // resolvePublicTenantDb() and verifies portal JWT (scope="manufacturer").
  require("./manufacturer-portal/auth")(app, deps);
  require("./manufacturer-portal/data")(app, deps);

  // Setup wizard — must be BEFORE auth middleware (no session exists yet)
  const createSetupRouter = require("./setup");
  const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";
  let setupTenantDbManager;
  if (IS_MULTI_TENANT && process.env.DATABASE_URL) {
    setupTenantDbManager = require("../tenant-db-manager-pg");
  }
  app.use("/api/setup", createSetupRouter(db, { IS_MULTI_TENANT, tenantDbManager: setupTenantDbManager }));

  // Country packs — public (no auth), used by setup wizard
  app.use("/api/country-packs", require("./country-packs")());

  // Toggle auth middleware: JWT-based (MULTI_TENANT=1) vs header-based (default)
  app.use(process.env.MULTI_TENANT === "1" ? loadTenantAndPerms : loadEmployeePerms);
  // In multi-tenant mode, resolve the tenant DB via AsyncLocalStorage after JWT auth
  if (process.env.MULTI_TENANT === "1") {
    app.use(resolveTenant);
    // Tenant-scoped upload serving (must run after resolveTenant sets req.tenantDir)
    const express = require("express");
    app.use("/uploads", (req, res, next) => {
      if (req.tenantDir) {
        const tenantUploads = path.join(req.tenantDir, "uploads");
        return express.static(tenantUploads)(req, res, next);
      }
      next(); // Falls through to global /uploads static mount
    });
  }
  app.use(loadCompanyProfile);
  app.use(resolveContext);

  // Block write operations for expired subscriptions (must be after tenant resolution)
  if (process.env.MULTI_TENANT === "1") {
    app.use(requireActiveSubscription);
  }

  app.use(requireContextOutlet);
  // Enrich Pino req.log with tenant/employee context now that auth has run
  const requestId = require("../middleware/request-id");
  if (requestId.enrichReqLog) app.use(requestId.enrichReqLog);
  ensureDefaultRolePermissions(db);

  // Enforce outlet assignment for non-admin employees on branch-scoped requests.
  app.use(async (req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    // Kiosk PIN routes are public (PIN is the auth) — skip session-based outlet check
    if (req.path.startsWith("/api/attendance/pin-")) return next();
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return next();
    const perms = req.employeePerms || [];
    if (perms.includes("all_access")) return next();
    // Tier 1.2 wholesale: field reps are tenant-scoped, not outlet-scoped.
    // They never have employee_outlets rows, so this enforcement would
    // block every API call carrying an outlet_id. Skip for them.
    if (perms.includes("manage_field_sales")) return next();

    const headerOutletId = Number(req.headers["x-outlet-id"] || 0);
    const contextOutletId = Number(req.context?.outletId || 0);
    const queryOutletId = Number(req.query?.outlet_id || 0);
    const bodyOutletId = Number(req.body?.outlet_id || 0);
    const outletId =
      contextOutletId || headerOutletId || queryOutletId || bodyOutletId;

    if (!outletId) return next();

    try {
      const { rows } = await db.query(
        "SELECT 1 FROM employee_outlets WHERE employee_id = $1 AND outlet_id = $2 LIMIT 1",
        [employeeId, outletId],
      );
      if (!rows[0]) {
        return res.status(403).json({
          error:
            "Forbidden: outlet is not assigned to this employee account.",
        });
      }
      return next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    const rule = PERMISSION_RULES.find(
      (r) => r.methods.includes(req.method) && r.path.test(req.path),
    );
    if (!rule) return next();

    const perms = req.employeePerms || [];
    const allowed =
      perms.includes("all_access") ||
      (rule.anyPerms || []).some((p) => perms.includes(p));

    if (!allowed) {
      return res
        .status(403)
        .json({ error: "Forbidden: insufficient permissions" });
    }
    return next();
  });

  app.use((req, res, next) => {
    if (
      runtimeState.isRestoreInProgress &&
      req.method !== "GET" &&
      req.method !== "OPTIONS"
    ) {
      return res.status(503).json({
        error: "Service temporarily unavailable: database restore in progress",
      });
    }
    next();
  });

  // Lightweight telemetry for report endpoints.
  app.use((req, res, next) => {
    if (!(req.path || "").startsWith("/api/reports")) return next();
    const startedAt = Date.now();
    let rowCount = null;
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body === "object") {
        for (const key of Object.keys(body)) {
          if (Array.isArray(body[key])) {
            rowCount = body[key].length;
            break;
          }
        }
      }
      return origJson(body);
    };
    res.on("finish", () => {
      const { date_from, date_to } = req.query || {};
      let rangeDays = null;
      if (date_from && date_to) {
        const fromTs = Date.parse(`${date_from}T00:00:00Z`);
        const toTs = Date.parse(`${date_to}T00:00:00Z`);
        if (!Number.isNaN(fromTs) && !Number.isNaN(toTs) && toTs >= fromTs) {
          rangeDays = Math.floor((toTs - fromTs) / 86400000) + 1;
        }
      }
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          area: "reports",
          endpoint: req.path,
          method: req.method,
          duration_ms: Date.now() - startedAt,
          status: res.statusCode,
          employee_id: req.headers["x-employee-id"] || null,
          date_from: date_from || null,
          date_to: date_to || null,
          date_range_days: rangeDays,
          row_count: rowCount,
        }),
      );
    });
    next();
  });

  // --- ROUTES: FEATURE FLAGS / HEALTH ---

  app.get("/api/feature-flags", async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { rows } = await db.query(
        "SELECT key, enabled, description, updated_by, updated_at FROM feature_flags ORDER BY key ASC",
      );
      const rowMap = new Map(rows.map((r) => [r.key, r]));
      const mergedDefaults = Object.keys(DEFAULT_FEATURE_FLAGS).map((key) => {
        const existing = rowMap.get(key);
        if (existing) return existing;
        return {
          key,
          enabled: DEFAULT_FEATURE_FLAGS[key] ? true : false,
          description: null,
          updated_by: null,
          updated_at: null,
        };
      });
      return res.json({ flags: mergedDefaults });
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) {
        const fallback = Object.keys(DEFAULT_FEATURE_FLAGS).map((k) => ({
          key: k,
          enabled: DEFAULT_FEATURE_FLAGS[k] ? true : false,
          description: null,
          updated_by: null,
          updated_at: null,
        }));
        return res.json({ flags: fallback });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  app.put(
    "/api/feature-flags/:key",
    requirePerm("all_access"),
    async (req, res) => {
      const { key } = req.params;
      const { enabled, description, updated_by } = req.body || {};
      const enabledVal = enabled ? true : false;
      try {
        await db.query(
          `INSERT INTO feature_flags (key, enabled, description, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT(key) DO UPDATE SET
       enabled = excluded.enabled,
       description = COALESCE(excluded.description, feature_flags.description),
       updated_by = excluded.updated_by,
       updated_at = NOW()`,
          [key, enabledVal, description || null, updated_by || null],
        );
        // Invalidate per-tenant feature flag cache
        if (typeof invalidateFeatureFlagCache === "function") {
          invalidateFeatureFlagCache(req.tenantId);
        }
        res.json({
          message: "Feature flag updated",
          key,
          enabled: enabledVal,
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // --- ROUTES: TIER 4 ---
  const createTier4Router = require("./tier4/index");
  app.use(
    createTier4Router({
      db,
      requireFeature,
      requirePerm,
      requireAnyPerm,
      createNotification,
      COMPANY_UPLOADS_DIR,
    }),
  );

  // --- ROUTES: SHIFTS (Operational) ---
  require("./shifts")(app, deps);

  // --- ROUTES: TAXES ---
  require("./taxes")(app, deps);

  // --- ROUTES: CATEGORIES ---
  require("./categories")(app, deps);

  // --- ROUTES: OUTLETS ---
  require("./outlets")(app, deps);

  // --- ROUTES: AUTH ---
  require("./auth")(app, deps);

  // --- ROUTES: EMPLOYEES ---
  require("./employees")(app, deps);

  // --- ROUTES: ROLES AND PERMISSIONS ---
  require("./roles")(app, deps);

  // --- ROUTES: BRANDS ---
  require("./brands")(app, deps);

  // --- ROUTES: PRODUCTS (INVENTORY) ---
  require("./products")(app, deps);

  // --- ROUTES: SUPPLIERS ---
  require("./suppliers")(app, deps);

  // --- ROUTES: PURCHASE ORDERS ---
  require("./purchase-orders")(app, deps);

  // --- GRN & SUPPLIER PAYABLES ---
  require("./grn")(app, deps);

  // --- PROMOTIONS ENGINE ---
  require("./promotions")(app, deps);

  // --- CUSTOMERS ---
  require("./customers")(app, deps);

  // --- SALES HISTORY ROUTES ---
  require("./sales")(app, deps);

  // --- INVENTORY TRANSFERS & ADJUSTMENTS ---
  require("./inventory")(app, deps);

  // --- F01: PRODUCTION / DISASSEMBLY RUNS (kit/BOM engine) ---
  require("./stock-conversions")(app, deps);

  // --- F07: BATCH / EXPIRY / LOT surfaces (expiring-soon, drift, write-off) ---
  require("./batches")(app, deps);

  // --- REPORTS ---
  const { processPendingReportSchedules } =
    require("./reports/index")(app, deps) || {};

  // --- ROUTES: RETURN POLICIES (Phase 2) ---
  require("./return-policies")(app, deps);

  // --- ROUTES: RETURNS ---
  require("./returns")(app, deps);

  // --- ROUTES: ATTRIBUTE SETS ---
  require("./attribute-sets")(app, deps);

  // --- RECEIPT TEMPLATES & ACTION HISTORY ---
  require("./receipt-templates")(app, deps);

  // --- ROUTES: CUSTOMER-FACING DISPLAY ---
  require("./customer-display")(app, deps);

  // --- ROUTES: PRINTER (ESC/POS hardware) ---
  require("./printer")(app, deps);

  // --- ROUTES: EMAIL (SMTP receipt delivery) ---
  require("./email")(app, deps);

  // --- SUPPLIER RETURNS (RMA) ---
  require("./supplier-returns")(app, deps);

  // --- V02 WHOLESALE: BACKORDER FULFILLMENT LOOP ---
  require("./backorders")(app, deps);

  // --- V02 WHOLESALE: VAN SALES (rep van view, day open/close, reconcile) ---
  require("./van")(app, deps);

  // --- ROUTES: SCHEDULES (Phase 2) ---
  require("./schedules")(app, deps);

  // --- ROUTES: APPROVAL POLICIES (Phase 2) ---
  require("./approval-policies")(app, deps);

  // --- ROUTES: OVERRIDE REASONS (Phase 2-G Wave 3 — 2-G.5) ---
  require("./override-reasons")(app, deps);

  // --- ROUTES: PRODUCT SERIALS (Phase 2-G Wave 3 — 2-G.6) ---
  require("./product-serials")(app, deps);

  // --- ROUTES: INVENTORY INTELLIGENCE (Phase 2-G Wave 3 — 2-G.8) ---
  require("./inventory-intelligence")(app, deps);

  // --- ROUTES: PRICE LISTS (Phase 2 detail + assignments) ---
  require("./price-lists")(app, deps);

  // --- ROUTES: PRICE LIST ASSIGNMENTS (Phase 2) ---
  require("./price-list-assignments")(app, deps);

  // --- ROUTES: PRICE BOOKS (Phase 2-G Wave 2 — 2-G.4) ---
  require("./price-books")(app, deps);

  // --- ROUTES: LOYALTY (Phase 2-G Wave 2 — 2-G.3) ---
  require("./loyalty")(app, deps);

  // --- ROUTES: GIFT CARDS (Phase 2-G Wave 2 — 2-G.2) ---
  require("./gift-cards")(app, deps);

  // --- ROUTES: PACKAGES / SESSION PASSES (F02) ---
  require("./packages")(app, deps);

  // --- ROUTES: DRAFT ORDERS (Phase 2) ---
  require("./draft-orders")(app, deps);

  // --- ROUTES: SMART COLLECTIONS (Phase 2B) ---
  require("./smart-collections")(app, deps);

  // --- ROUTES: OUTLET VISIBILITY (Phase 2B) ---
  require("./outlet-visibility")(app, deps);

  // --- ROUTES: OUTLET TAX PROFILES (Phase 2B) ---
  require("./outlet-tax-profiles")(app, deps);

  // --- ROUTES: SCHEDULED CATALOG CHANGES (Phase 2B) ---
  require("./scheduled-changes")(app, deps);

  // --- ROUTES: COMMISSIONS (Phase 2B) ---
  require("./commissions")(app, deps);

  // --- ROUTES: TIPS (Phase 2.1 C — restaurant server compensation) ---
  require("./tips")(app, deps);

  // --- ROUTES: REPORT BUILDER (Phase 2B) ---
  require("./report-builder")(app, deps);

  // --- ROUTES: POS LAYOUTS (Phase 2B) ---
  require("./pos-layouts")(app, deps);

  // --- ROUTES: POS DEVICE REGISTRY (2-G.13) ---
  require("./pos-devices")(app, deps);

  // --- ROUTES: ITEM SUGGESTIONS (Phase 2B) ---
  require("./item-suggestions")(app, deps);

  // --- ROUTES: PARKED SALES ---
  require("./parked-sales")(app, deps);

  // --- ROUTES: HOLDS / LAYAWAY (2-G.9) ---
  require("./holds")(app, deps);

  // --- ROUTES: RISK CONTROLS (2-G.17) ---
  require("./risk-controls")(app, deps);

  // --- ROUTES: ORDERS ---
  const {
    processPendingShopifyInventoryEvents,
    enqueueInventorySyncEvents,
    upsertWebOrderFromShopifyPayload,
  } = require("./orders")(app, deps) || {};
  const shopifyDeps = {
    ...deps,
    processPendingShopifyInventoryEvents,
    enqueueInventorySyncEvents,
    upsertWebOrderFromShopifyPayload,
  };

  // --- ROUTES: SHOPIFY ---
  require("./shopify")(app, shopifyDeps);

  // --- ROUTES: WOOCOMMERCE ---
  require("./woocommerce")(app, deps);

  // --- INSIGHTS (pre-built analytical cards + AI chat) ---
  require("./insights")(app, deps);
  require("./insights-ai")(app, deps);

  // --- BARCODE TEMPLATES & EXPENSES ---
  require("./barcode-expenses")(app, deps);

  // --- ATTENDANCE ---
  require("./attendance")(app, deps);

  // --- INTEGRATIONS HUB ---
  require("./integrations")(app, deps);

  // --- COURIERS ---
  require("./couriers")(app, deps);

  // --- FULFILLMENT (PICK/PACK/DISPATCH) ---
  require("./fulfillment")(app, deps);

  // --- BULK IMPORT ---
  require("./import")(app, deps);

  // --- ROUTES: BILLING ---
  require("./billing")(app, deps);

  // --- ROUTES: SUPPORT TICKETS ---
  require("./support")(app, deps);

  // --- ROUTES: FBR DIGITAL INVOICING ---
  require("./fbr")(app, deps);

  // --- ROUTES: TAX LOOKUP ---
  require("./tax-lookup")(app, deps);

  // --- MARKETING CAMPAIGNS ---
  require("./marketing")(app, deps);

  // --- CUSTOMER MESSAGING INBOX ---
  require("./messaging")(app, deps);

  // --- CUSTOMER INVOICES ---
  require("./customer-invoices")(app, deps);

  // --- SUBSCRIPTIONS ---
  require("./subscriptions")(app, deps);

  // --- Phase 4 — New Verticals ---
  require("./restaurant")(app, deps);
  require("./restaurant/availability")(app, deps);
  require("./restaurant/void-comp")(app, deps);
  require("./restaurant/menu-schedules")(app, deps);
  require("./restaurant/pay-at-table")(app, deps);
  require("./restaurant/reservations")(app, deps);
  require("./restaurant/waitlist")(app, deps);
  require("./kds")(app, deps);
  require("./modifiers")(app, deps);
  require("./restaurant-inbox")(app, deps);
  require("./restaurant-kiosk")(app, deps);
  require("./bookings")(app, deps);
  require("./classes")(app, deps); // F06 — class sessions timetable + waitlist
  require("./members")(app, deps); // V07 gym — front-desk member lookup + check-in + today's feed
  require("./projects")(app, deps);
  require("./contracts")(app, deps);
  require("./service-tickets")(app, deps);
  require("./rentals")(app, deps);
  require("./rooms")(app, deps);
  require("./treatment-plans")(app, deps);
  require("./treatment-plan-templates")(app, deps);

  // --- F05 customer notifications: per-event channel rules + delivery log ---
  require("./notification-settings")(app, deps);
  // F03 — Form builder (intake/waivers/questionnaires). Cross-vertical;
  // gated by custom_forms flag + manage_forms perm inside the route.
  require("./forms")(app, deps);

  // --- Tier 1.1 wholesale: field rep mobile app ---
  require("./field")(app, deps);

  // --- Tier 1.4 wholesale: manufacturer-partner admin CRUD ---
  // Tenant-scoped (mounted after tenant middleware). The manufacturer
  // portal's own endpoints mount above, BEFORE tenant middleware.
  require("./manufacturer-partners")(app, deps);

  return {
    processPendingShopifyInventoryEvents:
      typeof processPendingShopifyInventoryEvents === "function"
        ? processPendingShopifyInventoryEvents
        : () => {},
    processPendingReportSchedules:
      typeof processPendingReportSchedules === "function"
        ? processPendingReportSchedules
        : () => {},
  };
};
