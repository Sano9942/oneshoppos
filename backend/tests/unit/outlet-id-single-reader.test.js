/**
 * Single-reader-of-x-outlet-id drift guard (PLAN-V3 Step W0d).
 *
 * middleware/outlet-context.js is THE validated interpreter of the x-outlet-id
 * header (Business Modules v2 Step 9 consolidated every reader onto it).
 * middleware/tenant-auth.js:resolveContext keeps ONE documented raw-header
 * fallback, used only on the standalone/unit-test chain where the shared
 * resolver isn't mounted. Those two are the only production files that may read
 * the header — a THIRD interpretation is exactly the drift that existed before
 * Step 9 (three readers). See backend/middleware/CLAUDE.md → outlet-context.js /
 * resolveContext.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Paths relative to backend/ so the allowlist reads like the middleware map.
const BACKEND_DIR = path.join(__dirname, "..", "..");

// The ONLY production files sanctioned to READ the x-outlet-id header. Everything
// else must consume the resolved outlet via req.outletContext / req.context.
// See backend/middleware/CLAUDE.md → outlet-context.js / resolveContext.
const OUTLET_ID_READER_ALLOWLIST = [
  "middleware/outlet-context.js",
  "middleware/tenant-auth.js",
].sort();

// A real header READ, in any of the idioms actually used in an Express app:
//   req.headers["x-outlet-id"] / ['x-outlet-id']   (bracket access)
//   req.get("x-outlet-id") / req.header("x-outlet-id")   (Express accessors)
//   req.headers.get("x-outlet-id")   (Fetch-style Headers)
// Case-insensitive so header-name aliases (X-Outlet-Id, X-OUTLET-ID) still hit.
// Comment-only mentions ("validated x-outlet-id header → …", as in
// registerAllRoutes.js) are stripped before matching so they do NOT count as
// readers — an over-broad bare-string grep would false-fail on them.
const OUTLET_ID_READ =
  /(?:\.headers\s*\[\s*['"]x-outlet-id['"]\s*\]|\.headers\s*\.\s*get\s*\(\s*['"]x-outlet-id['"]\s*\)|\.(?:get|header)\s*\(\s*['"]x-outlet-id['"]\s*\))/i;

const SKIP_DIRS = new Set([
  "node_modules",
  "tests",
  "archive",
  "backups",
  "tenants",
  "exports",
  "uploads_test",
  "uploads_tmp",
  "coverage",
  ".git",
]);

function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkJs(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".js")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// Strip comments so a header-name mention inside one can't be counted as a read.
// Block comments (may span lines) first, then line comments — the (^|[^:]) guard
// keeps `https://`-style `//` inside string literals intact.
function stripComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s
    .split("\n")
    .map((line) => {
      const m = line.match(/(^|[^:])\/\//);
      return m ? line.slice(0, m.index + m[1].length) : line;
    })
    .join("\n");
  return s;
}

function relPosix(abs) {
  return path.relative(BACKEND_DIR, abs).split(path.sep).join("/");
}

describe("(2) single reader of the x-outlet-id header", () => {
  it("exactly the sanctioned production files read x-outlet-id", () => {
    const matched = walkJs(BACKEND_DIR)
      .filter((f) => OUTLET_ID_READ.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map(relPosix)
      .sort();
    expect(
      matched,
      "Files reading the x-outlet-id header drifted from the allowlist.\n" +
        `Expected: ${JSON.stringify(OUTLET_ID_READER_ALLOWLIST)}\n` +
        `Found:    ${JSON.stringify(matched)}\n` +
        "Only outlet-context.js (the validated resolver) and tenant-auth.js " +
        "(the documented standalone fallback) may read it. Route all other " +
        "outlet context through req.outletContext / req.context. See " +
        "backend/middleware/CLAUDE.md → outlet-context.js / resolveContext."
    ).toEqual(OUTLET_ID_READER_ALLOWLIST);
  });
});
