import { chromium } from "playwright";
import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const FRONTEND_PORT = 5173;
const BACKEND_PORT = 5000;
const BASE_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

function waitForPort(port, host = "127.0.0.1", timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = new net.Socket();
      sock.setTimeout(1200);
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`timeout waiting for ${host}:${port}`));
        else setTimeout(tick, 250);
      });
      sock.once("timeout", () => {
        sock.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`timeout waiting for ${host}:${port}`));
        else setTimeout(tick, 250);
      });
      sock.connect(port, host);
    };
    tick();
  });
}

function spawnProcess(cmd, args, cwd) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  child.stdout.on("data", (d) => process.stdout.write(String(d)));
  child.stderr.on("data", (d) => process.stderr.write(String(d)));
  return child;
}

const checks = [];

async function runCheck(page, name, path, steps) {
  const record = { module: name, route: path, status: "PASS", checks: [], error: null };
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(450);
    for (const step of steps) {
      try {
        await step.run(page);
        record.checks.push({ check: step.label, status: "PASS" });
      } catch (e) {
        record.status = "FAIL";
        record.checks.push({
          check: step.label,
          status: "FAIL",
          details: String(e?.message || e),
        });
      }
    }
  } catch (e) {
    record.status = "FAIL";
    record.error = String(e?.message || e);
  }
  checks.push(record);
}

const backendCmd = process.platform === "win32" ? "node" : "node";
const frontendCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const backend = spawnProcess(backendCmd, ["index.js"], "../backend");
const frontend = spawnProcess(
  frontendCmd,
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(FRONTEND_PORT)],
  ".",
);

let browser;
let context;

try {
  await waitForPort(BACKEND_PORT);
  await waitForPort(FRONTEND_PORT);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  await context.addInitScript((session) => {
    localStorage.setItem("authSession", JSON.stringify(session));
    localStorage.setItem("currentEmployee", JSON.stringify(session.employee));
  }, {
    employee: { id: 1, name: "Admin User", role_id: 2 },
    permissions: ["all_access"],
    loadedAt: Date.now(),
  });

  const page = await context.newPage();

  await runCheck(page, "Categories", "/categories", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /^categories$/i }).first().waitFor({ timeout: 12000 }),
    },
  ]);

  await runCheck(page, "Brands", "/brands", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /^brands$/i }).first().waitFor({ timeout: 12000 }),
    },
  ]);

  await runCheck(page, "Taxes", "/taxes", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /taxes/i }).first().waitFor({ timeout: 12000 }),
    },
  ]);

  await runCheck(page, "Attribute Sets", "/attribute-sets", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /attribute sets/i }).first().waitFor({ timeout: 12000 }),
    },
  ]);

  await runCheck(page, "Stock Adjustments", "/adjustments", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /stock adjustments/i }).first().waitFor({ timeout: 12000 }),
    },
  ]);

  await runCheck(page, "Transfers", "/transfers", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /^transfers$/i }).first().waitFor({ timeout: 12000 }),
    },
  ]);

  await runCheck(page, "Returned Stock", "/returned-stock", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /returned stock/i }).first().waitFor({ timeout: 12000 }),
    },
  ]);

  await runCheck(page, "Suppliers", "/suppliers", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /^suppliers$/i }).first().waitFor({ timeout: 12000 }),
    },
    {
      label: "Open/close supplier modal",
      run: async (p) => {
        await p.getByRole("button", { name: /add supplier/i }).first().click();
        await p.getByRole("heading", { name: /create supplier|edit supplier/i }).first().waitFor({ timeout: 5000 });
        await p.getByRole("button", { name: /^cancel$/i }).first().click();
      },
    },
  ]);

  await runCheck(page, "Purchase Orders", "/purchase-orders", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /purchase orders/i }).first().waitFor({ timeout: 12000 }),
    },
    {
      label: "Navigate to create PO view",
      run: async (p) => {
        await p.getByRole("button", { name: /create po|create purchase order/i }).first().click();
        await p.getByRole("heading", { name: /create purchase order/i }).first().waitFor({ timeout: 5000 });
      },
    },
  ]);

  await runCheck(page, "Supplier Payables", "/supplier-payables", [
    {
      label: "Heading visible",
      run: async (p) =>
        p.getByRole("heading", { name: /supplier payables/i }).first().waitFor({ timeout: 12000 }),
    },
    {
      label: "Switch to invoice tab",
      run: async (p) => {
        await p.getByRole("button", { name: /all invoices/i }).first().click();
        await p.getByText(/all invoices|invoice/i).first().waitFor({ timeout: 5000 });
      },
    },
  ]);

  await runCheck(page, "Promotions", "/promotions", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /^promotions$/i }).first().waitFor({ timeout: 12000 }),
    },
    {
      label: "Open/close promotion modal",
      run: async (p) => {
        await p.getByRole("button", { name: /add promotion/i }).first().click();
        await p.getByRole("heading", { name: /new promotion|edit promotion/i }).first().waitFor({ timeout: 5000 });
        await p.getByRole("button", { name: /^cancel$/i }).first().click();
      },
    },
  ]);

  await runCheck(page, "Expenses", "/expenses", [
    {
      label: "Heading visible",
      run: async (p) => p.getByRole("heading", { name: /^expenses$/i }).first().waitFor({ timeout: 12000 }),
    },
    {
      label: "Open/close expense modal",
      run: async (p) => {
        await p.getByRole("button", { name: /add expense/i }).first().click();
        await p.getByRole("heading", { name: /add expense|edit expense/i }).first().waitFor({ timeout: 5000 });
        await p.getByRole("button", { name: /^cancel$/i }).first().click();
      },
    },
  ]);

  const failed = checks.filter((c) => c.status === "FAIL").length;
  console.log(JSON.stringify({ summary: { total: checks.length, failed }, checks }, null, 2));
  if (failed > 0) process.exitCode = 1;
} catch (e) {
  console.error("WAVE_B_SMOKE_FATAL:", e?.message || e);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  backend.kill("SIGTERM");
  frontend.kill("SIGTERM");
}
