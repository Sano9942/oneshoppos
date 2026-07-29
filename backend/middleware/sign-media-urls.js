/**
 * sign-media-urls.js — stamp outgoing media URLs with a short-lived signature.
 *
 * Sits in front of every route (tenant, admin, portal and public alike) and
 * patches res.json. Any `<base>/r2/<key>` URL in a response body comes back
 * signed, so the proxy can serve it without an allowlist. See utils/media-url.js
 * for why signing beats both widening PUBLIC_R2_PREFIXES and adding a
 * Bearer-guarded media route.
 *
 * WHY A RESPONSE INTERCEPTOR RATHER THAN PER-ENDPOINT CALLS
 *
 * There are 16 upload sites across 14 prefixes, and far more read paths than
 * that — every list, detail, search, report and portal endpoint that happens to
 * select a column holding one of these URLs, including ones that select `*`.
 * Signing at each of them is work proportional to a number nobody can
 * enumerate reliably, and every miss is an invisible broken image discovered
 * months later by a user. Doing it once on the way out is proportional to
 * nothing, and a route added tomorrow is covered without its author knowing
 * this file exists.
 *
 * It operates on the serialised body rather than walking the object graph
 * because these URLs turn up nested in arrays, in JSONB blobs and in strings
 * built by report generators. A string pass catches all of those shapes for the
 * same cost and cannot miss one by failing to recurse into it. URLs contain no
 * characters that JSON escapes, so matching them inside the serialised form is
 * exact rather than approximate.
 */
const { signMediaUrl } = require("../utils/media-url");

// Absolute proxy URLs only. Stops at " (end of a JSON string), whitespace, or
// ? (a query we did not write), so a signature is never appended twice and a
// URL adjacent to other text cannot swallow it.
const MEDIA_URL_RE = /https?:\/\/[^"\s\\]*?\/r2\/[^"\s\\?]+/g;

/**
 * Express middleware. Patches res.json for the lifetime of the request.
 */
function signMediaUrls(req, res, next) {
  const original = res.json.bind(res);

  res.json = (body) => {
    let serialised;
    try {
      serialised = JSON.stringify(body);
    } catch {
      // Circular or otherwise unserialisable — hand it back untouched and let
      // Express fail the same way it would have without this middleware.
      return original(body);
    }
    // Fast path: the overwhelming majority of responses carry no media at all.
    if (!serialised || serialised.indexOf("/r2/") === -1) return original(body);

    const signed = serialised.replace(MEDIA_URL_RE, (url) => signMediaUrl(url));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(signed);
  };

  next();
}

module.exports = { signMediaUrls, MEDIA_URL_RE };
