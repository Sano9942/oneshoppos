/**
 * action_history column drift guard.
 *
 * Why this test exists: for the entire life of the product, 46 INSERTs across
 * 21 files wrote to action_history columns that did not exist
 * (employee_id / entity_type / entity_id / action / details, against a table
 * declared as user_name / action_type / description / timestamp). Every one of
 * those statements raised "column ... does not exist", and every one sits
 * inside a bare `try {} catch {}`, so the failure was swallowed with no log
 * line and no test failure. Void/comp — the classic cafe theft vector — was
 * never audited once in production.
 *
 * The columns were added in migration v138 and the call sites normalised, but
 * the *shape* of the bug is what matters: a silent write path has no natural
 * failure signal, so only a static guard can hold it. This test asserts that
 * every column named in an `INSERT INTO action_history (...)` anywhere under
 * backend/ actually exists in schema-pg.sql, which CLAUDE.md designates the
 * single source of truth for DDL.
 *
 * If this fails you have either added a column to a call site without adding
 * it to the schema, or renamed a schema column out from under a call site.
 * Do not "fix" it by deleting the assertion.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "../..");
const SCHEMA = path.join(BACKEND, "schema-pg.sql");

/** Columns declared for action_history in schema-pg.sql. */
function schemaColumns() {
  const sql = fs.readFileSync(SCHEMA, "utf8");
  const m = sql.match(
    /CREATE TABLE IF NOT EXISTS action_history\s*\(([\s\S]*?)\n\);/i
  );
  if (!m) throw new Error("action_history CREATE TABLE not found in schema-pg.sql");
  return new Set(
    m[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("--"))
      .map((l) => l.split(/\s+/)[0].toLowerCase())
      .filter((c) => c && !["primary", "unique", "constraint", "foreign", "check"].includes(c))
  );
}

/** Every `INSERT INTO action_history (a, b, c)` under backend/, with location. */
function insertSites() {
  const sites = [];
  const skip = /node_modules|[\\/]archive[\\/]|\.git|[\\/]tests[\\/]/;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (skip.test(p)) continue;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) {
        const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
          const m = line.match(/INSERT\s+INTO\s+action_history\s*\(([^)]*)\)/i);
          if (!m) return;
          sites.push({
            file: path.relative(BACKEND, p).split(path.sep).join("/"),
            line: i + 1,
            columns: m[1]
              .split(",")
              .map((c) => c.trim().toLowerCase())
              .filter(Boolean),
          });
        });
      }
    }
  })(BACKEND);
  return sites;
}

describe("action_history column drift", () => {
  const declared = schemaColumns();
  const sites = insertSites();

  it("finds the schema declaration and the call sites", () => {
    // Guards the guard: a broken parser must fail loudly, not vacuously pass.
    expect(declared.size).toBeGreaterThan(4);
    expect(sites.length).toBeGreaterThan(40);
  });

  it("declares the columns migration v138 added", () => {
    for (const c of ["employee_id", "entity_type", "entity_id"]) {
      expect(declared.has(c), `schema-pg.sql is missing ${c}`).toBe(true);
    }
  });

  it("every INSERT column exists in schema-pg.sql", () => {
    const bad = [];
    for (const s of sites) {
      for (const c of s.columns) {
        if (!declared.has(c)) bad.push(`${s.file}:${s.line} writes non-existent column "${c}"`);
      }
    }
    expect(bad, `\n${bad.join("\n")}\n`).toEqual([]);
  });

  it("no call site uses the historical phantom names", () => {
    // These specific names are what the 42 shape-B sites used. They are not
    // columns and never were; re-introducing one means a copy-paste from an
    // pre-v138 revision.
    const phantom = ["action", "details"];
    const bad = sites
      .filter((s) => s.columns.some((c) => phantom.includes(c)))
      .map((s) => `${s.file}:${s.line}`);
    expect(bad, `phantom column names returned at:\n${bad.join("\n")}`).toEqual([]);
  });

  it("logs the void/comp audit site, which must never silently vanish again", () => {
    const voidComp = sites.filter((s) => s.file.includes("void-comp"));
    expect(voidComp.length, "void-comp.js no longer writes an audit row").toBeGreaterThan(0);
    for (const s of voidComp) {
      expect(s.columns).toContain("employee_id");
      expect(s.columns).toContain("action_type");
    }
  });
});
