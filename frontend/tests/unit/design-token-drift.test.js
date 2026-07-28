/**
 * Design-token drift guard — same bidirectional-enforcement idea as the
 * backend's permissions-catalog / business-modules-catalog tests, applied to
 * CSS custom properties.
 *
 * Why this exists: Tailwind v4's `bg-(--some-token)` arbitrary-property syntax
 * compiles to `background-color: var(--some-token)` REGARDLESS of whether that
 * token is defined anywhere. An undefined token is not a build error and not a
 * runtime warning — the declaration is simply invalid and the element renders
 * with no value at all (transparent background, no border).
 *
 * That failure mode is completely silent and it had already accumulated 9
 * distinct undefined tokens across 24 call sites before anyone noticed
 * (`--ui-surface-2`, `--ui-success`, `--ui-shadow-sm`, `--bg`, `--bg-primary`,
 * `--border-primary`, `--color-primary`, `--color-surface`,
 * `--color-text-secondary`). This test makes the next one fail CI instead.
 *
 * Guarantee: every `--token` referenced via Tailwind arbitrary-property syntax
 * `(--x)` or via `var(--x)` anywhere in frontend/src is defined in a project
 * CSS file. If a rename is impractical, map the old name onto the Square
 * palette in tokens.css's legacy-alias block — that is what it is for.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

/** Tokens the browser supplies; never declared by us. */
const BUILTIN = new Set(["--tw-"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(SRC);

const definedTokens = new Set();
for (const file of files.filter((f) => f.endsWith(".css"))) {
  const css = fs.readFileSync(file, "utf8");
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) definedTokens.add(m[1]);
}

// `(--x)` covers Tailwind v4 arbitrary properties; `var(--x)` covers inline styles.
const REFERENCE = /(?:\(|var\()(--[a-z0-9-]+)\)/gi;

const references = new Map(); // token -> ["relative/path.jsx:12", ...]
for (const file of files.filter((f) => /\.(jsx?|css)$/.test(f))) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(REFERENCE)) {
      const token = m[1];
      if ([...BUILTIN].some((p) => token.startsWith(p))) continue;
      if (!references.has(token)) references.set(token, []);
      references.get(token).push(`${path.relative(SRC, file)}:${i + 1}`);
    }
  });
}

describe("design token drift", () => {
  it("finds the project's token definitions", () => {
    // Sanity: if this ever hits zero the walker is broken and the whole
    // suite would pass vacuously.
    expect(definedTokens.size).toBeGreaterThan(20);
    expect(definedTokens.has("--ui-primary")).toBe(true);
  });

  it("every referenced CSS custom property is defined in a project CSS file", () => {
    const undefinedTokens = [...references.entries()]
      .filter(([token]) => !definedTokens.has(token))
      .map(([token, sites]) => `${token} — referenced at ${sites.join(", ")}`);

    expect(
      undefinedTokens,
      "Undefined CSS custom properties render as NO value (transparent bg / no " +
        "border), silently. Either use a canonical --ui-* token, or add a " +
        "legacy alias in src/ui/tokens.css.\n" +
        undefinedTokens.join("\n")
    ).toEqual([]);
  });
});
