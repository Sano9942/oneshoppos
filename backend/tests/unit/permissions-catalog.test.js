/**
 * Permission catalog drift guard (PLAN.md business-modules Step 7) — the
 * same bidirectional-enforcement idea as the Step 2 flag-catalog test,
 * applied to permission strings.
 *
 * Guarantees:
 *  1. Every permission string used in ANY requirePerm("...") /
 *     requireAnyPerm([...]) call site under backend/routes/, and every
 *     inline req.employeePerms.includes("...") check, exists in
 *     config/permissions-catalog.js. A new guard string that isn't
 *     registered fails CI — so the role editor can never silently miss a
 *     live permission again.
 *  2. DEFAULT_ROLE_PERMISSIONS and PERMISSION_RULES entries are all
 *     registered.
 *  3. The catalog's module_key linkage and the business-modules cards'
 *     permissions lists agree bidirectionally.
 *  4. manage_business_modules is registered but granted to no default role
 *     (Administrators pass via the all_access bypass).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PERMISSIONS_CATALOG,
  PERMISSION_IDS,
} = require("../../config/permissions-catalog");
const {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_RULES,
} = require("../../middleware/permissions");
const {
  BUSINESS_MODULES,
  MODULE_PERMISSIONS,
} = require("../../config/business-modules");

const ROUTES_DIR = path.join(__dirname, "..", "..", "routes");

function walkJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Extract every permission string used by a guard in one source file. */
function extractGuardPerms(source) {
  const found = new Set();
  // requirePerm("x")
  for (const m of source.matchAll(/requirePerm\(\s*"([a-z_]+)"\s*\)/g)) {
    found.add(m[1]);
  }
  // requireAnyPerm([ "a", "b", ... ]) — array may span lines
  for (const m of source.matchAll(/requireAnyPerm\(\s*\[([\s\S]*?)\]/g)) {
    for (const s of m[1].matchAll(/"([a-z_]+)"/g)) found.add(s[1]);
  }
  // inline req.employeePerms.includes("x") checks
  for (const m of source.matchAll(
    /employeePerms\??\.(?:\s*)includes\(\s*"([a-z_]+)"\s*\)/g
  )) {
    found.add(m[1]);
  }
  return found;
}

describe("permissions catalog (Step 7 drift guard)", () => {
  it("has unique ids and required fields", () => {
    const ids = PERMISSIONS_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PERMISSIONS_CATALOG) {
      expect(typeof p.id).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.category.length).toBeGreaterThan(0);
    }
  });

  it("covers every guard string in every backend/routes/ file", () => {
    const missing = [];
    for (const file of walkJsFiles(ROUTES_DIR)) {
      const source = fs.readFileSync(file, "utf8");
      for (const perm of extractGuardPerms(source)) {
        if (!PERMISSION_IDS.has(perm)) {
          missing.push(`${path.relative(ROUTES_DIR, file)}: ${perm}`);
        }
      }
    }
    expect(missing, `Unregistered permission strings:\n${missing.join("\n")}`)
      .toEqual([]);
  });

  it("covers every DEFAULT_ROLE_PERMISSIONS entry", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) {
        expect(PERMISSION_IDS.has(p), `${role}: ${p}`).toBe(true);
      }
    }
  });

  it("covers every PERMISSION_RULES entry", () => {
    for (const rule of PERMISSION_RULES) {
      for (const p of rule.anyPerms) {
        expect(PERMISSION_IDS.has(p), `${rule.path}: ${p}`).toBe(true);
      }
    }
  });

  it("module_key linkage agrees bidirectionally with the module catalog", () => {
    // catalog → cards (single module_key AND cross-module module_keys —
    // PLAN-V2 Step 2 added manage_integrations spanning the Bucket C cards)
    for (const p of PERMISSIONS_CATALOG) {
      const keys = p.module_keys || (p.module_key ? [p.module_key] : []);
      for (const key of keys) {
        const card = BUSINESS_MODULES[key];
        expect(card, `${p.id} → unknown module key ${key}`).toBeDefined();
        expect(
          card.permissions.includes(p.id),
          `${key}.permissions missing ${p.id}`
        ).toBe(true);
      }
    }
    // cards → catalog
    for (const [key, card] of Object.entries(BUSINESS_MODULES)) {
      expect(Array.isArray(card.permissions), `${key}.permissions`).toBe(true);
      for (const p of card.permissions) {
        const entry = PERMISSIONS_CATALOG.find((c) => c.id === p);
        expect(entry, `${key}.permissions has unregistered ${p}`).toBeDefined();
        const linksBack =
          entry.module_key === key ||
          (entry.module_keys || []).includes(key);
        expect(linksBack, `${p} should link back to ${key}`).toBe(true);
      }
    }
    // MODULE_PERMISSIONS keys must all be real cards
    for (const key of Object.keys(MODULE_PERMISSIONS)) {
      expect(BUSINESS_MODULES[key], `MODULE_PERMISSIONS.${key}`).toBeDefined();
    }
  });

  it("delegation permissions are registered but granted to no default role", () => {
    // manage_business_modules (v1 Step 7) + the PLAN-V2 Step 2 delegation
    // trio share the same posture: registered, delegable via a custom role,
    // held by no default role (Administrators pass via all_access).
    const delegation = [
      "manage_business_modules",
      "manage_integrations",
      "manage_roles",
      "manage_outlet_modules",
    ];
    for (const perm of delegation) {
      expect(PERMISSION_IDS.has(perm), `${perm} must be registered`).toBe(true);
      for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
        expect(
          perms.includes(perm),
          `${role} must not hold ${perm} by default`
        ).toBe(false);
      }
    }
  });
});
