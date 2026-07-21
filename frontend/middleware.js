// @ts-check
/**
 * Vercel Routing Middleware — social-preview (Open Graph) tags for shareable
 * tenant links. (PLAN-V3 Step W0c.)
 *
 * ── The problem ────────────────────────────────────────────────────────────
 * Every shareable tenant link (a shop's storefront, its booking page, its QR
 * menu, …) is served the static SPA shell (`index.html`). Social crawlers
 * (WhatsApp/Facebook/etc.) DON'T run JavaScript, so `Seo.jsx`'s client-side tag
 * updates never happen for them — every tenant link previews as the generic
 * "SanoPOS — the POS that adapts to your industry" ad. A shop that shares its
 * own storefront ends up marketing *us*, not itself. `scripts/prerender-meta.mjs`
 * fixes this for the 13 marketing routes at build time, but tenant slugs are
 * dynamic and can't be prerendered.
 *
 * ── The fix ────────────────────────────────────────────────────────────────
 * For CRAWLER User-Agents only, and only on a short allow-list of *broadcast*
 * tenant links, resolve the tenant slug from the URL, fetch the shop's branding
 * from the existing no-auth GET /api/storefront/config, and stamp real
 * og:title/og:description/og:image into the served shell (reusing the same
 * string-replace `rewrite()` shape as prerender-meta.mjs — see rewriteShell()).
 *
 * A REAL browser never triggers any of this: it short-circuits to next()
 * before any network round-trip, so the SPA + Seo.jsx keep behaving exactly as
 * before. The crawler is the ONLY consumer of these static OG tags.
 *
 * ── Privacy split (owner-ruled) — deny-list FIRST, allow-list SECOND ────────
 * BRAND (safe to preview — company name + logo leak nothing private):
 *     /store  /book  /book-room  /reserve  /menu  /inquire
 * NO-PREVIEW (must stay the generic SanoPOS shell — "generic OR no preview"):
 *     /receipt  /portal  /gift-card  /pay
 *   · /receipt is forwarded on WhatsApp today (the POS receipt modal ships a
 *     `wa.me` share link) and WhatsApp caches previews server-side — a receipt
 *     preview must NEVER carry items/totals.
 *   · /gift-card/:code is a BEARER SECRET — a preview would leak the balance and
 *     make crawlers hit the balance endpoint with the code.
 *   · /portal & /pay are one-to-one authenticated/tokenised surfaces, not
 *     broadcast links.
 * The deny-list is matched FIRST so a deep link like /portal/:slug/invoices/:id
 * can NEVER inherit a brand preview via a loose prefix. For the no-preview set
 * we simply return the UNTOUCHED shell (= the generic SanoPOS card + default
 * og image), which leaks nothing tenant-specific — that is the accepted
 * "generic" outcome, NOT a bug.
 *
 * ── v1 scope ───────────────────────────────────────────────────────────────
 * Image = the tenant `logo_url` with an og-default.png fallback. A square logo
 * may preview a little small (Facebook drops images < 200×200) — acceptable for
 * v1; a correct title + description alone fixes most of the embarrassment. The
 * generated 1200×630 OG card (Vercel OG / satori) is explicitly OUT — deferred
 * to a later wave.
 */

import { next } from "@vercel/functions";

// The public site origin used in canonical/og:url + the default og image.
const SITE = "https://sanopos.com";

// Backend origin for the (edge-visible) branding lookup. Set APP_PUBLIC_BASE_URL
// in the Vercel project env to override; falls back to the known prod API host.
// NOTE: VITE_API_BASE is build-time-inlined into the CLIENT bundle and is NOT
// visible to this edge runtime — this needs its own runtime env var.
const API_BASE = (process.env.APP_PUBLIC_BASE_URL || "https://api.sanopos.com").replace(/\/+$/, "");

// Tenant slug shape (mirrors backend/tenant-provisioner-pg.js validateSlug).
const SLUG_RE = /^[a-z0-9_]{3,40}$/;

// Social preview crawlers. Real browsers (and JS-executing bots like Googlebot)
// are deliberately NOT here — they get the SPA + Seo.jsx unchanged. Extend as
// needed; every entry only ever gets a static, branding-only preview.
const CRAWLER_RE =
  /(facebookexternalhit|facebot|Twitterbot|WhatsApp|Slackbot|LinkedInBot|Discordbot|TelegramBot|Pinterest|redditbot|Applebot|SkypeUriPreview|vkShare|Embedly)/i;

// Deny-list — one-to-one / secret-bearing links. Matched FIRST, prefix must be a
// path boundary (=== or startsWith(prefix + "/")) so /portal/:slug/invoices/:id
// is caught but /portfolio would not be.
const NO_PREVIEW_PREFIXES = ["/receipt", "/portal", "/gift-card", "/pay"];

// Allow-list — broadcast links safe to brand. `desc` synthesises og:description
// per route (the branding endpoint returns NO description field, so we template
// one). `slugFrom: "path"` → slug is the segment after the prefix; `"query"` →
// slug is the ?tenant= param (only /menu carries the slug in the query string).
const BRAND_ROUTES = [
  { prefix: "/store", slugFrom: "path", desc: (n) => `Shop online at ${n}.` },
  { prefix: "/book-room", slugFrom: "path", desc: (n) => `Book a room at ${n}.` },
  { prefix: "/book", slugFrom: "path", desc: (n) => `Book an appointment with ${n}.` },
  { prefix: "/reserve", slugFrom: "path", desc: (n) => `Reserve a table at ${n}.` },
  { prefix: "/inquire", slugFrom: "path", desc: (n) => `Get in touch with ${n}.` },
  { prefix: "/menu", slugFrom: "query", desc: (n) => `View the menu and order from ${n}.` },
];

// Only the 10 route families above ever spin this middleware up. Everything else
// (static assets, /index.html, /api/*, the SPA's own routes) is excluded by the
// matcher, which — together with the cross-origin branding fetch and the
// same-origin /index.html fetch (a path NOT in this matcher) — is the recursion
// guard: no request this middleware issues can re-enter it.
export const config = {
  matcher: [
    "/store/:path*",
    "/book/:path*",
    "/book-room/:path*",
    "/reserve/:path*",
    "/menu/:path*",
    "/inquire/:path*",
    "/receipt/:path*",
    "/portal/:path*",
    "/gift-card/:path*",
    "/pay/:path*",
  ],
};

// ── best-effort caches ──────────────────────────────────────────────────────
// BOTH caches are per-edge-isolate only. Vercel spins up many isolates, so there
// is NO cross-isolate invalidation — a branding change propagates within the TTL
// on whichever isolates have a warm entry, and instantly on cold ones. This is
// fine: the ONLY consumer is a social crawler, and freshness within minutes is
// ample. Nothing user-facing reads these.
const BRANDING_TTL_MS = 10 * 60 * 1000; // 10 min
const BRANDING_MAX = 500; // bounded; evict oldest (FIFO) when full
/** @type {Map<string, { data: {name: string, logo: string|null}|null, expires: number }>} */
const brandingCache = new Map();

// The SPA shell rarely changes within an isolate's lifetime (a new deploy = new
// isolate), so cache it too to spare a same-origin fetch on every crawler hit.
/** @type {string|null} */
let shellCache = null;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * Stamp OG/Twitter/title/description into the static shell. Deliberately mirrors
 * scripts/prerender-meta.mjs's rewrite() (same string-replace approach on the
 * same tags) — kept as a separate copy so the build script stays untouched;
 * keep the two in sync if the shell's meta block changes.
 * @param {string} html
 * @param {{ title: string, description: string, url: string, image: string, stripImageDims?: boolean }} meta
 */
function rewriteShell(html, { title, description, url, image, stripImageDims }) {
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${esc(url)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${esc(url)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${esc(image)}$2`)
    .replace(/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${esc(image)}$2`)
    .replace(/(<meta name="twitter:image:alt" content=")[^"]*(")/, `$1${esc(title)}$2`);

  // The shell hard-codes og:image dimensions as 1200×630 (true for the default
  // marketing card). A tenant logo has unknown dimensions, so drop the width/
  // height hints and let the crawler measure the real image rather than trust a
  // wrong 1200×630 (which can render a broken/cropped preview).
  if (stripImageDims) {
    out = out
      .replace(/\s*<meta property="og:image:width" content="[^"]*"\s*\/>/, "")
      .replace(/\s*<meta property="og:image:height" content="[^"]*"\s*\/>/, "");
  }
  return out;
}

/** fetch with a hard timeout so a cold-start backend can't block the page. */
async function fetchWithTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Resolve a tenant's branding via the no-auth storefront config endpoint.
 * Returns { name, logo } or null. Best-effort cached; serves stale on failure;
 * returns null (→ caller fails closed) when there's no usable value.
 */
async function getBranding(slug) {
  const now = Date.now();
  const cached = brandingCache.get(slug);
  if (cached && cached.expires > now) return cached.data;

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/storefront/config?tenant=${encodeURIComponent(slug)}`,
      1500,
      { headers: { accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`branding ${res.status}`);
    const body = await res.json();
    const name = (body && typeof body.company_name === "string" ? body.company_name : "").trim();
    if (!name) throw new Error("no company_name");
    const logo = body && typeof body.logo_url === "string" && /^https?:\/\//i.test(body.logo_url)
      ? body.logo_url
      : null;
    const data = { name, logo };
    if (brandingCache.size >= BRANDING_MAX && !brandingCache.has(slug)) {
      brandingCache.delete(brandingCache.keys().next().value); // evict oldest (FIFO)
    }
    brandingCache.set(slug, { data, expires: now + BRANDING_TTL_MS });
    return data;
  } catch {
    // Serve stale if we have any prior value for this slug; otherwise fail closed.
    return cached ? cached.data : null;
  }
}

/** Fetch (and per-isolate cache) the raw static shell. Null on failure. */
async function getShell(request) {
  if (shellCache) return shellCache;
  try {
    // /index.html has a file extension → served directly (not SPA-rewritten) and
    // is NOT in the matcher → no recursion back into this middleware.
    const res = await fetchWithTimeout(new URL("/index.html", request.url), 2000);
    if (!res.ok) return null;
    const html = await res.text();
    shellCache = html;
    return html;
  } catch {
    return null;
  }
}

/** Boundary-aware prefix match: /store matches /store and /store/… , not /storefront. */
const underPrefix = (pathname, prefix) =>
  pathname === prefix || pathname.startsWith(prefix + "/");

export default async function middleware(request) {
  // 1. Real browsers (and non-listed bots) bypass entirely — no network round
  //    trip, SPA + Seo.jsx unchanged.
  const ua = request.headers.get("user-agent") || "";
  if (!CRAWLER_RE.test(ua)) return next({ headers: { "x-og-mw": "bypass-ua" } });

  const url = new URL(request.url);
  const pathname = url.pathname;

  // 2. DENY-LIST FIRST. A no-preview link (incl. any deep sub-path) → untouched
  //    generic SanoPOS shell. Leaks nothing tenant-specific.
  if (NO_PREVIEW_PREFIXES.some((p) => underPrefix(pathname, p))) {
    return next({ headers: { "x-og-mw": "no-preview" } });
  }

  // 3. ALLOW-LIST SECOND. Match an exact brand family + resolve its slug.
  const route = BRAND_ROUTES.find((r) => underPrefix(pathname, r.prefix));
  if (!route) return next({ headers: { "x-og-mw": "passthrough" } });

  const rawSlug =
    route.slugFrom === "query"
      ? url.searchParams.get("tenant")
      : pathname.slice(route.prefix.length + 1).split("/")[0];
  const slug = (rawSlug || "").toLowerCase();
  if (!SLUG_RE.test(slug)) return next({ headers: { "x-og-mw": "passthrough" } });

  // 4. Resolve branding — fail closed to the untouched shell on any miss/timeout.
  const branding = await getBranding(slug);
  if (!branding) return next({ headers: { "x-og-mw": "fail-open" } });

  const shell = await getShell(request);
  if (!shell) return next({ headers: { "x-og-mw": "fail-open-shell" } });

  const image = branding.logo || `${SITE}/og/default.png`;
  const html = rewriteShell(shell, {
    title: branding.name,
    description: route.desc(branding.name),
    url: `${SITE}${pathname}${url.search}`,
    image,
    stripImageDims: Boolean(branding.logo), // only strip when using an unknown-size logo
  });

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Let crawlers cache briefly; keep it out of any shared CDN cache so a
      // browser hitting the same URL still gets the SPA shell via the normal path.
      "cache-control": "public, max-age=300, s-maxage=0",
      "x-og-mw": "brand",
    },
  });
}
