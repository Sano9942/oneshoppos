#!/usr/bin/env node
/**
 * Generates the Open Graph card images (1200×630) for the marketing site —
 * one default + one per industry family — into frontend/public/og/*.png.
 * Square-style: white canvas, black display type, hairline rules.
 *
 * Usage (from frontend/): node tools/og-generate.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "og");
mkdirSync(OUT, { recursive: true });

const CARDS = [
  { file: "default", kicker: "POINT OF SALE · INVENTORY · CUSTOMERS · BILLING", title: "The POS that adapts to your industry.", foot: "23 industry presets · Free to start" },
  { file: "retail", kicker: "RETAIL & GROCERY", title: "Run the counter. Own the stock.", foot: "Barcode · weights · batch & expiry · loyalty" },
  { file: "restaurants", kicker: "RESTAURANTS & CAFES", title: "From table one to the kitchen pass.", foot: "Floor plan · KDS · QR ordering · tips" },
  { file: "salons", kicker: "SALONS & SPAS", title: "Booked solid, paid right.", foot: "Calendar · commissions · packages · waitlists" },
  { file: "clinics", kicker: "CLINICS", title: "The clinical record and the cash register, in one place.", foot: "Treatment plans · charting · recalls · forms" },
  { file: "gyms", kicker: "GYMS & FITNESS", title: "Memberships that renew. Classes that fill.", foot: "Recurring billing · timetable · waivers · check-in" },
  { file: "wholesale", kicker: "WHOLESALE & DISTRIBUTION", title: "Credit-side selling, under control.", foot: "Credit limits · AR aging · field reps · schemes" },
  { file: "rentals", kicker: "RENTALS", title: "Everything out. Everything back.", foot: "Contracts · inspections · deposits · late fees" },
  { file: "hotels", kicker: "HOTELS & LODGING", title: "Front desk to folio, one screen.", foot: "Rooms · rates · folios · channel sync" },
  { file: "repair-shops", kicker: "REPAIR SHOPS", title: "Every job on the board.", foot: "Job tickets · estimates · warranty · invoicing" },
  { file: "photographers", kicker: "PHOTOGRAPHY & CREATIVE", title: "You shoot. It runs the studio.", foot: "Inquiries · projects · contracts · galleries" },
];

const html = ({ kicker, title, foot }) => `<!doctype html><html><head><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:630px; background:#ffffff; color:#101010;
         font-family:'Segoe UI Variable Display','Segoe UI',system-ui,-apple-system,sans-serif;
         display:flex; flex-direction:column; justify-content:space-between; padding:72px 80px; }
  .kicker { font-size:22px; font-weight:600; letter-spacing:4px; color:#6b7280; }
  .title { font-size:76px; font-weight:750; letter-spacing:-2px; line-height:1.04; max-width:1000px; }
  .bottom { display:flex; align-items:center; justify-content:space-between;
            border-top:2px solid #e3e3e3; padding-top:28px; }
  .brand { font-size:34px; font-weight:800; letter-spacing:-1px; }
  .brand span { color:#6b7280; }
  .foot { font-size:22px; color:#6b7280; font-weight:500; }
</style></head><body>
  <div class="kicker">${kicker}</div>
  <div class="title">${title}</div>
  <div class="bottom"><div class="brand">Sano<span>POS</span></div><div class="foot">${foot}</div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const card of CARDS) {
  await page.setContent(html(card));
  await page.screenshot({ path: path.join(OUT, `${card.file}.png`) });
  console.log(`✓ og/${card.file}.png`);
}
await browser.close();
