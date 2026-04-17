import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import noRawInteractivePlugin from "./eslint-rules/index.js";

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
    files: ["src/pages/redesign/**/*.{js,jsx}"],
    plugins: { sano: noRawInteractivePlugin },
    rules: {
      "sano/no-raw-interactive": "error",
    },
  },
]);
