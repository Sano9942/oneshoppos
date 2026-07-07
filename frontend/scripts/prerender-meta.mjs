#!/usr/bin/env node
/**
 * Post-build static-shell prerender for the marketing routes.
 *
 * Social scrapers (WhatsApp/Facebook/LinkedIn/Twitter) don't execute JS, so a
 * SPA serves them one generic OG block for every URL. This script copies
 * dist/index.html to dist/<route>/index.html with per-route <title>/meta/OG
 * rewritten, and emits sitemap.xml + robots.txt. Vercel serves filesystem
 * matches before rewrites, so each shell wins over the SPA fallback while the
 * app hydrates normally.
 *
 * Keep ROUTES in sync with src/pages/marketing/content/industries.js — that
 * module imports image assets so it can't be imported from plain Node here.
 *
 * Runs as part of `npm run build` (see package.json).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://sanopos.com";
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

const ROUTES = [
  // path, title, description, og image
  ["/industries", "Industries — SanoPOS", "SanoPOS ships ready-made for 23 business types across 10 industry families — see yours.", "/og/default.png"],
  ["/industries/retail", "Retail & Grocery POS — SanoPOS", "Barcode checkout, weight-based selling, batch & expiry tracking, loyalty and multi-outlet stock — one POS for shops, marts, butchers, sweet shops and fabric stores.", "/og/retail.png"],
  ["/industries/restaurants", "Restaurant & Cafe POS — SanoPOS", "Floor plans, kitchen display, QR ordering, tabs, split checks, tips and delivery order capture — a POS built for service, counter and delivery.", "/og/restaurants.png"],
  ["/industries/salons", "Salon & Spa Software — SanoPOS", "Appointment calendar, staff commissions, packages and passes, waitlists and online booking — salon software with a real POS underneath.", "/og/salons.png"],
  ["/industries/clinics", "Clinic Software — Medical, Dental, Veterinary, Physio — SanoPOS", "Treatment plans, clinical charting, recalls, consent and intake forms, deposits and patient portals — one system for clinics of every kind.", "/og/clinics.png"],
  ["/industries/gyms", "Gym Management Software — SanoPOS", "Recurring memberships, class timetables with waitlists, PT passes, liability waivers and a member check-in kiosk — gym software with retail POS built in.", "/og/gyms.png"],
  ["/industries/wholesale", "Wholesale & Distribution Software — SanoPOS", "Credit limits, AR aging, statements, field sales reps with GPS check-in, trade schemes, backorders and van sales — B2B distribution on one system.", "/og/wholesale.png"],
  ["/industries/rentals", "Rental Business Software — SanoPOS", "Rental contracts, check-out and return, condition inspections, late fees, deposits and availability — for car hire, equipment, furniture and event rentals.", "/og/rentals.png"],
  ["/industries/hotels", "Hotel, Guesthouse & Hostel Software — SanoPOS", "Rooms and rate calendars, bookings, guest folios, deposits, housekeeping, channel sync and a public booking page — lodging management with POS built in.", "/og/hotels.png"],
  ["/industries/repair-shops", "Repair Shop Software — SanoPOS", "Job tickets, estimates, deposits, status boards, warranty tracking and invoice-from-ticket — for phone, computer, appliance and workshop repair.", "/og/repair-shops.png"],
  ["/industries/photographers", "Photography Studio Software — SanoPOS", "Inquiry capture, quotes, projects, contracts, milestone invoicing, client questionnaires and gallery proofing — the business side of the studio.", "/og/photographers.png"],
  ["/pricing", "Pricing — SanoPOS", "Free forever for small counters. Pro with a 45-day free trial — unlimited employees and products. No credit card to start.", "/og/default.png"],
  ["/why-sanopos", "Why SanoPOS", "One system that adapts per industry instead of ten point products — why businesses replace their POS, booking tool and spreadsheets with SanoPOS.", "/og/default.png"],
];

// extra public URLs that belong in the sitemap but keep the root shell
const SITEMAP_ONLY = ["/", "/signup", "/login", "/terms", "/privacy"];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function rewrite(html, [route, title, description, og]) {
  const url = `${SITE}${route}`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${SITE}${og}$2`)
    .replace(/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${SITE}${og}$2`)
    .replace(/(<meta name="twitter:image:alt" content=")[^"]*(")/, `$1${esc(title)}$2`);
}

const indexPath = path.join(DIST, "index.html");
if (!existsSync(indexPath)) {
  console.error("prerender-meta: dist/index.html not found — run vite build first");
  process.exit(1);
}
const base = readFileSync(indexPath, "utf8");

for (const routeDef of ROUTES) {
  const [route] = routeDef;
  const dir = path.join(DIST, ...route.split("/").filter(Boolean));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), rewrite(base, routeDef));
  console.log(`✓ shell ${route}`);
}

// sitemap.xml
const today = new Date().toISOString().slice(0, 10);
const urls = [...SITEMAP_ONLY, ...ROUTES.map((r) => r[0])]
  .map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod></url>`)
  .join("\n");
writeFileSync(
  path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
);
console.log("✓ sitemap.xml");

// robots.txt
writeFileSync(
  path.join(DIST, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /pos\nDisallow: /kiosk\n\nSitemap: ${SITE}/sitemap.xml\n`
);
console.log("✓ robots.txt");
