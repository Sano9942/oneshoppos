const Papa = require("papaparse");
const { asyncStore } = require("../tenant-db-proxy-pg");
const {
  getMapper,
  getTemplate,
  listSources,
  getTargetFields,
  buildColumnMapper,
  suggestColumnMap,
} = require("../services/import/mappers");

// Multer consumes the multipart request stream via socket-level events, which
// run in the async context that existed at connection time — BEFORE
// resolveTenant wrapped the request in asyncStore.run({ db }). That drops the
// AsyncLocalStorage tenant-DB store, so any deps.db (proxy) query in the handler
// AFTER the upload throws "[tenant-db-proxy-pg] No tenant DB in async context".
// This wrapper captures the store while it's still active (upload middleware is
// invoked synchronously inside the ALS context) and re-establishes it for the
// rest of the request once multer finishes. No-op in single-tenant mode, where
// getStore() is undefined and deps.db is the direct pool.
function withTenantContext(mw) {
  return (req, res, next) => {
    const store = asyncStore.getStore();
    mw(req, res, (err) => {
      if (err) return next(err);
      if (store) return asyncStore.run(store, next);
      next();
    });
  };
}

module.exports = function mountImportRoutes(app, deps) {
  const { db, multer, requirePerm } = deps;

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  // ---------------------------------------------------------------------------
  // Helper: parse an uploaded CSV into an array of row objects.
  //
  // CSV ONLY. This used to run every upload — .csv and .xlsx alike — through
  // XLSX.read(), which is why the `xlsx` dependency was here at all. That
  // package is frozen at 0.18.5 on npm with two advisories (prototype
  // pollution, ReDoS) whose fixes are published only to SheetJS's own registry,
  // so npm can see the problem and never the remedy. Parsing merchant-supplied
  // spreadsheets with it was the one unfixable exposure in the product.
  //
  // Papa.parse is used rather than a hand-rolled split(","), deliberately: the
  // only CSV parsing previously written by hand in this repo is
  // CustomerGroupPriceBookRedesign.jsx's naive split, which breaks on any
  // quoted field containing a comma. Product names and addresses contain
  // commas. XLSX was doing correct RFC-4180 quoting for free and dropping it
  // without a real parser would have traded a CVE for silent data corruption on
  // the path that sets prices and stock.
  //
  // Options chosen to match the previous behaviour exactly:
  //   header: true          → row objects keyed by the header row, as
  //                           sheet_to_json produced
  //   dynamicTyping: false  → every value stays a string, which is what
  //                           `raw: false` gave us. It matters twice: ISO dates
  //                           ("2026-04-29") must not become numbers, or
  //                           Date.parse() in the expenses/payments validators
  //                           breaks; and a barcode or SKU like "007" must keep
  //                           its leading zeros. Numeric fields still parse
  //                           cleanly downstream via parseFloat.
  //   skipEmptyLines: "greedy" → drops blank and whitespace-only rows, which a
  //                           spreadsheet export leaves at the end of a file.
  // ---------------------------------------------------------------------------
  function parseFile(buffer) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, ""); // strip Excel's BOM
    const { data } = Papa.parse(text, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: "greedy",
      transformHeader: (h) => String(h).trim(),
    });
    // Papa reports malformed rows in `errors` but still returns what it could
    // read. The per-row validators downstream already reject incomplete rows
    // with a reason the merchant sees, so surfacing parse errors separately
    // would report the same bad row twice.
    return data.map((row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) out[k] = v == null ? "" : v;
      return out;
    });
  }

  /**
   * Send a download template as CSV.
   *
   * Was an .xlsx workbook. The trade-off is worth stating where the code is,
   * because it is a real regression for barcode retail: an .xlsx template could
   * mark SKU and barcode columns as text, so a value like "007" survived being
   * opened in Excel. A CSV carries no formatting, so a merchant who opens the
   * template in Excel and re-saves it can lose leading zeros before uploading.
   * The import itself is unaffected — parseFile keeps every value a string —
   * and the exposure this removes (an unfixable parser CVE on merchant-supplied
   * files) was judged the larger risk. If leading zeros become a real support
   * burden, the fix is a UTF-8 BOM plus quoted values, not a return to xlsx.
   */
  function sendCsvTemplate(res, filename, headers, exampleRows) {
    // BOM so Excel opens UTF-8 correctly on Windows — without it, non-ASCII
    // product names arrive mojibaked, which is how most merchants here will
    // first see the file.
    const csv = "\uFEFF" + Papa.unparse({ fields: headers, data: exampleRows });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}_template.csv"`);
    return res.send(csv);
  }

  /**
   * Reject anything that is not a CSV before it reaches the parser.
   *
   * Checked on the extension rather than the MIME type because browsers and
   * operating systems disagree wildly about CSV's type — Windows with Excel
   * installed sends `application/vnd.ms-excel` for a .csv file — so a MIME
   * allowlist would refuse legitimate uploads from the machines merchants
   * actually use.
   *
   * @returns {string|null} an error message, or null when the file is fine
   */
  function rejectNonCsv(file) {
    if (!file) return "No file uploaded";
    const name = String(file.originalname || "");
    if (/\.(xlsx|xlsm|xlsb|xls)$/i.test(name)) {
      return "Excel files are no longer accepted. Save your sheet as CSV (File → Save As → CSV) and upload that. Download the template below for the exact columns.";
    }
    if (!/\.csv$/i.test(name)) {
      return `Unsupported file type "${name.split(".").pop() || name}". Upload a .csv file.`;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Helper: trim & normalise keys to snake_case-ish (lowercase, spaces→_)
  // ---------------------------------------------------------------------------
  function normaliseRow(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = String(k).trim().toLowerCase().replace(/\s+/g, "_");
      out[key] = typeof v === "string" ? v.trim() : v;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Helper: if ?source=<shopify|square> is set, run raw rows through the
  // competitor mapper before normaliseRow(). Unknown source = ignored.
  // Returns the mapped rows (still in their raw-capitalised shape for Shopify)
  // which normaliseRow() will then lowercase + snake_case downstream.
  // ---------------------------------------------------------------------------
  function applySourceMapper(rawRows, source, entity) {
    const mapper = getMapper(source, entity);
    if (!mapper) return rawRows;
    return mapper(rawRows);
  }

  // ---------------------------------------------------------------------------
  // Helper: parse an optional column_map (WS4 supplier-catalog import). Sent as
  // a multipart form field (JSON string) alongside the file, or a query param.
  // Returns a plain { "Their Header": "our_field" } object, or null.
  // ---------------------------------------------------------------------------
  function parseColumnMap(req) {
    const raw = req.body?.column_map ?? req.query?.column_map;
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: resolve the row shape for an import request. A supplier-catalog
  // column_map takes precedence over a competitor ?source= mapper; if neither
  // is present the raw rows pass through unchanged.
  // ---------------------------------------------------------------------------
  function resolveMappedRows(raw, source, columnMap, entity) {
    if (columnMap) {
      const mapper = buildColumnMapper(columnMap);
      if (mapper) return mapper(raw);
    }
    if (source) return applySourceMapper(raw, source, entity);
    return raw;
  }

  // ---------------------------------------------------------------------------
  // Helper: build unified preview response. Merges valid[] + errors[] back into
  // a single ordered rows[] array (one entry per input data row, in original
  // file order), with `_row` (line number) and `_errors` (string[], empty when
  // valid) on each. Frontend ImportRedesign.jsx reads `preview.rows[]._errors`
  // — keep this shape stable.
  // ---------------------------------------------------------------------------
  function buildPreviewResponse(valid, errors, totalRows) {
    const byRow = new Map();
    for (const v of valid) {
      const { row, ...fields } = v;
      byRow.set(row, { _row: row, _errors: [], ...fields });
    }
    for (const e of errors) {
      byRow.set(e.row, { _row: e.row, _errors: e.errors, ...e.data });
    }
    const rows = [];
    for (let i = 0; i < totalRows; i++) {
      const rowNum = i + 2;
      if (byRow.has(rowNum)) rows.push(byRow.get(rowNum));
    }
    return { preview: true, rows, valid: valid.length, errors: errors.length };
  }

  // ---------------------------------------------------------------------------
  // Helper: auto-SKU generation (Phase 1 fast-entry). A product with neither a
  // SKU nor a barcode is unscannable at POS, so when auto_sku is on (default) we
  // mint a sequential code (<prefix><zero-padded seq>) for those rows. The seed
  // starts past any existing <prefix><number> SKU so generated codes can't
  // collide with previously generated ones.
  // ---------------------------------------------------------------------------
  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function seedSkuSequence(existingSkusLower, prefixLower) {
    const re = new RegExp(`^${escapeRegExp(prefixLower)}(\\d+)$`);
    let max = 0;
    for (const s of existingSkusLower) {
      const m = re.exec(s);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max;
  }

  // ---------------------------------------------------------------------------
  // POST /api/import/products
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/products",
    requirePerm("all_access"),
    withTenantContext(upload.single("file")),
    async (req, res) => {
      try {
        const badFile = rejectNonCsv(req.file);
        if (badFile) return res.status(400).json({ error: badFile });

        const source = req.query.source ? String(req.query.source).toLowerCase() : null;
        const columnMap = parseColumnMap(req);
        const raw = parseFile(req.file.buffer);
        const mapped = resolveMappedRows(raw, source, columnMap, "products");
        const rows = mapped.map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";

        // Pre-fetch lookup tables + existing non-NULL SKUs (for F9 DB-collision check)
        const [catRows, brandRows, taxRows, skuRows] = await Promise.all([
          db.query("SELECT id, name, default_margin_percent FROM categories"),
          db.query("SELECT id, name FROM brands"),
          db.query("SELECT id, name FROM taxes"),
          db.query("SELECT sku FROM products WHERE sku IS NOT NULL"),
        ]);
        const catMap = new Map(catRows.rows.map((r) => [r.name.toLowerCase(), r.id]));
        // WS4 cost→price: category id → default markup %. Used to auto-fill a
        // missing selling_price from cost_price on import.
        const catMarginMap = new Map(
          catRows.rows
            .filter((r) => r.default_margin_percent != null)
            .map((r) => [r.id, Number(r.default_margin_percent)]),
        );
        const brandMap = new Map(brandRows.rows.map((r) => [r.name.toLowerCase(), r.id]));
        const taxMap = new Map(taxRows.rows.map((r) => [r.name.toLowerCase(), r.id]));
        const dbSkus = new Set(skuRows.rows.map((r) => String(r.sku).toLowerCase()));

        // Auto-SKU (Phase 1 fast-entry): mint codes for code-less rows so nothing
        // is unscannable at POS. On by default; ?auto_sku=0 disables it, and
        // ?sku_prefix overrides the "SKU-" prefix. skuSeq advances past existing
        // <prefix><number> codes so generated SKUs never collide.
        const autoSku = req.query.auto_sku !== "0";
        const skuPrefix = (req.query.sku_prefix ? String(req.query.sku_prefix) : "SKU-").trim() || "SKU-";
        let skuSeq = autoSku ? seedSkuSequence(dbSkus, skuPrefix.toLowerCase()) : 0;

        const valid = [];
        const errors = [];
        // F8: track in-file SKU occurrences. First non-empty occurrence wins;
        // subsequent rows with the same SKU error out referencing the first row.
        const skuFirstRow = new Map(); // skuLowercase -> firstRowNum

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2; // +2 because row 1 is header
          const rowErrors = [];

          if (!r.name) rowErrors.push("name is required");

          // Resolve category first — its default margin can auto-fill a missing
          // selling price (WS4 cost→price rule).
          let category_id = null;
          if (r.category) {
            category_id = catMap.get(String(r.category).toLowerCase()) || null;
            if (!category_id) rowErrors.push(`category "${r.category}" not found`);
          }

          const costPrice = parseFloat(r.cost_price || "0") || 0;

          // F11: distinguish between empty and non-numeric so the error is
          // actionable. The previous wording said "is required and must be a
          // number" even when the field had content like "Rs 850" — which
          // misleads merchants into thinking the column is empty.
          const priceRaw = String(r.selling_price ?? r.price ?? "").trim();
          let sellingPrice = NaN;
          if (!priceRaw) {
            // WS4 cost→price: derive retail from cost × (1 + category margin%)
            // when the row has a cost and its category carries a default markup.
            // Only then is a missing selling_price acceptable.
            const margin = category_id != null ? catMarginMap.get(category_id) : null;
            if (margin != null && costPrice > 0) {
              sellingPrice = Math.round(costPrice * (1 + margin / 100) * 100) / 100;
            } else {
              rowErrors.push("selling_price is required");
            }
          } else {
            sellingPrice = parseFloat(priceRaw);
            if (isNaN(sellingPrice)) {
              rowErrors.push(`selling_price "${priceRaw}" is not a number`);
            }
          }

          // F8/F9: SKU duplicate detection (skip when SKU is empty — NULL SKUs allowed)
          const skuRaw = String(r.sku || "").trim();
          if (skuRaw) {
            const skuKey = skuRaw.toLowerCase();
            const firstRow = skuFirstRow.get(skuKey);
            if (firstRow !== undefined) {
              rowErrors.push(`duplicate SKU "${skuRaw}" already used on row ${firstRow}`);
            } else {
              skuFirstRow.set(skuKey, rowNum);
              if (dbSkus.has(skuKey)) {
                rowErrors.push(`SKU "${skuRaw}" already exists in inventory`);
              }
            }
          }

          // Lookup remaining foreign keys
          let brand_id = null;
          if (r.brand) {
            brand_id = brandMap.get(String(r.brand).toLowerCase()) || null;
            if (!brand_id) rowErrors.push(`brand "${r.brand}" not found`);
          }
          let tax_id = null;
          if (r.tax || r.tax_group) {
            const taxName = String(r.tax || r.tax_group).toLowerCase();
            tax_id = taxMap.get(taxName) || null;
            if (!tax_id) rowErrors.push(`tax "${r.tax || r.tax_group}" not found`);
          }

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            // Mint a SKU for code-less rows (no sku AND no barcode) when auto_sku
            // is enabled; otherwise leave sku NULL as before. _sku_generated and
            // _price_source are advisory preview markers so the shopkeeper can
            // see (and confirm) which codes/prices the system filled in — they
            // are ignored by the INSERT below, which cherry-picks columns.
            const barcodeRaw = String(r.barcode || "").trim();
            let finalSku = skuRaw || null;
            let skuGenerated = false;
            if (autoSku && !skuRaw && !barcodeRaw) {
              do {
                skuSeq += 1;
                finalSku = `${skuPrefix}${String(skuSeq).padStart(5, "0")}`;
              } while (dbSkus.has(finalSku.toLowerCase()) || skuFirstRow.has(finalSku.toLowerCase()));
              dbSkus.add(finalSku.toLowerCase());
              skuGenerated = true;
            }
            valid.push({
              row: rowNum,
              name: r.name,
              sku: finalSku,
              _sku_generated: skuGenerated,
              barcode: r.barcode || null,
              price: sellingPrice,
              _price_source: priceRaw ? "file" : "margin",
              cost_price: costPrice,
              category_id,
              brand_id,
              tax_id,
              unit: r.unit || "pcs",
              stock_quantity: parseInt(r.stock_quantity || "0", 10) || 0,
              supplier_id: r.supplier_id ? parseInt(r.supplier_id, 10) : null,
              status: r.status || "active",
            });
          }
        }

        if (isPreview) {
          // WS4 fuzzy name-match — flag valid rows whose name closely matches an
          // existing product ("row looks like SKU X — merge?"). Advisory only;
          // we never auto-merge (false-match risk). Requires pg_trgm; wrapped in
          // try/catch so a tenant without the extension degrades to no hints.
          const namesForMatch = valid.map((v) => v.name);
          if (namesForMatch.length) {
            try {
              const { rows: matches } = await db.query(
                `SELECT q.idx::int AS idx, m.id, m.name, m.sku,
                        round(m.sim::numeric, 2) AS sim
                   FROM unnest($1::text[]) WITH ORDINALITY AS q(name, idx)
                   JOIN LATERAL (
                     SELECT p.id, p.name, p.sku, public.similarity(p.name, q.name) AS sim
                       FROM products p
                      WHERE p.deleted_at IS NULL
                        AND public.similarity(p.name, q.name) > 0.45
                      ORDER BY public.similarity(p.name, q.name) DESC
                      LIMIT 1
                   ) m ON true`,
                [namesForMatch],
              );
              for (const mrow of matches) {
                const v = valid[mrow.idx - 1];
                if (v) {
                  v._suggestion = {
                    product_id: mrow.id,
                    name: mrow.name,
                    sku: mrow.sku,
                    similarity: Number(mrow.sim),
                  };
                }
              }
            } catch (e) {
              console.warn("Import name-match skipped:", e.message);
            }
          }
          return res.json(buildPreviewResponse(valid, errors, rows.length));
        }

        // Bulk insert in transaction. Outlet context comes from the shared
        // validated resolver via resolveContext (Step 9) — never the raw header.
        const outletId = req.context?.outletId || null;
        let imported = 0;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const p of valid) {
            const { rows: ins } = await client.query(
              `INSERT INTO products (name, sku, barcode, price, cost_price, category_id, brand_id, tax_id, unit, supplier_id, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
              [p.name, p.sku, p.barcode, p.price, p.cost_price, p.category_id, p.brand_id, p.tax_id, p.unit, p.supplier_id, p.status],
            );
            const productId = ins[0].id;

            if (p.stock_quantity > 0 && outletId) {
              await client.query(
                `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
                 ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + EXCLUDED.quantity`,
                [productId, outletId, p.stock_quantity],
              );
            }
            imported++;
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return res.json({ imported, errors });
      } catch (err) {
        console.error("Import products error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/import/customers
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/customers",
    requirePerm("all_access"),
    withTenantContext(upload.single("file")),
    async (req, res) => {
      try {
        const badFile = rejectNonCsv(req.file);
        if (badFile) return res.status(400).json({ error: badFile });

        const source = req.query.source ? String(req.query.source).toLowerCase() : null;
        const columnMap = parseColumnMap(req);
        const raw = parseFile(req.file.buffer);
        const mapped = resolveMappedRows(raw, source, columnMap, "customers");
        const rows = mapped.map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";
        const valid = [];
        const errors = [];
        // F15: track in-file duplicate mobile numbers (when present).
        const mobileFirstRow = new Map(); // normalisedMobile -> firstRowNum
        // Lightweight email shape check — not RFC 5322, but catches "no-at-sign"
        // and obviously-malformed strings without false-flagging unicode locals.
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2;
          const rowErrors = [];

          if (!r.name) rowErrors.push("name is required");

          // F14: email format validation when present (empty is fine — optional)
          const emailRaw = String(r.email || "").trim();
          if (emailRaw && !EMAIL_RE.test(emailRaw)) {
            rowErrors.push(`email "${emailRaw}" is not a valid email format`);
          }

          // F15: in-file duplicate mobile detection (when mobile is provided)
          const mobileRaw = String(r.mobile || r.phone || "").trim();
          if (mobileRaw) {
            // Normalise: strip whitespace and dashes for comparison so
            // "0300 1112222" / "0300-1112222" / "03001112222" all collide.
            const mobileKey = mobileRaw.replace(/[\s-]/g, "");
            const firstRow = mobileFirstRow.get(mobileKey);
            if (firstRow !== undefined) {
              rowErrors.push(`duplicate mobile "${mobileRaw}" already used on row ${firstRow}`);
            } else {
              mobileFirstRow.set(mobileKey, rowNum);
            }
          }

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            valid.push({
              row: rowNum,
              name: r.name,
              mobile: r.mobile || r.phone || null,
              email: r.email || null,
              address: r.address || null,
              cnic: r.cnic || null,
              occupation: r.occupation || null,
            });
          }
        }

        if (isPreview) {
          return res.json(buildPreviewResponse(valid, errors, rows.length));
        }

        let imported = 0;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const c of valid) {
            await client.query(
              `INSERT INTO customers (name, mobile, email, address, cnic, occupation) VALUES ($1, $2, $3, $4, $5, $6)`,
              [c.name, c.mobile, c.email, c.address, c.cnic, c.occupation],
            );
            imported++;
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return res.json({ imported, errors });
      } catch (err) {
        console.error("Import customers error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/import/suppliers
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/suppliers",
    requirePerm("all_access"),
    withTenantContext(upload.single("file")),
    async (req, res) => {
      try {
        const badFile = rejectNonCsv(req.file);
        if (badFile) return res.status(400).json({ error: badFile });

        const columnMap = parseColumnMap(req);
        const raw = parseFile(req.file.buffer);
        const rows = resolveMappedRows(raw, null, columnMap, "suppliers").map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";
        const valid = [];
        const errors = [];
        // F12: track first occurrence of each supplier name so we can flag
        // in-file duplicates. Comparison is case-insensitive on trimmed name.
        const nameFirstRow = new Map(); // nameLowercase -> firstRowNum

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2;
          const rowErrors = [];

          if (!r.name) rowErrors.push("name is required");

          // F12: in-file duplicate name detection
          const nameRaw = String(r.name || "").trim();
          if (nameRaw) {
            const nameKey = nameRaw.toLowerCase();
            const firstRow = nameFirstRow.get(nameKey);
            if (firstRow !== undefined) {
              rowErrors.push(`duplicate supplier name "${nameRaw}" already used on row ${firstRow}`);
            } else {
              nameFirstRow.set(nameKey, rowNum);
            }
          }

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            valid.push({
              row: rowNum,
              name: r.name,
              contact_person: r.contact_person || null,
              phone: r.phone || null,
              email: r.email || null,
              address: r.address || null,
              payment_terms: r.payment_terms || "cash",
              credit_days: parseInt(r.credit_days || "0", 10) || 0,
              credit_limit: parseFloat(r.credit_limit || "0") || 0,
            });
          }
        }

        if (isPreview) {
          return res.json(buildPreviewResponse(valid, errors, rows.length));
        }

        let imported = 0;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const s of valid) {
            await client.query(
              `INSERT INTO suppliers (name, contact_person, phone, email, address, payment_terms, credit_days, credit_limit)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [s.name, s.contact_person, s.phone, s.email, s.address, s.payment_terms, s.credit_days, s.credit_limit],
            );
            imported++;
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return res.json({ imported, errors });
      } catch (err) {
        console.error("Import suppliers error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/import/expenses
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/expenses",
    requirePerm("all_access"),
    withTenantContext(upload.single("file")),
    async (req, res) => {
      try {
        const badFile = rejectNonCsv(req.file);
        if (badFile) return res.status(400).json({ error: badFile });

        const rows = parseFile(req.file.buffer).map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";

        // Pre-fetch expense categories
        const catRows = await db.query("SELECT id, name FROM expense_categories");
        const catMap = new Map(catRows.rows.map((r) => [r.name.toLowerCase(), r.id]));

        const valid = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2;
          const rowErrors = [];

          // Required: date, category, amount
          const expenseDate = r.date || r.expense_date || "";
          if (!expenseDate) rowErrors.push("date is required");
          else if (isNaN(Date.parse(expenseDate))) rowErrors.push("date is not valid");

          if (!r.category) rowErrors.push("category is required");
          let category_id = null;
          if (r.category) {
            category_id = catMap.get(String(r.category).toLowerCase()) || null;
            if (!category_id) rowErrors.push(`category "${r.category}" not found`);
          }

          const amount = parseFloat(r.amount || "");
          if (isNaN(amount) || amount <= 0) rowErrors.push("amount must be a positive number");

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            valid.push({
              row: rowNum,
              date: expenseDate,
              category: r.category,
              category_id,
              amount,
              description: r.description || null,
              reference: r.reference || null,
              outlet_id: r.outlet_id ? parseInt(r.outlet_id, 10) : null,
            });
          }
        }

        if (isPreview) {
          return res.json(buildPreviewResponse(valid, errors, rows.length));
        }

        const employeeId = req.employee?.id || null;
        let imported = 0;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const e of valid) {
            await client.query(
              `INSERT INTO expenses (expense_date, category_id, amount, description, reference, outlet_id, employee_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [e.date, e.category_id, e.amount, e.description, e.reference, e.outlet_id, employeeId],
            );
            imported++;
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return res.json({ imported, errors });
      } catch (err) {
        console.error("Import expenses error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/import/payments
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/payments",
    requirePerm("all_access"),
    withTenantContext(upload.single("file")),
    async (req, res) => {
      try {
        const badFile = rejectNonCsv(req.file);
        if (badFile) return res.status(400).json({ error: badFile });

        const rows = parseFile(req.file.buffer).map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";

        // Pre-fetch suppliers (by name and id)
        const supRows = await db.query("SELECT id, name FROM suppliers");
        const supByName = new Map(supRows.rows.map((r) => [r.name.toLowerCase(), r.id]));
        const supById = new Map(supRows.rows.map((r) => [String(r.id), r.id]));

        // Pre-fetch supplier invoices keyed by (supplier_id, invoice_number)
        const invRows = await db.query("SELECT id, supplier_id, invoice_number, amount, status FROM supplier_invoices");
        const invMap = new Map();
        for (const inv of invRows.rows) {
          if (inv.invoice_number) {
            invMap.set(`${inv.supplier_id}:${inv.invoice_number.toLowerCase()}`, inv);
          }
        }

        const valid = [];
        const errors = [];
        // F13: track first occurrence of (supplier_id, invoice_number, amount, date)
        // tuples so we can flag in-file duplicate payments — guards against
        // accidental double-pay when a merchant uploads the same payment list twice.
        const paymentFirstRow = new Map(); // tupleKey -> firstRowNum

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2;
          const rowErrors = [];

          // Resolve supplier
          const supplierVal = String(r.supplier || "").trim();
          if (!supplierVal) rowErrors.push("supplier is required");
          let supplier_id = null;
          if (supplierVal) {
            supplier_id = supById.get(supplierVal) || supByName.get(supplierVal.toLowerCase()) || null;
            if (!supplier_id) rowErrors.push(`supplier "${supplierVal}" not found`);
          }

          // Resolve invoice
          const invoiceNum = String(r.invoice_number || "").trim();
          if (!invoiceNum) rowErrors.push("invoice_number is required");
          let invoice = null;
          if (supplier_id && invoiceNum) {
            invoice = invMap.get(`${supplier_id}:${invoiceNum.toLowerCase()}`) || null;
            if (!invoice) rowErrors.push(`invoice "${invoiceNum}" not found for this supplier`);
          }

          const amount = parseFloat(r.amount || "");
          if (isNaN(amount) || amount <= 0) rowErrors.push("amount must be a positive number");

          const payDate = r.date || r.paid_at || "";
          if (!payDate) rowErrors.push("date is required");
          else if (isNaN(Date.parse(payDate))) rowErrors.push("date is not valid");

          // F13: dup-payment detection — only fire when all four parts are
          // valid, so we don't pile on top of other errors that already
          // explain the row.
          if (supplier_id && invoiceNum && !isNaN(amount) && amount > 0 && payDate && !isNaN(Date.parse(payDate))) {
            const tupleKey = `${supplier_id}|${invoiceNum.toLowerCase()}|${amount}|${payDate}`;
            const firstRow = paymentFirstRow.get(tupleKey);
            if (firstRow !== undefined) {
              rowErrors.push(`duplicate payment matches row ${firstRow} (same invoice, amount, and date)`);
            } else {
              paymentFirstRow.set(tupleKey, rowNum);
            }
          }

          const paymentMethod = r.payment_method || "Cash";

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            valid.push({
              row: rowNum,
              supplier: supplierVal,
              supplier_id,
              invoice_number: invoiceNum,
              supplier_invoice_id: invoice.id,
              invoice_amount: Number(invoice.amount),
              amount,
              date: payDate,
              payment_method: paymentMethod,
              reference: r.reference || null,
              notes: r.notes || null,
            });
          }
        }

        if (isPreview) {
          return res.json(buildPreviewResponse(valid, errors, rows.length));
        }

        let imported = 0;
        const paidBy = req.employee?.name || null;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const p of valid) {
            await client.query(
              `INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, paid_at, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [p.supplier_invoice_id, p.supplier_id, p.amount, p.payment_method, p.reference, paidBy, p.date, p.notes],
            );

            // Update invoice status based on total payments
            const { rows: totals } = await client.query(
              "SELECT COALESCE(SUM(amount), 0) AS total_paid FROM supplier_payments WHERE supplier_invoice_id = $1",
              [p.supplier_invoice_id],
            );
            const totalPaid = Number(totals[0].total_paid);
            const newStatus = totalPaid >= p.invoice_amount ? "paid" : "partial";
            await client.query(
              "UPDATE supplier_invoices SET status = $1 WHERE id = $2",
              [newStatus, p.supplier_invoice_id],
            );

            imported++;
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return res.json({ imported, errors });
      } catch (err) {
        console.error("Import payments error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/import/:entity/inspect
  // WS4 supplier-catalog import. Parse an uploaded file and return its raw
  // column headers + a sample row + our canonical target fields + a suggested
  // auto-mapping. The frontend renders a "map their header → our field" step,
  // then re-uploads for preview/import with a `column_map` form field.
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/:entity/inspect",
    requirePerm("all_access"),
    withTenantContext(upload.single("file")),
    (req, res) => {
      try {
        const { entity } = req.params;
        const targetFields = getTargetFields(entity);
        if (!targetFields) {
          return res.status(400).json({
            error: `Column mapping is not supported for "${entity}". Supported: products, customers, suppliers`,
          });
        }
        const badFile = rejectNonCsv(req.file);
        if (badFile) return res.status(400).json({ error: badFile });

        const raw = parseFile(req.file.buffer);
        if (!raw.length) {
          return res.status(400).json({ error: "File is empty or has no data rows" });
        }

        // Collect the union of keys across the first few rows — the first row
        // alone can miss columns that are blank in row 1.
        const headerSet = new Set();
        for (const r of raw.slice(0, 20)) {
          for (const k of Object.keys(r)) headerSet.add(k);
        }
        const headers = [...headerSet];

        return res.json({
          headers,
          sample: raw[0],
          row_count: raw.length,
          target_fields: targetFields,
          suggested: suggestColumnMap(headers, entity),
        });
      } catch (err) {
        console.error("Import inspect error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/import/template/:entity
  // Optional ?source=shopify|square → delivers a source-specific template so
  // merchants can export from Shopify/Square and upload the file directly.
  // ---------------------------------------------------------------------------
  app.get(
    "/api/import/template/:entity",
    requirePerm("all_access"),
    (req, res) => {
      const { entity } = req.params;
      const source = req.query.source ? String(req.query.source).toLowerCase() : null;
      let headers;
      let exampleRows;

      if (source) {
        const tpl = getTemplate(source, entity);
        if (!tpl) {
          return res.status(400).json({
            error: `No ${source} template for "${entity}". Supported sources: ${listSources().join(", ")}. Supported entities for a source: products, customers`,
          });
        }
        headers = tpl.headers;
        exampleRows = tpl.examples;
        return sendCsvTemplate(res, `${source}_${entity}`, headers, exampleRows);
      }

      switch (entity) {
        case "products":
          headers = ["name", "sku", "barcode", "selling_price", "cost_price", "category", "brand", "tax", "unit", "stock_quantity", "status"];
          exampleRows = [
            ["Widget A", "WDG-001", "1234567890123", 29.99, 15.00, "Electronics", "Acme", "GST 17%", "pcs", 100, "active"],
            ["Widget B", "WDG-002", "1234567890124", 49.99, 25.00, "Accessories", "Acme", "GST 17%", "pcs", 50, "active"],
          ];
          break;
        case "customers":
          headers = ["name", "mobile", "email", "address", "cnic", "occupation"];
          exampleRows = [
            ["John Doe", "03001234567", "john@example.com", "123 Main St", "12345-6789012-3", "Engineer"],
            ["Jane Smith", "03009876543", "jane@example.com", "456 Oak Ave", "", "Teacher"],
          ];
          break;
        case "suppliers":
          headers = ["name", "contact_person", "phone", "email", "address", "payment_terms", "credit_days", "credit_limit"];
          exampleRows = [
            ["Acme Corp", "Bob Wilson", "03001112233", "bob@acme.com", "789 Industrial Rd", "credit", 30, 50000],
            ["Global Supply", "Sara Khan", "03004445566", "sara@global.com", "321 Trade St", "cash", 0, 0],
          ];
          break;
        case "expenses":
          headers = ["date", "category", "amount", "description", "reference", "outlet_id"];
          exampleRows = [
            ["2026-04-01", "Rent", 25000, "Monthly shop rent", "RNT-APR-2026", ""],
            ["2026-04-02", "Utilities", 5000, "Electricity bill", "ELEC-042026", ""],
          ];
          break;
        case "payments":
          headers = ["supplier", "invoice_number", "amount", "date", "payment_method", "reference", "notes"];
          exampleRows = [
            ["Acme Corp", "INV-001", 15000, "2026-04-01", "Bank Transfer", "CHQ-1234", "Partial payment"],
            ["Global Supply", "INV-055", 8000, "2026-04-03", "Cash", "", "Full settlement"],
          ];
          break;
        default:
          return res.status(400).json({ error: `Unknown entity "${entity}". Supported: products, customers, suppliers, expenses, payments` });
      }

      return sendCsvTemplate(res, entity, headers, exampleRows);
    },
  );
};
