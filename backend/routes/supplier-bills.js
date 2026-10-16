/**
 * One Toy Store F9: receive a supplier bill without a purchase order
 * (docs/onetoystore-pilot/PHASE-F-PLAN.md F9).
 *
 * Step (b): POST /api/supplier-bills/read — read the uploaded file(s) of ONE
 * bill (several PDFs / photos are read together) and hand back the lines for
 * the check screen. Saves nothing. Also:
 *   - the very same file already on a live bill → said here (the save refuses it);
 *   - the layout is recognised from the bill's headings; which supplier uses
 *     which layout is remembered from that supplier's earlier bills
 *     (supplier_bills.layout), with the owner's three as the starting point,
 *     so a bill with no supplier name printed (Hafiz Nawaz, Toys and Toys)
 *     still suggests its supplier.
 *
 * Step (e): photos, and PDFs no layout reads (scans), go to the AI photo
 * reader (services/bill-readers/photo-reader.js) — only when the screen asks
 * (`use_ai=1`), because each reading costs money (about Rs 11 a photo). A
 * per-shop daily cap on photos read is a cost safety stop.
 */
const crypto = require("crypto");
const path = require("path");
const { readBillPdf } = require("../services/bill-readers");
const { readBillPhotos, LAYOUT: PHOTO_LAYOUT } = require("../services/bill-readers/photo-reader");
const logger = require("../services/logger");
const { matchBillLines } = require("../services/supplier-bill-match");
const { saveSupplierBill } = require("../services/supplier-bill-save");
const { uploadToR2, r2 } = require("../utils/r2");
const { tenantToday } = require("../utils/tz");
const fs = require("fs");
const { LAYOUTS } = require("../services/bill-readers/layouts");
const { verifyImageMagicBytes } = require("../middleware/upload-validation");
const { asyncStore } = require("../tenant-db-proxy-pg");

const PDF_MIME = "application/pdf";
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp"]);

function billFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if ((file.mimetype === PDF_MIME || IMAGE_MIMES.has(file.mimetype)) && EXTS.has(ext)) return cb(null, true);
  const err = new Error("Only PDF, JPG, PNG or WEBP files");
  err.statusCode = 400;
  return cb(err);
}

// Shown before reading: what a photo costs on Sonnet 5.5 (owner's figure, 2026-10-02).
const AI_ESTIMATE_RS_PER_FILE = 11;
const aiUsage = new Map(); // `${shop}:${shop day}` -> files read

const isPdf = (buf) => buf.length > 4 && buf.subarray(0, 5).toString("latin1") === "%PDF-";

async function expectedLayoutFor(db, supplierId) {
  const { rows: [b] } = await db.query(
    `SELECT layout FROM supplier_bills WHERE supplier_id = $1 AND layout IS NOT NULL AND layout <> $2 AND status <> 'undone'
      ORDER BY id DESC LIMIT 1`, [supplierId, PHOTO_LAYOUT]);
  if (b) return b.layout;
  const { rows: [s] } = await db.query("SELECT name FROM suppliers WHERE id = $1", [supplierId]);
  const name = String(s?.name || "").toUpperCase();
  const l = LAYOUTS.find((x) => name.includes(x.supplierHint));
  return l ? l.key : null;
}

async function supplierForLayout(db, layoutKey) {
  const { rows: [b] } = await db.query(
    `SELECT s.id, s.name FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.layout = $1 AND b.status <> 'undone' ORDER BY b.id DESC LIMIT 1`, [layoutKey]);
  if (b) return b;
  const hint = LAYOUTS.find((x) => x.key === layoutKey)?.supplierHint;
  if (!hint) return null;
  const { rows } = await db.query("SELECT id, name FROM suppliers WHERE name ILIKE $1 ORDER BY id LIMIT 2", [`%${hint}%`]);
  return rows.length === 1 ? rows[0] : null;
}

/** A supplier whose name looks like the one the AI read off the bill. */
async function supplierForName(db, name) {
  const read = String(name || "").trim();
  if (!read) return null;
  try {
    const { rows: [s] } = await db.query(
      `SELECT id, name FROM suppliers WHERE similarity(LOWER(name), LOWER($1)) > 0.3
        ORDER BY similarity(LOWER(name), LOWER($1)) DESC, id LIMIT 1`, [read]);
    return s || null;
  } catch {
    // pg_trgm not installed: a plain contains-match on the name as read.
    const { rows } = await db.query("SELECT id, name FROM suppliers WHERE name ILIKE $1 ORDER BY id LIMIT 2", [`%${read}%`]);
    return rows.length === 1 ? rows[0] : null;
  }
}

/**
 * Keep a bill file: R2 under supplier-bills/<shop>/; on a PC without R2 (not
 * production) under <DATA_DIR>/uploads so a local demo works. In production
 * without R2 the save stops: the owner wants every bill file kept.
 */
async function storeBillFile(f, sha256, tenantSlug) {
  const ext = f.mimetype === PDF_MIME ? "pdf" : f.mimetype.split("/")[1].replace("jpeg", "jpg");
  const rel = `supplier-bills/${tenantSlug || "default"}/${sha256}.${ext}`;
  if (r2) return uploadToR2(f.buffer, rel, f.mimetype);
  if (process.env.NODE_ENV === "production") {
    throw Object.assign(new Error("Bill files can't be kept (file storage is not set up)"), { statusCode: 503 });
  }
  const file = path.join(path.resolve(process.env.DATA_DIR || path.join(__dirname, ".."), "uploads"), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, f.buffer);
  return `uploads/${rel}`;
}

function checkFile(f) {
  const pdf = f.mimetype === PDF_MIME;
  if (pdf ? !isPdf(f.buffer) : !verifyImageMagicBytes(f.buffer, f.mimetype)) {
    throw Object.assign(new Error(`${f.originalname}: not a real ${pdf ? "PDF" : "image"} file`), { statusCode: 400 });
  }
  return crypto.createHash("sha256").update(f.buffer).digest("hex");
}

module.exports = function mountSupplierBillRoutes(app, deps) {
  const { db, multer, requirePerm } = deps;
  // The AI photo reader: a stand-in in tests; none when no key is set.
  const photoReader = () => ("billPhotoReader" in deps
    ? deps.billPhotoReader
    : process.env.ANTHROPIC_API_KEY ? readBillPhotos : null);
  const photoCap = () => Number(deps.billPhotoDailyCap ?? process.env.AI_BILL_PHOTO_DAILY_CAP ?? 100);
  const enqueueInventorySyncEvents = (changes) => {
    try {
      if (typeof deps.enqueueInventorySyncEvents === "function") deps.enqueueInventorySyncEvents(changes, {}, () => {});
    } catch {
      /* stock sync is best-effort, as for PO receipts */
    }
  };

  // Step (c1): which of our toys is each bill line (services/supplier-bill-match.js).
  app.post("/api/supplier-bills/match", requirePerm("receive_supplier_bills"), async (req, res) => {
    try {
      const supplierId = Number(req.body?.supplier_id);
      const lines = Array.isArray(req.body?.lines) ? req.body.lines.slice(0, 2000) : null;
      if (!supplierId) return res.status(400).json({ error: "Choose the supplier first" });
      if (!lines) return res.status(400).json({ error: "lines must be a list" });
      res.json({ lines: await matchBillLines(db, supplierId, lines) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 10 },
    fileFilter: billFileFilter,
  });
  // Multer finishes outside the shop's async context (see routes/import.js
  // withTenantContext): put it back so deps.db reaches this shop's tables.
  const uploadFiles = (req, res, next) => {
    const store = asyncStore.getStore();
    upload.array("files", 10)(req, res, (err) => {
      if (err) return res.status(err.statusCode || 400).json({ error: err.message });
      if (store) return asyncStore.run(store, next);
      return next();
    });
  };

  // Step (c2): save a checked bill (services/supplier-bill-save.js).
  // multipart: payload (JSON) + the bill's files.
  app.post("/api/supplier-bills", requirePerm("receive_supplier_bills"), uploadFiles, async (req, res) => {
    try {
      let payload;
      try {
        payload = JSON.parse(req.body?.payload || "{}");
      } catch {
        return res.status(400).json({ error: "payload must be JSON" });
      }
      const files = [];
      for (const f of req.files || []) {
        const sha256 = checkFile(f);
        if (files.some((x) => x.sha256 === sha256)) continue;
        files.push({ f, sha256 });
      }
      // Refuse a file already on a live bill before storing anything.
      for (const { f, sha256 } of files) {
        const { rows: [dup] } = await db.query(
          `SELECT b.id, b.bill_number, s.name AS supplier_name FROM supplier_bill_files sf
             JOIN supplier_bills b ON b.id = sf.bill_id JOIN suppliers s ON s.id = b.supplier_id
            WHERE sf.sha256 = $1 AND sf.active LIMIT 1`, [sha256]);
        if (dup) {
          return res.status(409).json({
            error: `${f.originalname} is already on bill ${dup.bill_number || `#${dup.id}`} of ${dup.supplier_name}`, bill_id: dup.id,
          });
        }
      }
      const stored = [];
      for (const { f, sha256 } of files) {
        stored.push({
          file_name: f.originalname, content_type: f.mimetype, size_bytes: f.size, sha256,
          storage_key: await storeBillFile(f, sha256, req.tenantSlug),
        });
      }
      const ctx = {
        employeeId: req.employee?.id || null,
        employeeName: req.employee?.name || null,
        today: tenantToday(req.company?.timezone || "Asia/Karachi"),
      };
      const result = await db.transaction((client) => saveSupplierBill(client, payload, stored, ctx));
      enqueueInventorySyncEvents(result.stockChanges.map((c) => ({
        ...c, reason: "supplier_bill", reference_type: "supplier_bill", reference_id: result.bill.id,
      })));
      res.status(201).json({ bill: result.bill, labels: result.labels });
    } catch (err) {
      if (err.code === "23505" && /supplier_bill_files/.test(err.constraint || err.message)) {
        return res.status(409).json({ error: "That file is already on another bill" });
      }
      res.status(err.statusCode || 500).json({ error: err.message, ...(err.bill_id ? { bill_id: err.bill_id } : {}) });
    }
  });

  app.post(
    "/api/supplier-bills/read",
    requirePerm("receive_supplier_bills"),
    uploadFiles,
    async (req, res) => {
      try {
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ error: "Choose the bill's PDF or photo" });
        const supplierId = req.body?.supplier_id ? Number(req.body.supplier_id) : null;
        const useAi = ["1", "true"].includes(String(req.body?.use_ai || ""));

        const out = [];
        for (const f of files) {
          const sha256 = checkFile(f);
          const pdf = f.mimetype === PDF_MIME;
          const { rows: [already] } = await db.query(
            `SELECT b.id AS bill_id, b.bill_number, b.bill_date, b.status, s.name AS supplier_name
               FROM supplier_bill_files sf JOIN supplier_bills b ON b.id = sf.bill_id
               JOIN suppliers s ON s.id = b.supplier_id
              WHERE sf.sha256 = $1 AND sf.active LIMIT 1`, [sha256]);
          let read = null;
          if (pdf) {
            try {
              read = await readBillPdf(f.buffer);
            } catch (e) {
              read = { layout: null, lines: [], warnings: [`This PDF could not be read (${e.message})`] };
            }
          }
          out.push({
            file_name: f.originalname,
            content_type: f.mimetype,
            size_bytes: f.size,
            sha256,
            kind: pdf ? "pdf" : "image",
            already: already || null,
            read,
          });
        }

        // Step (e): files no PDF layout reads go to the AI, when asked.
        const aiIdx = out.map((f, i) => (f.kind === "image" || (f.read && !f.read.layout) ? i : -1)).filter((i) => i >= 0);
        let photo = null;
        if (useAi && aiIdx.length) {
          const reader = photoReader();
          if (!reader) return res.status(503).json({ error: "The photo reader is not set up on this server (no AI key)" });
          const today = tenantToday(req.company?.timezone || "Asia/Karachi");
          const key = `${req.tenantId || req.tenantSlug || "default"}:${today}`;
          const used = aiUsage.get(key) || 0;
          if (used + aiIdx.length > photoCap()) {
            return res.status(429).json({ error: `Daily limit of ${photoCap()} photos read by AI reached: try again tomorrow or type the bill in` });
          }
          aiUsage.set(key, used + aiIdx.length);
          photo = await reader(aiIdx.map((i) => ({
            buffer: files[i].buffer, mimetype: files[i].mimetype, file_name: files[i].originalname, file_index: i,
          })));
          logger.info({
            component: "supplier-bill-photo", tenant: req.tenantSlug || null, files: aiIdx.length,
            model: photo.ai?.model, input_tokens: photo.ai?.input_tokens, output_tokens: photo.ai?.output_tokens,
            cost_usd: photo.ai?.cost_usd, cost_rs: photo.ai?.cost_rs,
          }, "supplier bill read by AI");
        }

        // The files of one bill read together, in the order given.
        const readable = out.filter((f) => f.read && f.read.layout);
        const parts = readable.map((f) => ({ first: out.indexOf(f), read: f.read }));
        if (photo) parts.push({ first: aiIdx[0], last: aiIdx[aiIdx.length - 1], read: photo });
        parts.sort((a, b) => a.first - b.first);
        const head = parts[0]?.read || null;
        const lines = [];
        out.forEach((f, i) => {
          for (const l of f.read?.lines || []) lines.push({ ...l, file_index: i });
        });
        if (photo) lines.push(...photo.lines);
        lines.sort((a, b) => a.file_index - b.file_index);
        const linesTotal = Math.round(lines.reduce((s, l) => s + (l.amount || 0), 0) * 100) / 100;
        const lastPart = parts.reduce((a, p) => (!a || (p.last ?? p.first) > (a.last ?? a.first) ? p : a), null);
        const printed = lastPart ? lastPart.read.printed : {};
        const anyLineDiscount = lines.some((l) => Number(l.discount_pct) > 0);
        const printedLines = printed.subtotal ?? (anyLineDiscount || printed.discount ? null : printed.total);
        const layouts = [...new Set(readable.map((f) => f.read.layout))];

        let supplierSuggestion = null;
        let expectedLayout = null;
        let layoutWarning = null;
        if (layouts.length > 1) layoutWarning = "These files are from different bill layouts: are they one bill?";
        if (supplierId) {
          expectedLayout = await expectedLayoutFor(db, supplierId);
          if (expectedLayout && layouts.length && !layouts.includes(expectedLayout)) {
            const want = LAYOUTS.find((x) => x.key === expectedLayout)?.label;
            layoutWarning = `This supplier's bills usually look like "${want}", this one doesn't: check the supplier`;
          }
        }
        if (layouts.length === 1) {
          const s = await supplierForLayout(db, layouts[0]);
          if (s && s.id !== supplierId) supplierSuggestion = s;
        } else if (!layouts.length && photo?.supplier_name_read) {
          const s = await supplierForName(db, photo.supplier_name_read);
          if (s && s.id !== supplierId) supplierSuggestion = s;
        }

        res.json({
          files: out,
          layout: layouts[0] || (photo ? PHOTO_LAYOUT : null),
          layout_label: head?.layout_label || null,
          supplier_name_read: photo?.supplier_name_read || null,
          bill_number: head?.bill_number || null,
          bill_date: head?.bill_date || null,
          printed,
          lines,
          lines_total: linesTotal,
          total_matches: printedLines == null ? null : Math.abs(printedLines - linesTotal) <= 1,
          warnings: [
            ...out.flatMap((f, i) => (photo && aiIdx.includes(i) ? [] : (f.read?.warnings || []).map((w) => `${f.file_name}: ${w}`))),
            ...(photo?.warnings || []),
          ],
          needs_photo_reader: aiIdx.length > 0 && !photo,
          ai_ready: !!photoReader(),
          ai_files: aiIdx.length,
          ai_estimate_rs: aiIdx.length * AI_ESTIMATE_RS_PER_FILE,
          ai: photo?.ai || null,
          supplier_suggestion: supplierSuggestion,
          expected_layout: expectedLayout,
          layout_warning: layoutWarning,
        });
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    },
  );
};
