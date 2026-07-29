# Frontend Dependency Audit

**Date:** 2026-07-30 · **Commit audited:** `81efd480` · **Source:** `npm audit` + GitHub Dependabot, cross-checked against the deployed bundle

Phase 0's dependency work was backend-only. The "33 → 4 advisories" figure in `03-action-plan.md` never covered `frontend/`, which had never been audited at all. Enabling Dependabot surfaced 49 open alerts there. This is the complete picture.

---

## The headline

**15 vulnerabilities. Two of them are in code that reaches a user's browser.** The other 13 are build and test tooling that never leaves this machine or the CI runner.

| | count |
|---|---|
| `npm audit` total | **15** (1 critical, 12 high, 2 low) |
| Dependabot alerts, frontend | **49** |
| Reachable in a browser | **2** — `react-router`, `xlsx` |
| Cleared by `npm audit fix` (applied, see §5) | **15 → 8 entries / 3 distinct causes** |
| No fix at any version | **1** — `xlsx` |

The two totals describe the same finding set at different granularity: Dependabot files one alert per advisory per dependency path, `npm audit` collapses them per package. Neither is wrong; quoting them side by side without that sentence is what makes the situation look twice as bad as it is.

---

## 1. What actually ships to a browser

Verified empirically against the entry chunk `sanopos.com` is serving, not inferred from the manifest:

| marker | in production entry chunk |
|---|---|
| `react-router` | **present** |
| `xlsx` / SheetJS | absent — lazy |
| `recharts` | absent — lazy |

So of the 15, only **`react-router`** loads on every route for every user, and **`xlsx`** loads on demand. Everything else — `vite`, `rollup`, `postcss`, `esbuild`, `picomatch`, `undici`, `minimatch`, `brace-expansion`, `js-yaml`, `flatted`, `@babel/core`, `vitest` — is toolchain.

### Why five build tools are labelled "runtime"

Dependabot marks `vite`, `rollup`, `postcss`, `esbuild` and `picomatch` as **runtime** scope, which is alarming and wrong. The cause is a manifest error:

```
@tailwindcss/vite  →  vite  →  { rollup, postcss, esbuild, picomatch }
```

`@tailwindcss/vite` and `tailwindcss` are declared in **`dependencies`**, not `devDependencies`. Both are build-time only — the plugin runs inside Vite and Tailwind v4 compiles CSS at build. Because they sit in the production tree, the entire Vite toolchain inherits production scope.

`npm ls` confirms none of the four reaches the app any other way: every path to `postcss`, `rollup`, `esbuild` and `picomatch` runs through `vite`.

**Moving those two declarations to `devDependencies` reclassifies 5 packages and ~11 alerts to what they actually are.** Vercel installs devDependencies during builds by default, so this should be inert — but it is a build-config change and wants a deploy to confirm, not an assumption.

---

## 2. `react-router` — 12 advisories, 2 of them apply

`App.jsx:1` imports `BrowserRouter`. This is React Router in **library mode**: client-side only, no SSR, no RSC, no framework mode, no `createBrowserRouter` data APIs, no server. That is decisive, because most of the advisories are against machinery this app does not run.

Installed: **7.13.0**.

| GHSA | sev | fixed in | applies here? |
|---|---|---|---|
| `GHSA-wrjc-x8rr-h8h6` — open redirect via backslash in `<Link>` / `useNavigate` | med | 7.18.0 | **YES** — both APIs are used throughout |
| `GHSA-2j2x-hqr9-3h42` — same-origin redirect starting `//` reinterpreted as protocol-relative | med | 7.14.1 | **YES** — client navigation |
| `GHSA-chx6-hx7r-mcp5` — DoS via inefficient route matching | high | 7.18.0 | marginal — "unauthenticated" implies server-side matching; client-side this is self-inflicted |
| `GHSA-49rj-9fvp-4h2h` — turbo-stream RCE via `TYPE_ERROR` deserialization | high | 7.14.2 | no — single-fetch serialisation, framework mode |
| `GHSA-rxv8-25v2-qmq8` — DoS via reflected input in single-fetch | high | 7.14.0 | no — framework mode |
| `GHSA-8x6r-g9mw-2r78` — DoS via unbounded path expansion in `__manifest` | high | 7.15.0 | no — server endpoint |
| `GHSA-8646-j5j9-6r62` — XSS via `javascript:` targets in RSC redirects | high | 7.13.2 | no — RSC |
| `GHSA-h8fp-f39c-q6mh` — `RSCErrorHandler` missing protocol validation | med | 7.18.0 | no — RSC |
| `GHSA-qwww-vcr4-c8h2` — RSC-mode CSRF bypass | high | **8.3.0** | no — RSC |
| `GHSA-337j-9hxr-rhxg` — constructor injection via `deserializeErrors()` | med | 7.18.0 | no — SSR hydration |
| `GHSA-f22v-gfqf-p8f3` — stored XSS via unescaped `Location` in prerendered redirect HTML | med | 7.13.2 | no — React Router's own prerendering; this repo prerenders marketing shells with a bespoke script (`scripts/prerender-meta.mjs`), not this |
| `GHSA-84g9-w2xq-vcv6` — CSRF via PUT/PATCH/DELETE document requests | low | 7.15.1 | no — framework mode |

**Two medium-severity open redirects are the real exposure.** Both are fixed by 7.18.0.

**The major upgrade is not required.** The single advisory whose fix is `8.3.0` — `GHSA-qwww` — is RSC-mode CSRF, which this app cannot reach. `react-router-dom` is declared `^7.13.0`, so **7.18.x is inside the existing range**: a lockfile bump, no API surface change, no migration.

---

## 3. `xlsx` — no fix at any version, and it is genuinely used

Two high advisories (prototype pollution, ReDoS), `fixAvailable: false`. This is the same package and the same dead end already recorded for the backend.

The reason there is no fix: npm's `xlsx` is frozen at **0.18.5**. The advisories' patched versions (0.19.3, 0.20.2) are published only to SheetJS's own registry at `cdn.sheetjs.com`, so npm can see the advisory and never the remedy.

Used in three places, all behind `await import("xlsx")` — a static-import grep finds nothing and will mislead you:

- `pages/redesign/cod/ImportWizard.jsx:68` — parse an uploaded sheet
- `pages/redesign/InventoryRedesign.jsx:76` — generate the products import template
- `pages/redesign/InventoryRedesign.jsx:401` — parse an uploaded `.xlsx`/`.xls`

Because it is lazy, it is **not** in the entry chunk — confirmed against the deployed bundle. It costs 429 kB raw / 143 kB gzip only to a user who opens an import screen, and the malicious input would be a spreadsheet that user chose themselves. That is a materially narrower exposure than "ships to every POS user", and it is why this is not the most urgent item despite being the only unfixable one.

Three ways out, all of which should be decided **once, for backend and frontend together**, since both depend on it: install from the SheetJS registry, replace with a maintained parser, or restrict uploads to CSV permanently (already the Phase 0 pilot-scoping decision).

---

## 4. The one "critical" is unreachable

`GHSA-5xrq-8626-4rwp` — arbitrary file read and execution **when the Vitest UI server is listening**. `vitest` is a devDependency and nothing in this repo starts that server: the scripts run `vitest run` / `vitest`, and the only `--ui` in `package.json` is `test:e2e:ui`, which is Playwright's UI, not Vitest's.

It is still worth patching — 4.0.18 → 4.1.0 is inside `^4.0.18` and free — but it should not be read as a critical hole in the product. Anyone triaging by severity alone would start here, and start in the wrong place.

---

## 5. What `npm audit fix` actually did — applied 2026-07-30

**A prediction in the first draft of this file was wrong and is corrected here.** It said `npm audit fix` would take 15 → 2. It took **15 → 8**. The direction was right, the arithmetic was not: I counted advisories that persist post-fix as if they would disappear, and `npm audit` reports the same advisory once per affected package, so a single unfixable issue can surface as several entries.

Applied. Direct deps that moved, all inside their declared ranges: `react-router-dom` 7.13.0 → **7.18.2**, `vite` 7.3.1 → **7.3.6**, `vitest` 4.0.18 → **4.1.x**, `eslint` 9.39.1 → **9.39.3**. Lockfile only.

```
before   1 critical, 12 high, 2 low   (15 entries)
after    0 critical,  8 high, 0 low   ( 8 entries, 3 distinct causes)
```

The 8 that remain are the three causes this audit already identified, and **none is browser-reachable**:

| cause | entries | why it survives | reachable? |
|---|---|---|---|
| `GHSA-qwww-vcr4-c8h2` — RSC-mode CSRF | 2 (`react-router`, `react-router-dom`) | patched only in **8.3.0**; npm's resolver offers a *downgrade* to 7.11.0 and calls it a major | **no** — RSC mode, this app is `<BrowserRouter>` |
| `brace-expansion` OOM DoS (`<=5.0.7`) | 5 (`brace-expansion`, `minimatch`, `@eslint/eslintrc`, `@eslint/config-array`, `eslint`) | reachable only through ESLint 9's tree; needs **ESLint 10**, a major | **no** — lint-time, dev-only |
| `xlsx` prototype pollution + ReDoS | 1 | npm's copy frozen at 0.18.5 | lazy chunk only, on a file the merchant chose |

Every advisory that was both fixable and reachable is gone, including the lone critical. The residue is one major upgrade for a linter, one unreachable advisory awaiting a framework major, and the standing `xlsx` decision.

---

## Recommendation

In this order, and none of it is urgent — there are still zero external merchants, and the only browser-reachable applicable issues are two open redirects:

1. ~~**`npm audit fix` in `frontend/`.**~~ **DONE 2026-07-30.** 15 → 8, see §5. Verified after: production build succeeds (CSS output byte-identical), `tsc --noEmit` clean, unit suite 201/201, ESLint baseline ratchet unchanged at 1007 with none new.
2. ~~**Move `@tailwindcss/vite` and `tailwindcss` to `devDependencies`.**~~ **DONE 2026-07-30.** The production tree is now exactly the 12 packages that ship — `vite`, `rollup`, `postcss`, `esbuild` and `picomatch` no longer appear under `--omit=dev`, so future alerts against them are labelled dev and triaged correctly instead of being re-litigated each time. Tailwind still compiles from devDependencies: the emitted CSS kept its content hash across the move.
3. ~~**Dismiss `GHSA-qwww` with a reason**~~ — **DONE 2026-07-30.** Dismissed as `not_used` with the library-mode reasoning attached, so the list stays actionable.
4. ~~**Decide `xlsx` once, for both halves of the codebase.**~~ — **DECIDED AND DONE 2026-07-30 (`e9e1c27e`): CSV-only imports, `xlsx` uninstalled from both packages.** The only genuinely unfixable dependency is gone. Parsing moved to `papaparse` rather than a hand-rolled parser, because XLSX was doing RFC-4180 quoting for free and the alternative was trading a CVE for silent column-shifting on the path that sets prices and stock. Two regressions accepted knowingly and recorded at the call sites: the template can no longer mark barcode/sku as Text, so an Excel round-trip can eat leading zeros (import itself still reads every value as a string), and the "Branches (reference)" sheet becomes a separate CSV. Bonus: the lazy `xlsx` chunk was 429 kB raw / 143 kB gzip; `papaparse` is 19.8 kB / 7.4 kB in its place. Advisories now **backend 3, frontend 7** — everything left needs a major or is unreachable.
5. **ESLint 10** whenever convenient. It is the sole remaining fixable cause (5 of the 8 entries), it is lint-time and dev-only, and it is a major — so it belongs in a quiet moment, not in a security batch.

### Worth doing at the same time, though not a vulnerability

`@sentry/react` is **450 kB raw / 150 kB gzip** of the entry chunk — larger than everything else in it combined, and the biggest thing loading before a cashier can ring a sale. It stayed invisible because `main.jsx` guards `Sentry.init()` behind `if (SENTRY_DSN)` while importing the SDK statically, and Vite inlines the unset env var locally, tree-shaking the whole package out of every local build. Lazy-initialising it is probably a larger user-facing win than the `manualChunks` removal was.
