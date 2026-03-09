module.exports = function registerAllRoutes(app, deps) {
  const {
    db,
    fs,
    path,
    multer,
    sqlite3,
    requirePerm,
    requireAnyPerm,
    requireFeature,
    requirePlanLimit,
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
  } = deps;

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
  app.use(requireContextOutlet);
  ensureDefaultRolePermissions();

  // Enforce outlet assignment for non-admin employees on branch-scoped requests.
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    // Kiosk PIN routes are public (PIN is the auth) — skip session-based outlet check
    if (req.path.startsWith("/api/attendance/pin-")) return next();
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return next();
    const perms = req.employeePerms || [];
    if (perms.includes("all_access")) return next();

    const headerOutletId = Number(req.headers["x-outlet-id"] || 0);
    const contextOutletId = Number(req.context?.outletId || 0);
    const queryOutletId = Number(req.query?.outlet_id || 0);
    const bodyOutletId = Number(req.body?.outlet_id || 0);
    const outletId =
      contextOutletId || headerOutletId || queryOutletId || bodyOutletId;

    if (!outletId) return next();

    db.get(
      "SELECT 1 FROM employee_outlets WHERE employee_id = ? AND outlet_id = ? LIMIT 1",
      [employeeId, outletId],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
          return res.status(403).json({
            error:
              "Forbidden: outlet is not assigned to this employee account.",
          });
        }
        return next();
      },
    );
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

  app.get("/api/feature-flags", (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    db.all(
      "SELECT key, enabled, description, updated_by, updated_at FROM feature_flags ORDER BY key ASC",
      [],
      (err, rows) => {
        if (err) {
          if (String(err.message || "").includes("no such table")) {
            const fallback = Object.keys(DEFAULT_FEATURE_FLAGS).map((k) => ({
              key: k,
              enabled: DEFAULT_FEATURE_FLAGS[k] ? 1 : 0,
              description: null,
              updated_by: null,
              updated_at: null,
            }));
            return res.json({ flags: fallback });
          }
          return res.status(500).json({ error: err.message });
        }
        const rowMap = new Map((rows || []).map((r) => [r.key, r]));
        const mergedDefaults = Object.keys(DEFAULT_FEATURE_FLAGS).map((key) => {
          const existing = rowMap.get(key);
          if (existing) return existing;
          return {
            key,
            enabled: DEFAULT_FEATURE_FLAGS[key] ? 1 : 0,
            description: null,
            updated_by: null,
            updated_at: null,
          };
        });
        const extras = (rows || []).filter(
          (r) =>
            !Object.prototype.hasOwnProperty.call(DEFAULT_FEATURE_FLAGS, r.key),
        );
        return res.json({ flags: [...mergedDefaults, ...extras] });
      },
    );
  });

  app.put(
    "/api/feature-flags/:key",
    requirePerm("all_access"),
    (req, res) => {
      const { key } = req.params;
      const { enabled, description, updated_by } = req.body || {};
      const enabledInt = enabled ? 1 : 0;
      db.run(
        `INSERT INTO feature_flags (key, enabled, description, updated_by, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       enabled = excluded.enabled,
       description = COALESCE(excluded.description, feature_flags.description),
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`,
        [key, enabledInt, description || null, updated_by || null],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Feature flag updated",
            key,
            enabled: enabledInt,
          });
        },
      );
    },
  );

  app.get("/api/health", (req, res) => {
    const requiredTables = [
      "sales",
      "sale_items",
      "sale_payments",
      "backup_log",
      "invoice_sequences",
      "feature_flags",
    ];
    db.all(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${requiredTables
        .map(() => "?")
        .join(",")})`,
      requiredTables,
      (err, rows) => {
        if (err)
          return res.status(500).json({ status: "error", error: err.message });
        const found = new Set((rows || []).map((r) => r.name));
        const missingTables = requiredTables.filter((t) => !found.has(t));
        const ok = missingTables.length === 0;
        res.status(ok ? 200 : 503).json({
          status: ok ? "ok" : "degraded",
          database: "reachable",
          restore_lock: runtimeState.isRestoreInProgress,
          missing_tables: missingTables,
          checked_at: new Date().toISOString(),
        });
      },
    );
  });

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

  // --- REPORTS ---
  const { processPendingReportSchedules } =
    require("./reports/index")(app, deps) || {};

  // --- ROUTES: RETURNS ---
  require("./returns")(app, deps);

  // --- ROUTES: ATTRIBUTE SETS ---
  require("./attribute-sets")(app, deps);

  // --- RECEIPT TEMPLATES & ACTION HISTORY ---
  require("./receipt-templates")(app, deps);

  // --- ROUTES: PRINTER (ESC/POS hardware) ---
  require("./printer")(app, deps);

  // --- ROUTES: EMAIL (SMTP receipt delivery) ---
  require("./email")(app, deps);

  // --- SUPPLIER RETURNS (RMA) ---
  require("./supplier-returns")(app, deps);

  // --- ROUTES: PARKED SALES ---
  require("./parked-sales")(app, deps);

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

  // --- BARCODE TEMPLATES & EXPENSES ---
  require("./barcode-expenses")(app, deps);

  // --- ATTENDANCE ---
  require("./attendance")(app, deps);

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
