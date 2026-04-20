#!/usr/bin/env node
// Launches backend pointed at PRODUCTION Supabase. Requires typing --yes-really to confirm.
// Never use this for normal dev work. Use `npm run dev` instead.

const { spawn } = require("child_process");
const path = require("path");

if (!process.argv.includes("--yes-really")) {
  console.log("\n\x1b[41m\x1b[37m DANGER: This connects to PRODUCTION Supabase. \x1b[0m");
  console.log("Live tenant data. Every query hits real merchant records.");
  console.log("\nIf you truly mean to do this, re-run with:");
  console.log("  npm run dev:prod -- --yes-really\n");
  process.exit(1);
}

process.env.DB_TARGET = "production";
const child = spawn(process.execPath, [path.resolve(__dirname, "..", "index.js")], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code || 0));
