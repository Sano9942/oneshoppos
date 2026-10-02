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
 */
const crypto = require("crypto");
const path = require("path");
const { readBillPdf } = require("../services/bill-readers");
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

const isPdf = (buf) => buf.length > 4 && buf.subarray(0, 5).toString("latin1") === "%PDF-";

async function expectedLayoutFor(db, supplierId) {
  const { rows: [b] } = await db.query(
    `SELECT layout FROM supplier_bills WHERE supplier_id = $1 AND layout IS NOT NULL AND status <> 'undone'
      ORDER BY id DESC LIMIT 1`, [supplierId]);
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

module.exports = function mountSupplierBillRoutes(app, deps) {
  const { db, multer, requirePerm } = deps;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 10 },
    fileFilter: billFileFilter,
  });

  app.post(
    "/api/supplier-bills/read",
    requirePerm("receive_supplier_bills"),
    // Multer finishes outside the shop's async context (see routes/import.js
    // withTenantContext): put it back so deps.db reaches this shop's tables.
    (req, res, next) => {
      const store = asyncStore.getStore();
      upload.array("files", 10)(req, res, (err) => {
        if (err) return res.status(err.statusCode || 400).json({ error: err.message });
        if (store) return asyncStore.run(store, next);
        return next();
      });
    },
    async (req, res) => {
      try {
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ error: "Choose the bill's PDF or photo" });
        const supplierId = req.body?.supplier_id ? Number(req.body.supplier_id) : null;

        const out = [];
        for (const f of files) {
          const sha256 = crypto.createHash("sha256").update(f.buffer).digest("hex");
          const pdf = f.mimetype === PDF_MIME;
          if (pdf ? !isPdf(f.buffer) : !verifyImageMagicBytes(f.buffer, f.mimetype)) {
            return res.status(400).json({ error: `${f.originalname}: not a real ${pdf ? "PDF" : "image"} file` });
          }
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

        // The files of one bill read together, in the order given.
        const readable = out.filter((f) => f.read && f.read.layout);
        const head = readable[0]?.read || null;
        const lines = [];
        out.forEach((f, i) => {
          for (const l of f.read?.lines || []) lines.push({ ...l, file_index: i });
        });
        const linesTotal = Math.round(lines.reduce((s, l) => s + (l.amount || 0), 0) * 100) / 100;
        const printed = readable.length ? readable[readable.length - 1].read.printed : {};
        const printedLines = printed.subtotal ?? printed.total;
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
        }

        res.json({
          files: out,
          layout: layouts[0] || null,
          layout_label: head?.layout_label || null,
          bill_number: head?.bill_number || null,
          bill_date: head?.bill_date || null,
          printed,
          lines,
          lines_total: linesTotal,
          total_matches: printedLines == null ? null : Math.abs(printedLines - linesTotal) <= 1,
          warnings: out.flatMap((f) => (f.read?.warnings || []).map((w) => `${f.file_name}: ${w}`)),
          needs_photo_reader: out.some((f) => f.kind === "image" || (f.read && !f.read.layout)),
          supplier_suggestion: supplierSuggestion,
          expected_layout: expectedLayout,
          layout_warning: layoutWarning,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
