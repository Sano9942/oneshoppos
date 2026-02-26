import { chromium } from 'playwright';

const baseURL = 'http://127.0.0.1:4173';
const session = {
  employee: { id: 1, name: 'Admin User', role_id: 2 },
  permissions: ['all_access'],
  loadedAt: Date.now(),
};

const results = [];

async function runCheck(page, moduleName, path, assertions) {
  const item = { module: moduleName, status: 'PASS', checks: [], error: null };
  try {
    await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(350);
    for (const fn of assertions) {
      const label = fn.label;
      try {
        await fn.run(page);
        item.checks.push({ check: label, status: 'PASS' });
      } catch (e) {
        item.checks.push({ check: label, status: 'FAIL', details: String(e.message || e) });
        item.status = 'FAIL';
      }
    }
  } catch (e) {
    item.status = 'FAIL';
    item.error = String(e.message || e);
  }
  results.push(item);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript((s) => {
  localStorage.setItem('authSession', JSON.stringify(s));
  localStorage.setItem('currentEmployee', JSON.stringify(s.employee));
}, session);
const page = await context.newPage();

await runCheck(page, 'Taxes', '/taxes', [
  {
    label: 'Page heading renders',
    run: async (p) => {
      await p.getByRole('heading', { name: /taxes/i }).first().waitFor({ timeout: 10000 });
    },
  },
  {
    label: 'Open and close add-tax modal',
    run: async (p) => {
      await p.getByRole('button', { name: /add tax rule/i }).click();
      await p.getByText(/create tax rule|edit tax rule/i).first().waitFor({ timeout: 5000 });
      await p.getByRole('button', { name: /^cancel$/i }).first().click();
    },
  },
]);

await runCheck(page, 'Attribute Sets', '/attribute-sets', [
  {
    label: 'Page heading renders',
    run: async (p) => {
      await p.getByRole('heading', { name: /attribute sets/i }).first().waitFor({ timeout: 10000 });
    },
  },
  {
    label: 'Open and close new-set modal',
    run: async (p) => {
      await p.getByRole('button', { name: /new set/i }).click();
      await p.getByText(/create attribute set|edit attribute set/i).first().waitFor({ timeout: 5000 });
      await p.getByRole('button', { name: /^cancel$/i }).first().click();
    },
  },
]);

await runCheck(page, 'Stock Adjustments', '/adjustments', [
  {
    label: 'Page heading renders',
    run: async (p) => {
      await p.getByRole('heading', { name: /stock adjustments/i }).first().waitFor({ timeout: 10000 });
    },
  },
  {
    label: 'Open and close new-adjustment modal',
    run: async (p) => {
      await p.getByRole('button', { name: /new adjustment/i }).click();
      await p.getByText(/new stock adjustment/i).first().waitFor({ timeout: 5000 });
      await p.getByRole('button', { name: /^cancel$/i }).first().click();
    },
  },
]);

await runCheck(page, 'Transfers', '/transfers', [
  {
    label: 'Page heading renders',
    run: async (p) => {
      await p.getByRole('heading', { name: /^transfers$/i }).first().waitFor({ timeout: 10000 });
    },
  },
  {
    label: 'Open and close new-transfer modal',
    run: async (p) => {
      await p.getByRole('button', { name: /new transfer/i }).click();
      await p.getByText(/new transfer/i).first().waitFor({ timeout: 5000 });
      await p.getByRole('button', { name: /^cancel$/i }).first().click();
    },
  },
]);

await runCheck(page, 'Returned Stock', '/returned-stock', [
  {
    label: 'Page heading renders',
    run: async (p) => {
      await p.getByRole('heading', { name: /returned stock/i }).first().waitFor({ timeout: 10000 });
    },
  },
  {
    label: 'Open and close new-supplier-return modal',
    run: async (p) => {
      await p.getByRole('button', { name: /new supplier return/i }).click();
      await p.getByText(/new supplier return/i).first().waitFor({ timeout: 5000 });
      await p.getByRole('button', { name: /^cancel$/i }).first().click();
    },
  },
]);

await browser.close();
console.log(JSON.stringify(results, null, 2));
