import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import sanoPlugin from "./eslint-rules/index.js";

export default defineConfig([
  globalIgnores([
    "dist",
    "dist-ssr",
    "coverage",
    "playwright-report*/",
    "test-results/",
  ]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^[A-Z_]" },
      ],
    },
  },
  {
    // Node-context files: build config, edge middleware, scripts, lint rules
    // and the test runners all execute outside the browser. Without this they
    // report phantom `no-undef` on process / __dirname / global.
    files: [
      "*.{js,mjs,cjs}",
      "scripts/**/*.{js,mjs,cjs}",
      "eslint-rules/**/*.js",
      "tests/**/*.{js,jsx}",
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["src/pages/redesign/**/*.{js,jsx}"],
    plugins: { sano: sanoPlugin },
    rules: {
      "sano/no-raw-interactive": "error",
    },
  },
  {
    // Square design system: colour comes from --ui-* tokens, never the stock
    // Tailwind palette. Applies app-wide, not just to redesign/ — the reskin's
    // coverage gaps were in setup, portal, public and guard files.
    //
    // Only colours written INLINE in a className are flagged. Data-encoding
    // colours (Recharts series, EMPLOYEE_COLORS, STATUS_COLORS, dental-chart
    // condition codes, SetupWizard's 23 per-industry tiles) live in lookup maps
    // and are deliberately out of reach of this rule — sweeping them onto
    // tokens would destroy the meaning they carry. See the rule's header.
    files: ["src/**/*.{js,jsx}"],
    ignores: [
      // Documented hardcoded-colour exceptions — see ui/CLAUDE.md.
      "src/ui/PwaInstallPrompt.jsx", // emerald/slate install card, never tokenized
      "src/ui/SubscriptionBanner.jsx", // amber/red trial + grace + expired bars
      "src/ui/AnnouncementBanner.jsx", // TYPE_STYLES info/warning/maintenance
      "src/ui/ImpersonationBanner.jsx", // amber super-admin bar
      "src/ui/StarRating.jsx", // star gold
      "src/ui/ErrorBoundary.jsx", // amber/red error icon + dev stack <pre>
      "src/ui/SupportWidget.jsx", // floating button + screenshot remove icon
      // Toast pills render on a BLACK --ui-primary background; the -400 icon
      // tints are chosen for on-dark legibility and have no token equivalent
      // (the token set has no on-dark status variants). Swapping them for
      // --ui-success-fg etc. would make the icons near-invisible.
      "src/contexts/ToastContext.jsx",
    ],
    plugins: { sano: sanoPlugin },
    rules: {
      "sano/no-raw-palette-color": [
        "error",
        {
          // Star gold — an identity colour with no --ui-* equivalent.
          allow: ["text-yellow-400", "fill-yellow-400"],
        },
      ],
    },
  },
]);
