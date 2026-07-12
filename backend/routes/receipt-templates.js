const multer = require("multer");

module.exports = function registerReceiptTemplateRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm } = deps;

  // Best-effort column additions (idempotent — Postgres will error if exists, which we ignore)
  (async () => {
    for (const col of ["entity_id INTEGER", "entity_type TEXT", "employee_id INTEGER"]) {
      try { await db.query(`ALTER TABLE action_history ADD COLUMN ${col}`); } catch {}
    }
  })();

  // Bucket F receipt designer v2 fields — tolerated as absent on read so
  // upgrade sequence (migrate → deploy) doesn't 500 if a tenant hasn't run
  // v76 yet. New columns default safe on fresh schemas.
  function coerceDesignerFields(body) {
    const out = {};
    if (body.logo_url !== undefined) out.logo_url = body.logo_url || null;
    if (body.paper_width !== undefined) {
      const n = parseInt(body.paper_width, 10);
      out.paper_width = Number.isFinite(n) && n > 0 ? n : 48;
    }
    if (body.show_tax_breakdown !== undefined) out.show_tax_breakdown = !!body.show_tax_breakdown;
    if (body.show_fbr !== undefined) out.show_fbr = !!body.show_fbr;
    if (body.show_qr !== undefined) out.show_qr = !!body.show_qr;
    return out;
  }

// --- RECEIPT TEMPLATES ---

  app.get("/api/receipt-templates", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM receipt_templates ORDER BY id DESC");
      res.json({ templates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/receipt-templates/active", async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM receipt_templates WHERE is_active = true ORDER BY id DESC LIMIT 1"
      );
      res.json({ template: rows[0] || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/receipt-templates", requirePerm("all_access"), async (req, res) => {
    const { name, header_text, footer_text, show_barcode, show_logo, is_active } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const d = coerceDesignerFields(req.body);
    try {
      if (is_active) {
        await db.query("UPDATE receipt_templates SET is_active = false");
      }
      const { rows } = await db.query(
        `INSERT INTO receipt_templates
           (name, header_text, footer_text, show_barcode, show_logo, is_active,
            logo_url, paper_width, show_tax_breakdown, show_fbr, show_qr)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          name,
          header_text || "",
          footer_text || "",
          show_barcode ? true : false,
          show_logo ? true : false,
          is_active ? true : false,
          d.logo_url ?? null,
          d.paper_width ?? 48,
          d.show_tax_breakdown ?? true,
          d.show_fbr ?? true,
          d.show_qr ?? true,
        ]
      );
      res.json({ id: rows[0].id, message: "Template created" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/receipt-templates/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    const { name, header_text, footer_text, show_barcode, show_logo, is_active } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const d = coerceDesignerFields(req.body);
    try {
      if (is_active) {
        await db.query("UPDATE receipt_templates SET is_active = false");
      }
      // COALESCE keeps existing column values when the client omits a field —
      // lets partial PUTs work (e.g. handleSetActive which only toggles is_active).
      const { rowCount } = await db.query(
        `UPDATE receipt_templates SET
            name = $1,
            header_text = $2,
            footer_text = $3,
            show_barcode = $4,
            show_logo = $5,
            is_active = $6,
            logo_url = COALESCE($7, logo_url),
            paper_width = COALESCE($8, paper_width),
            show_tax_breakdown = COALESCE($9, show_tax_breakdown),
            show_fbr = COALESCE($10, show_fbr),
            show_qr = COALESCE($11, show_qr)
         WHERE id = $12`,
        [
          name,
          header_text || "",
          footer_text || "",
          show_barcode ? true : false,
          show_logo ? true : false,
          is_active ? true : false,
          d.logo_url === undefined ? null : d.logo_url,
          d.paper_width === undefined ? null : d.paper_width,
          d.show_tax_breakdown === undefined ? null : d.show_tax_breakdown,
          d.show_fbr === undefined ? null : d.show_fbr,
          d.show_qr === undefined ? null : d.show_qr,
          id,
        ]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Template not found" });
      res.json({ message: "Template updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/receipt-templates/:id", requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM receipt_templates WHERE id = $1", [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: "Template not found" });
      res.json({ message: "Template deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- RECEIPT LOGO UPLOAD (Bucket F) ---
  // Mirrors routes/products.js:1126-1155 pattern: multer memoryStorage, sharp
  // resize to WebP, R2 upload (falls back to local filesystem if R2 unset).
  // 300×100 is a safe inline-header size for both 58mm and 80mm rolls.
  const { uploadToR2 } = require("../utils/r2");
  const sharp = require("sharp");
  const { imageFileFilter } = require("../middleware/upload-validation");

  const receiptLogoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: imageFileFilter,
  });

  app.post(
    "/api/uploads/receipt-logo",
    requirePerm("all_access"),
    receiptLogoUpload.single("image"),
    async (req, res) => {
      if (!req.file) return res.status(400).json({ error: "Image file is required" });
      try {
        const resized = await sharp(req.file.buffer)
          .resize(300, 100, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
        const filename = `receipt_${Date.now()}_${Math.round(Math.random() * 1e6)}.webp`;
        const key = `receipt-logos/${filename}`;
        const url = await uploadToR2(resized, key, "image/webp");
        res.json({ url, filename, original_name: req.file.originalname, size: resized.length });
      } catch (err) {
        res.status(500).json({ error: "Upload failed: " + err.message });
      }
    },
  );

  // --- ACTION HISTORY ---

  app.post("/api/action-history", async (req, res) => {
    const { user_name, action_type, description } = req.body;
    if (!action_type || !description) {
      return res.status(400).json({ error: "Missing action details" });
    }
    try {
      const { rows } = await db.query(
        "INSERT INTO action_history (user_name, action_type, description) VALUES ($1, $2, $3) RETURNING id",
        [user_name || "System", action_type, description]
      );
      res.json({ id: rows[0].id, message: "Action logged" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/action-history/log", requirePerm("all_access"), async (req, res) => {
    const { action_type, description, entity_id, entity_type } = req.body;
    if (!action_type || !description) {
      return res.status(400).json({ error: "action_type and description are required" });
    }
    const employee_id = req.body.employee_id || req.headers["x-employee-id"] || null;
    try {
      const { rows } = await db.query(
        `INSERT INTO action_history (action_type, description, entity_id, entity_type, employee_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [action_type, description, entity_id || null, entity_type || null, employee_id ? Number(employee_id) : null]
      );
      res.json({ success: true, id: rows[0].id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/action-history", requireAnyPerm(["view_hr_reports", "all_access"]), async (req, res) => {
    const { search, date_from, date_to, action_type } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(user_name ILIKE $${paramIdx} OR action_type ILIKE $${paramIdx + 1} OR description ILIKE $${paramIdx + 2})`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramIdx += 3;
    }
    // timestamp is TIMESTAMPTZ — date(...) evaluates in the DB session
    // timezone; filter with tenant-tz UTC bounds instead.
    const { toUtcStart, toUtcEnd } = require("../utils/tz");
    if (date_from) {
      conditions.push(`timestamp >= $${paramIdx}`);
      params.push(toUtcStart(String(date_from), req.company?.timezone));
      paramIdx++;
    }
    if (date_to) {
      conditions.push(`timestamp < $${paramIdx}`);
      params.push(toUtcEnd(String(date_to), req.company?.timezone));
      paramIdx++;
    }
    if (action_type) {
      conditions.push(`action_type = $${paramIdx}`);
      params.push(action_type);
      paramIdx++;
    }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    try {
      const { rows } = await db.query(
        `SELECT * FROM action_history ${where} ORDER BY timestamp DESC LIMIT 500`,
        params
      );
      res.json({ logs: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
