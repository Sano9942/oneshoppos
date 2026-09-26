#!/usr/bin/env node
/**
 * One Toy Store pilot — retail-core acceptance script ("a shop day").
 *
 * Provisions a brand-new throwaway tenant in the LOCAL database, then plays a
 * realistic shop day through the REAL backend (index.js, multi-tenant mode)
 * over HTTP, exactly as the POS / back-office screens call it. While it goes it
 * keeps its own independent "shadow ledger" of what every number should be,
 * and at the end checks every report against that ledger and against each
 * other. Every mismatch is printed as a FAIL; the script exits non-zero if any.
 *
 * LOCAL ONLY. Refuses to run unless both the API base URL and backend/.env's
 * DATABASE_URL point at localhost.
 *
 * Usage:
 *   (start the backend first: `node backend/index.js`, it must print "LOCAL DB")
 *   node tools/onetoystore-pilot/shop-day.mjs [--keep] [--dump]
 *     --dump   write every raw API response to tools/onetoystore-pilot/out/
 *
 * The tenant is left in place (slug printed at the end) so it can be inspected.
 * Remove with: node backend/scripts/drop-test-tenants.js (see that script).
 */

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, "../../backend");
const require = createRequire(path.join(BACKEND, "index.js"));

const BASE = process.env.OTS_API_BASE || "http://localhost:5000";
const DUMP = process.argv.includes("--dump");

// ─── safety ────────────────────────────────────────────────────────────────
require("dotenv").config({ path: path.join(BACKEND, ".env"), quiet: true });
const dbUrl = process.env.DATABASE_URL || "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error("REFUSING: backend/.env DATABASE_URL is not localhost.");
  process.exit(2);
}
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) {
  console.error(`REFUSING: API base ${BASE} is not localhost.`);
  process.exit(2);
}

// ─── result bookkeeping ────────────────────────────────────────────────────
const results = []; // { area, name, ok, detail }
const dump = {};
let currentArea = "setup";
const area = (a) => { currentArea = a; console.log(`\n━━ ${a}`); };
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const near = (a, b, tol = 0.011) => Math.abs(Number(a) - Number(b)) <= tol;

function check(name, actual, expected, tol = 0.011) {
  const ok = typeof expected === "number"
    ? actual != null && near(actual, expected, tol)
    : JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ area: currentArea, name, ok, actual, expected });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  return ok;
}
function note(name, detail) {
  results.push({ area: currentArea, name, ok: null, detail });
  console.log(`  NOTE  ${name}: ${detail}`);
}

// ─── HTTP client ───────────────────────────────────────────────────────────
let TOKEN = null;
let SLUG = null;
let OUTLET = null;
async function call(method, p, body, { allowFail = false, headers = {} } = {}) {
  const sep = p.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${p}${sep}tenant=${SLUG}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(OUTLET ? { "x-outlet-id": String(OUTLET) } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  const text = await r.text();
  try { j = text ? JSON.parse(text) : null; } catch { j = { _raw: text.slice(0, 300) }; }
  if (!r.ok && !allowFail) {
    throw new Error(`${method} ${p} → ${r.status}: ${JSON.stringify(j).slice(0, 500)}`);
  }
  return allowFail ? { status: r.status, body: j } : j;
}
const api = {
  get: (p, o) => call("GET", p, null, o),
  post: (p, b, o) => call("POST", p, b, o),
  put: (p, b, o) => call("PUT", p, b, o),
  del: (p, o) => call("DELETE", p, null, o),
};
// List endpoints wrap their array under varying keys ({outlets}, {rows}, {data}…).
const rows = (j) => {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== "object") return [];
  for (const k of ["rows", "data", "items", "products"]) if (Array.isArray(j[k])) return j[k];
  return Object.values(j).find(Array.isArray) || [];
};

// ─── shadow ledger ─────────────────────────────────────────────────────────
// Everything the shop "knows" happened, computed independently of SanoPOS.
const L = {
  stock: {},        // `${pid}` or `${pid}:${vid}` @ outlet1 → qty
  stock2: {},       // outlet 2
  cost: {},         // pid → current cost_price as SanoPOS should hold it
  sales: [],        // { id, lines:[{pid,vid,qty,price,cost,cat,brand,sup}], subtotal, discount, total, payments:{Cash,Card} }
  refunds: [],      // { pid, qty, amount, method, cost }
  payable: {},      // supplier id → owed
  received: {},     // pid → units received via PO
};
const skey = (pid, vid) => (vid ? `${pid}:${vid}` : `${pid}`);
const addStock = (pid, vid, q, book = L.stock) => { book[skey(pid, vid)] = r2((book[skey(pid, vid)] || 0) + q); };

// ─── catalogue ─────────────────────────────────────────────────────────────
const CATS = ["Die-cast", "Dolls", "Board Games", "Outdoor", "Arts & Crafts", "Building", "Puzzles", "Soft Toys"];
const BRANDS = ["Mattel", "Hasbro", "LEGO", "Generic"];
const SUPS = [
  { key: "A", name: "Mattel Distributor Lahore" },
  { key: "B", name: "Hasbro Traders Karachi" },
  { key: "C", name: "Brick & Bear Imports" },
];
// key, name, cat, brand, sup, price, cost, opening
const SIMPLE = [
  ["hw5", "Hot Wheels 5-Pack", "Die-cast", "Mattel", "A", 2500, 1400],
  ["mbox", "Matchbox Car", "Die-cast", "Mattel", "A", 650, 380],
  ["barbie", "Barbie Dreamhouse Doll", "Dolls", "Mattel", "A", 5500, 3100],
  ["mono", "Monopoly Classic", "Board Games", "Hasbro", "B", 4200, 2400],
  ["jenga", "Jenga", "Board Games", "Hasbro", "B", 2800, 1500],
  ["nerf", "Nerf Elite Blaster", "Outdoor", "Hasbro", "B", 6500, 3800],
  ["doh", "Play-Doh 4 Pack", "Arts & Crafts", "Hasbro", "B", 1200, 650],
  ["legoc", "LEGO Classic Box", "Building", "LEGO", "C", 8900, 5600],
  ["legop", "LEGO City Police Car", "Building", "LEGO", "C", 3500, 2100],
  ["pz1000", "Puzzle 1000pc", "Puzzles", "Generic", "A", 1800, 900],
  ["pz100", "Puzzle 100pc Kids", "Puzzles", "Generic", "A", 900, 450],
  ["rubik", "Rubik's Cube", "Puzzles", "Generic", "A", 1500, 800],
  ["uno", "UNO Cards", "Board Games", "Mattel", "A", 950, 500],
  ["ball", "Football Size 5", "Outdoor", "Generic", "B", 2200, 1100],
  ["rope", "Skipping Rope", "Outdoor", "Generic", "B", 450, 200],
  ["crayon", "Crayons 24", "Arts & Crafts", "Generic", "C", 600, 300],
  ["rccar", "Remote Control Car", "Outdoor", "Generic", "C", 7500, 4500],
  ["teddy", "Soft Teddy Bear", "Soft Toys", "Generic", "C", 3200, 1600, 4],
];

const P = {};   // key → { id, price, cost, cat, brand, sup, barcode }
const V = {};   // key → { id, pid, price, cost, ... }
const IDS = { cat: {}, brand: {}, sup: {} };

function metaOf(pid) {
  return Object.values(P).find((p) => p.id === pid) || Object.values(V).find((v) => v.pid === pid);
}

// Record a sale in the shadow ledger. lines: [{p: P-or-V entry, qty, price}]
function shadowSale(id, lines, { discount = 0, payments }) {
  const subtotal = r2(lines.reduce((s, l) => s + l.qty * l.price, 0));
  const total = r2(subtotal - discount);
  const rec = {
    id, subtotal, discount: r2(discount), total, payments,
    lines: lines.map((l) => ({
      pid: l.p.pid || l.p.id, vid: l.p.pid ? l.p.id : null, qty: l.qty, price: l.price,
      cost: L.cost[l.p.pid || l.p.id], cat: l.p.cat, brand: l.p.brand, sup: l.p.sup,
    })),
  };
  L.sales.push(rec);
  for (const l of rec.lines) addStock(l.pid, l.vid, -l.qty);
  return rec;
}

async function sell(label, lines, { discount_amount = 0, discount_type = "fixed", payments, extra = {} }) {
  const cartItems = lines.map((l) => ({
    id: l.p.pid || l.p.id,
    variant_id: l.p.pid ? l.p.id : undefined,
    name: l.p.name,
    price: l.price,
    quantity: l.qty,
    // The POS cart line is the scanned product row, so it carries cost_price —
    // EXCEPT a bill resumed from "parked", whose lines are rebuilt without it
    // (POSContext.jsx restoreParked). l.noCost mimics that path.
    ...(l.noCost ? {} : { cost_price: L.cost[l.p.pid || l.p.id] }),
    ...(l.override ? { price_override: { original_price: l.override } } : {}),
  }));
  const body = {
    cartItems, payments, outlet_id: OUTLET, employee_id: ADMIN_ID,
    discount_amount, discount_type, idempotency_key: `${SLUG}-${label}`,
    shift_id: SHIFT_ID, ...extra,
  };
  const res = await api.post("/api/sales", body, { allowFail: true });
  dump[`sale_${label}`] = res;
  return res;
}

let ADMIN_ID = null;
let PO_APPROVE_CHECKED = false;
let SHIFT_ID = null;
let OUTLET2 = null;

// ═══════════════════════════════════════════════════════════════════════════
async function provision() {
  area("1. Provision a throwaway shop (local DB)");
  const db = require("./db-pg");
  const masterDb = require("./master-db-pg");
  await masterDb.init(db);
  const { provision } = require("./tenant-provisioner-pg");
  SLUG = `otsacc_${Date.now().toString(36)}`;
  const res = await provision(db, { slug: SLUG, name: "One Toy Store (acceptance)", ownerEmail: `${SLUG}@example.invalid`, pin: "0000", timezone: "Asia/Karachi" });
  await masterDb.query(
    `UPDATE tenants SET plan='pro', max_outlets=5, max_employees=50, max_products=100000,
       payment_status='active', email_verified_at=NOW() WHERE id=$1`,
    [res.tenantId],
  );
  console.log(`  tenant ${SLUG} (id ${res.tenantId})`);

  const setup = await api.post("/api/setup/complete", {
    token: res.setupToken, company_name: "One Toy Store (acceptance)", country: "Pakistan", country_code: "PK",
    city: "Lahore", timezone: "Asia/Karachi", currency_symbol: "Rs", currency_code: "PKR",
    is_gst_registered: false, tax_mode: "none", outlet_name: "Packages Mall", admin_name: "Owner",
    admin_pin: "4321", industry_type: "general_retail",
  });
  TOKEN = setup?.auth?.token || setup?.token;
  ADMIN_ID = setup?.auth?.employee?.id ?? setup?.employee?.id;
  if (!TOKEN) throw new Error(`setup gave no token: ${JSON.stringify(setup).slice(0, 300)}`);
  const outlets = rows(await api.get("/api/outlets"));
  OUTLET = outlets[0].id;
  console.log(`  setup complete; admin employee ${ADMIN_ID}, outlet ${OUTLET}`);
  await db.end().catch(() => {});
}

async function catalogue() {
  area("2. Catalogue: categories, brands, suppliers, products, variants");
  for (const c of CATS) IDS.cat[c] = (await api.post("/api/categories", { name: c })).id;
  for (const b of BRANDS) IDS.brand[b] = (await api.post("/api/brands", { name: b })).id;
  for (const s of SUPS) {
    const r = await api.post("/api/suppliers", { name: s.name, payment_terms: "credit", credit_days: 30 });
    IDS.sup[s.key] = r.id ?? r.supplier?.id;
  }
  check("created 8 categories / 4 brands / 3 suppliers",
    [Object.values(IDS.cat).filter(Boolean).length, Object.values(IDS.brand).filter(Boolean).length, Object.values(IDS.sup).filter(Boolean).length],
    [8, 4, 3]);

  let n = 0;
  for (const [key, name, cat, brand, sup, price, cost, opening] of SIMPLE) {
    n += 1;
    const barcode = `8690000${String(n).padStart(5, "0")}`;
    const r = await api.post("/api/products", {
      name, sku: `OTS-${key.toUpperCase()}`, barcode, price, cost_price: cost,
      category_id: IDS.cat[cat], brand_id: IDS.brand[brand], supplier_id: IDS.sup[sup],
      ...(opening ? { initial_stock: opening } : {}),
    });
    P[key] = { id: r.id, name, price, cost, cat, brand, sup, barcode };
    L.cost[r.id] = cost;
    if (opening) addStock(r.id, null, opening);
  }
  // Variant product 1: Hot Wheels singles, each car its own variant, with opening stock.
  const hw = await api.post("/api/products", {
    name: "Hot Wheels Single Car", sku: "OTS-HWS", price: 450, cost_price: 260,
    category_id: IDS.cat["Die-cast"], brand_id: IDS.brand.Mattel, supplier_id: IDS.sup.A,
    has_variants: true,
    variants: [
      { sku: "HW-TWINMILL", barcode: "027084120901", price: 450, cost_price: 260, initial_stock: 5 },
      { sku: "HW-BONESHAKER", barcode: "027084120902", price: 450, cost_price: 260, initial_stock: 5 },
      { sku: "HW-DEORA", barcode: "027084120903", price: 450, cost_price: 260, initial_stock: 5 },
    ],
  });
  // Variant product 2: dress-up set in two colours, no opening stock.
  const dress = await api.post("/api/products", {
    name: "Doll Dress-Up Set", sku: "OTS-DRESS", price: 2400, cost_price: 1300,
    category_id: IDS.cat.Dolls, brand_id: IDS.brand.Generic, supplier_id: IDS.sup.C,
    has_variants: true,
    variants: [
      { sku: "DRESS-PINK", barcode: "8690000900001", price: 2400, cost_price: 1300 },
      { sku: "DRESS-BLUE", barcode: "8690000900002", price: 2400, cost_price: 1300 },
    ],
  });
  L.cost[hw.id] = 260; L.cost[dress.id] = 1300;
  const hwV = rows(await api.get(`/api/products/${hw.id}/variants`));
  const drV = rows(await api.get(`/api/products/${dress.id}/variants`));
  dump.variants = { hwV, drV };
  for (const v of hwV) {
    const k = v.sku === "HW-TWINMILL" ? "hwTwin" : v.sku === "HW-BONESHAKER" ? "hwBone" : "hwDeora";
    V[k] = { id: v.id, pid: hw.id, name: `Hot Wheels ${v.sku}`, price: 450, cat: "Die-cast", brand: "Mattel", sup: "A" };
    addStock(hw.id, v.id, 5);
  }
  for (const v of drV) {
    const k = v.sku === "DRESS-PINK" ? "dressPink" : "dressBlue";
    V[k] = { id: v.id, pid: dress.id, name: `Dress ${v.sku}`, price: 2400, cat: "Dolls", brand: "Generic", sup: "C" };
  }
  check("18 simple + 2 variant products created", [Object.keys(P).length, Object.keys(V).length], [18, 5]);

  // Scan lookup works for a product barcode and a variant barcode.
  const scanP = await api.get(`/api/products/scan/${P.jenga.barcode}`, { allowFail: true });
  check("barcode scan finds a simple product", scanP.body?.product?.id, P.jenga.id);
  const scanV = await api.get("/api/products/scan/027084120902", { allowFail: true });
  dump.scanVariant = scanV;
  check("barcode scan of a variant barcode resolves to that variant",
    [scanV.status, scanV.body?.product?.id, scanV.body?.variant?.id ?? scanV.body?.product?.variant_id ?? null],
    [200, hw.id, V.hwBone.id]);
}

async function purchasing() {
  area("3. Purchasing: PO → approve → receive (partial + rest), cost, payable");
  const mkPO = async (supKey, keys, qty, costOverride = {}) => {
    const items = keys.map((k) => ({ product_id: P[k].id, quantity: qty, cost_price: costOverride[k] ?? P[k].cost }));
    L.ordered = L.ordered || { units: 0, value: 0, bySup: {} };
    for (const i of items) {
      L.ordered.units += i.quantity; L.ordered.value += i.quantity * i.cost_price;
      L.ordered.bySup[supKey] = (L.ordered.bySup[supKey] || 0) + i.quantity * i.cost_price;
    }
    const po = await api.post("/api/purchase-orders", {
      supplier_id: IDS.sup[supKey], items, outlet_id: OUTLET,
      total_cost: items.reduce((s, i) => s + i.quantity * i.cost_price, 0),
    });
    const id = po.id ?? po.purchaseOrder?.id ?? po.po_id;
    // Approve exactly as the Purchase Orders screen does (PurchaseOrdersRedesign.jsx approvePO: body {}).
    const screen = await api.post(`/api/purchase-orders/${id}/approve`, {}, { allowFail: true });
    if (!PO_APPROVE_CHECKED) {
      PO_APPROVE_CHECKED = true;
      dump.poApproveScreen = screen;
      check("approve a PO the way the PO screen does", screen.status, 200);
    }
    if (screen.status !== 200) {
      // Workaround so the rest of the day can run: the approvals-module flow.
      await api.post(`/api/purchase-orders/${id}/submit`, {});
      await api.post(`/api/purchase-orders/${id}/approve`, { action: "approved", action_by: "Owner" });
    }
    return { id, items };
  };
  const receive = async (po, qtyByKey) => {
    const items = po.items.map((i) => {
      const key = Object.keys(P).find((k) => P[k].id === i.product_id);
      return { product_id: i.product_id, qty_received: qtyByKey[key] ?? 0 };
    });
    const res = await api.post(`/api/purchase-orders/${po.id}/receive`, { outlet_id: OUTLET, items });
    for (const it of items) {
      const cost = po.items.find((x) => x.product_id === it.product_id).cost_price;
      if (it.qty_received > 0) {
        addStock(it.product_id, null, it.qty_received);
        L.received[it.product_id] = (L.received[it.product_id] || 0) + it.qty_received;
        L.receivedValue = L.receivedValue || {};
        L.receivedValue[it.product_id] = (L.receivedValue[it.product_id] || 0) + it.qty_received * cost;
        L.cost[it.product_id] = cost;
      }
      L.payable[po.supKey] = r2((L.payable[po.supKey] || 0) + it.qty_received * cost);
    }
    return res;
  };

  const po1 = await mkPO("A", ["hw5", "mbox", "barbie", "pz1000", "pz100", "rubik", "uno"], 10); po1.supKey = "A";
  const po2 = await mkPO("B", ["mono", "jenga", "nerf", "doh", "ball", "rope"], 8); po2.supKey = "B";
  const po3 = await mkPO("C", ["legoc", "legop", "crayon", "rccar"], 5); po3.supKey = "C";

  // PO1: partial first delivery (hw5 6/10, barbie 4/10), then the rest.
  const g1 = await receive(po1, { hw5: 6, mbox: 10, barbie: 4, pz1000: 10, pz100: 10, rubik: 10, uno: 10 });
  dump.grn1 = g1;
  const po1After = await api.get(`/api/purchase-orders/${po1.id}`);
  check("PO stays open (Approved) after a partial receipt", (po1After.purchaseOrder || po1After).status, "Approved");
  await receive(po1, { hw5: 4, barbie: 6 });
  const po1Done = await api.get(`/api/purchase-orders/${po1.id}`);
  check("PO becomes Received once every line is fully received", (po1Done.purchaseOrder || po1Done).status, "Received");
  await receive(po2, { mono: 8, jenga: 8, nerf: 8, doh: 8, ball: 8, rope: 8 });
  await receive(po3, { legoc: 5, legop: 5, crayon: 5, rccar: 5 });

  // A second, pricier purchase of Rubik's cubes: tests how cost moves (latest vs average).
  const po4 = await mkPO("A", ["rubik"], 10, { rubik: 900 }); po4.supKey = "A";
  await receive(po4, { rubik: 10 });

  // Stock after receiving.
  for (const k of ["hw5", "barbie", "rubik", "mono", "legoc", "teddy"]) {
    const s = await api.get(`/api/products/${P[k].id}/stock`);
    dump[`stock_after_po_${k}`] = s;
    const q = rows(s).find((x) => Number(x.outlet_id) === OUTLET)?.quantity ?? s?.quantity ?? s?.stock;
    check(`on-hand after receiving: ${P[k].name}`, Number(q), L.stock[skey(P[k].id)]);
  }
  const prod = await api.get(`/api/products/${P.rubik.id}`);
  const rubikCost = Number((prod.product || prod).cost_price);
  note("cost method", `Rubik's: bought 10 @ 800 then 10 @ 900; SanoPOS cost_price is now ${rubikCost} ` +
    `(latest-price method; a weighted average would be 850 across 20 units)`);
  check("cost_price after 2nd purchase = latest purchase price (documented behaviour)", rubikCost, 900);

  // Supplier payables = value received per supplier.
  const aging = await api.get("/api/supplier-aging", { allowFail: true });
  dump.supplierAging = aging;
  for (const s of SUPS) {
    const led = await api.get(`/api/supplier-ledger/${IDS.sup[s.key]}`, { allowFail: true });
    dump[`ledger_${s.key}`] = led;
    const bal = led.body?.closing_balance ?? led.body?.balance ?? led.body?.summary?.balance;
    check(`supplier ${s.key} ledger balance = value received`, Number(bal), L.payable[s.key]);
  }

  // Over-receipt guard: the GRN dialog pre-fills each line with the FULL ordered qty.
  const po5 = await mkPO("C", ["crayon"], 5); po5.supKey = "C";
  await receive(po5, { crayon: 3 });
  const over = await api.post(`/api/purchase-orders/${po5.id}/receive`,
    { outlet_id: OUTLET, items: [{ product_id: P.crayon.id, qty_received: 5 }] }, { allowFail: true });
  dump.overReceive = over;
  check("receiving more than was ordered (3 already in + 5 of a 5-unit PO) is refused", over.status >= 400, true);
  if (over.status < 400) { addStock(P.crayon.id, null, 5); L.payable.C = r2(L.payable.C + 5 * 300); L.received[P.crayon.id] += 5; L.receivedValue[P.crayon.id] += 1500; }

  // Pay part of supplier A.
  const invs = rows(await api.get(`/api/supplier-invoices?supplier_id=${IDS.sup.A}`, { allowFail: true }).then((x) => x.body));
  dump.invoicesA = invs;
  if (invs[0]) {
    await api.post(`/api/supplier-invoices/${invs[0].id}/pay`, { amount: 5000, payment_method: "Cash" });
    L.payable.A = r2(L.payable.A - 5000);
    const led = await api.get(`/api/supplier-ledger/${IDS.sup.A}`, { allowFail: true });
    const bal = led.body?.closing_balance ?? led.body?.balance ?? led.body?.summary?.balance;
    check("supplier A balance drops by the Rs 5,000 payment", Number(bal), L.payable.A);
  } else {
    note("supplier invoices", "could not list supplier A invoices; payment step skipped");
  }

  // Variant stock-in by adjustment (POs are product-level only, no variant column).
  for (const k of ["dressPink", "dressBlue"]) {
    await api.post("/api/adjustments", { product_id: V[k].pid, variant_id: V[k].id, outlet_id: OUTLET, quantity_change: 6, reason: "Opening stock" });
    addStock(V[k].pid, V[k].id, 6);
  }
}

async function shiftOpen() {
  area("4. Open the till");
  const s = await api.post("/api/shifts/open", {
    outlet_id: OUTLET, employee_id: ADMIN_ID, opening_float: 5000,
    denominations: [{ denomination: 1000, count: 3 }, { denomination: 500, count: 3 }, { denomination: 100, count: 5 }],
  });
  SHIFT_ID = s.id ?? s.shift?.id ?? s.shift_id;
  check("shift opened", Boolean(SHIFT_ID), true);
  // The POS refuses checkout until the cashier is clocked in (kiosk PIN check-in).
  const ci = await api.post("/api/attendance/pin-checkin", { pin_code: "4321", outlet_id: OUTLET }, { allowFail: true });
  dump.clockIn = ci;
  check("cashier clocks in with PIN", ci.status, 200);
}

const CASH = "Cash";
const CARD = "Card";
async function sellingDay() {
  area("5. Selling: cash, card, split, discounts, override, park, void, variants");
  const expectOk = (label, res) => check(`sale ${label} accepted`, res.status, 200) && res.body;

  let res = await sell("S1-cash", [{ p: P.hw5, qty: 1, price: 2500 }, { p: P.pz1000, qty: 2, price: 1800 }],
    { payments: [{ method: CASH, amount: 6100 }] });
  if (expectOk("S1 cash", res)) shadowSale(res.body.saleId, [{ p: P.hw5, qty: 1, price: 2500 }, { p: P.pz1000, qty: 2, price: 1800 }], { payments: { Cash: 6100 } });

  res = await sell("S2-card", [{ p: P.mono, qty: 1, price: 4200 }, { p: P.legoc, qty: 1, price: 8900 }],
    { payments: [{ method: CARD, amount: 13100 }] });
  if (expectOk("S2 card", res)) shadowSale(res.body.saleId, [{ p: P.mono, qty: 1, price: 4200 }, { p: P.legoc, qty: 1, price: 8900 }], { payments: { Card: 13100 } });
  const S2 = L.sales.at(-1);

  res = await sell("S3-split", [{ p: P.barbie, qty: 1, price: 5500 }, { p: P.doh, qty: 2, price: 1200 }],
    { payments: [{ method: CASH, amount: 2900 }, { method: CARD, amount: 5000 }] });
  if (expectOk("S3 split", res)) shadowSale(res.body.saleId, [{ p: P.barbie, qty: 1, price: 5500 }, { p: P.doh, qty: 2, price: 1200 }], { payments: { Cash: 2900, Card: 5000 } });

  // 10% bill discount on 8,700 → 870 off → 7,830
  res = await sell("S4-pct", [{ p: P.nerf, qty: 1, price: 6500 }, { p: P.ball, qty: 1, price: 2200 }],
    { discount_amount: 10, discount_type: "percent", payments: [{ method: CARD, amount: 7830 }] });
  if (expectOk("S4 10% bill discount", res)) shadowSale(res.body.saleId, [{ p: P.nerf, qty: 1, price: 6500 }, { p: P.ball, qty: 1, price: 2200 }], { discount: 870, payments: { Card: 7830 } });
  check("S4 stored total after 10% discount", Number(res.body?.totalAmount), 7830);

  // Fixed Rs 300 off 3,000; customer hands over 3,000 cash... no, exact 2,700.
  res = await sell("S5-fixed", [{ p: P.rubik, qty: 2, price: 1500 }],
    { discount_amount: 300, discount_type: "fixed", payments: [{ method: CASH, amount: 2700 }] });
  if (expectOk("S5 Rs 300 bill discount", res)) shadowSale(res.body.saleId, [{ p: P.rubik, qty: 2, price: 1500 }], { discount: 300, payments: { Cash: 2700 } });

  // Item discount via price override: LEGO police car 3,500 → 3,200.
  res = await sell("S6-override", [{ p: P.legop, qty: 1, price: 3200, override: 3500 }],
    { payments: [{ method: CARD, amount: 3200 }] });
  if (expectOk("S6 item price override (item discount)", res)) shadowSale(res.body.saleId, [{ p: P.legop, qty: 1, price: 3200 }], { payments: { Card: 3200 } });

  // Cash with change: bill 1,950 (UNO 950 + Matchbox ×... ) customer pays 2,000.
  res = await sell("S7-change", [{ p: P.uno, qty: 1, price: 950 }, { p: P.mbox, qty: 1, price: 650 }, { p: P.rope, qty: 1, price: 450 }],
    { payments: [{ method: CASH, amount: 2100, change: 50 }] });
  if (expectOk("S7 cash with change (tendered 2,100 on 2,050)", res)) shadowSale(res.body.saleId, [{ p: P.uno, qty: 1, price: 950 }, { p: P.mbox, qty: 1, price: 650 }, { p: P.rope, qty: 1, price: 450 }], { payments: { Cash: 2050 } });

  // Park → resume → pay.
  const parkCart = [{ product_id: P.jenga.id, name: P.jenga.name, price: 2800, quantity: 1 }, { product_id: P.rope.id, name: P.rope.name, price: 450, quantity: 2 }];
  const parked = await api.post("/api/parked-sales", { outlet_id: OUTLET, employee_id: ADMIN_ID, items: parkCart, label: "Customer went to ATM" }, { allowFail: true });
  dump.park = parked;
  check("park a bill", parked.status, 200);
  const list = await api.get("/api/parked-sales", { allowFail: true });
  const parkedId = parked.body?.id ?? rows(list.body)[0]?.id;
  check("parked bill appears in the parked list", rows(list.body).some((x) => x.id === parkedId), true);
  const got = await api.get(`/api/parked-sales/${parkedId}`, { allowFail: true });
  dump.parkGet = got;
  await api.del(`/api/parked-sales/${parkedId}`, { allowFail: true });
  res = await sell("S8-resumed", [{ p: P.jenga, qty: 1, price: 2800, noCost: true }, { p: P.rope, qty: 2, price: 450, noCost: true }], { payments: [{ method: CASH, amount: 3700 }] });
  if (expectOk("S8 resumed parked bill", res)) shadowSale(res.body.saleId, [{ p: P.jenga, qty: 1, price: 2800 }, { p: P.rope, qty: 2, price: 450 }], { payments: { Cash: 3700 } });

  // Variants: sell the same Hot Wheels car twice (opening stock 5).
  for (const n of [1, 2]) {
    res = await sell(`S9-hw-${n}`, [{ p: V.hwTwin, qty: 1, price: 450 }], { payments: [{ method: CASH, amount: 450 }] });
    if (expectOk(`S9.${n} Hot Wheels Twin Mill (variant with opening stock), sale #${n}`, res)) {
      shadowSale(res.body.saleId, [{ p: V.hwTwin, qty: 1, price: 450 }], { payments: { Cash: 450 } });
    } else note(`S9.${n} error`, JSON.stringify(res.body).slice(0, 200));
  }
  res = await sell("S10-dress", [{ p: V.dressPink, qty: 2, price: 2400 }], { payments: [{ method: CARD, amount: 4800 }] });
  if (expectOk("S10 dress-up set Pink ×2 (variant stocked by adjustment)", res)) shadowSale(res.body.saleId, [{ p: V.dressPink, qty: 2, price: 2400 }], { payments: { Card: 4800 } });

  // Void a whole bill: stock must come back and it must drop out of sales totals.
  res = await sell("S11-tovoid", [{ p: P.crayon, qty: 1, price: 600 }], { payments: [{ method: CASH, amount: 600 }] });
  if (expectOk("S11 bill to be voided", res)) {
    const vid = res.body.saleId;
    const v = await api.put(`/api/sales/${vid}/void`, { void_reason: "Wrong item rung up" }, { allowFail: true });
    dump.void = v;
    check("void the whole bill", v.status, 200);
  }

  // Insufficient stock must be refused (Remote control car: 5 received, try 6).
  res = await sell("S12-overstock", [{ p: P.rccar, qty: 6, price: 7500 }], { payments: [{ method: CASH, amount: 45000 }] });
  check("selling more than on hand is refused", res.status >= 400, true);

  // Underpayment must be refused.
  res = await sell("S13-underpay", [{ p: P.teddy, qty: 1, price: 3200 }], { payments: [{ method: CASH, amount: 3000 }] });
  check("payment short of the total is refused", res.status >= 400, true);

  // Replaying the same idempotency key must not create a second bill.
  const again = await api.post("/api/sales", {
    cartItems: [{ id: P.hw5.id, name: P.hw5.name, price: 2500, quantity: 1 }, { id: P.pz1000.id, name: P.pz1000.name, price: 1800, quantity: 2 }],
    payments: [{ method: CASH, amount: 6100 }], outlet_id: OUTLET, employee_id: ADMIN_ID,
    idempotency_key: `${SLUG}-S1-cash`, shift_id: SHIFT_ID,
  }, { allowFail: true });
  dump.replay = again;
  check("replaying S1 (same idempotency key) returns the original bill, no new sale",
    again.body?.saleId ?? again.body?.id, L.sales[0].id);

  return { S2 };
}

async function returnsAndStock({ S2 }) {
  area("6. Returns, exchange, supplier return, adjustment, stock count, transfer");
  // Return the LEGO Classic from S2, refund to card.
  let r = await api.post("/api/returns", {
    original_sale_id: S2.id, outlet_id: OUTLET, employee_id: ADMIN_ID, total_refund: 8900, refund_method: CARD,
    reason: "Duplicate gift", items: [{ product_id: P.legoc.id, quantity: 1, refund_price: 8900 }], idempotency_key: `${SLUG}-R1`,
    manager_pin: "4321", // refunds above Rs 5,000 need a manager PIN (risk control)
  }, { allowFail: true });
  dump.return1 = r;
  if (check("return LEGO Classic from S2 (card refund)", r.status, 200)) {
    addStock(P.legoc.id, null, 1);
    L.refunds.push({ pid: P.legoc.id, qty: 1, amount: 8900, method: CARD, cost: L.cost[P.legoc.id], cat: "Building", brand: "LEGO", sup: "C" });
  }
  // Exchange: S1 customer swaps one 1000pc puzzle (1,800) for two 100pc kids puzzles (2 × 900).
  const S1 = L.sales[0];
  r = await api.post("/api/returns", {
    original_sale_id: S1.id, outlet_id: OUTLET, employee_id: ADMIN_ID, total_refund: 1800, refund_method: CASH,
    reason: "Exchange", items: [{ product_id: P.pz1000.id, quantity: 1, refund_price: 1800 }], idempotency_key: `${SLUG}-R2`,
  }, { allowFail: true });
  dump.return2 = r;
  if (check("exchange part 1: return the 1000pc puzzle", r.status, 200)) {
    addStock(P.pz1000.id, null, 1);
    L.refunds.push({ pid: P.pz1000.id, qty: 1, amount: 1800, method: CASH, cost: L.cost[P.pz1000.id], cat: "Puzzles", brand: "Generic", sup: "A" });
  }
  const ex = await sell("S14-exchange", [{ p: P.pz100, qty: 2, price: 900 }], { payments: [{ method: CASH, amount: 1800 }] });
  if (check("exchange part 2: sell two 100pc puzzles", ex.status, 200)) shadowSale(ex.body.saleId, [{ p: P.pz100, qty: 2, price: 900 }], { payments: { Cash: 1800 } });

  // Returning more than was bought must be refused (S2 had 1 Monopoly).
  r = await api.post("/api/returns", {
    original_sale_id: S2.id, outlet_id: OUTLET, employee_id: ADMIN_ID, total_refund: 8400, refund_method: CASH,
    items: [{ product_id: P.mono.id, quantity: 2, refund_price: 4200 }], idempotency_key: `${SLUG}-R3`,
  }, { allowFail: true });
  dump.returnTooMany = r;
  check("returning 2 of an item bought once is refused", r.status >= 400, true);

  // Supplier return: 2 UNO back to supplier A at cost 500.
  r = await api.post("/api/supplier-returns", {
    supplier_id: IDS.sup.A, outlet_id: OUTLET, employee_id: ADMIN_ID, reason: "Damaged box",
    items: [{ product_id: P.uno.id, quantity: 2, unit_price: 500 }],
  }, { allowFail: true });
  dump.supplierReturn = r;
  if (check("supplier return of 2 UNO", r.status, 200)) {
    addStock(P.uno.id, null, -2);
    L.payable.A = r2(L.payable.A - 1000);
  }
  const ledA = await api.get(`/api/supplier-ledger/${IDS.sup.A}`, { allowFail: true });
  dump.ledgerA_afterReturn = ledA;
  const balA = ledA.body?.closing_balance ?? ledA.body?.balance ?? ledA.body?.summary?.balance;
  check("supplier A balance drops by the Rs 1,000 returned (debit note)", Number(balA), L.payable.A);

  // Adjustment: 1 skipping rope damaged.
  r = await api.post("/api/adjustments", { product_id: P.rope.id, outlet_id: OUTLET, employee_id: ADMIN_ID, quantity_change: -1, reason: "Damaged" }, { allowFail: true });
  if (check("stock adjustment −1 rope (damaged)", r.status, 200)) addStock(P.rope.id, null, -1);

  // Transfer: open a 2nd outlet (warehouse) and move 2 RC cars there.
  const o2 = await api.post("/api/outlets", { name: "Store Room", address: "Back office" }, { allowFail: true });
  dump.outlet2 = o2;
  OUTLET2 = o2.body?.id ?? o2.body?.outlet?.id;
  if (OUTLET2) {
    const t = await api.post("/api/transfers", { product_id: P.rccar.id, from_outlet_id: OUTLET, to_outlet_id: OUTLET2, quantity: 2, employee_id: ADMIN_ID, note: "Overflow" }, { allowFail: true });
    dump.transfer = t;
    if (check("transfer 2 RC cars to the store room", t.status, 200)) {
      addStock(P.rccar.id, null, -2);
      addStock(P.rccar.id, null, 2, L.stock2);
    }
  }

  // Stock count of ONE shelf (crayons): staff scan each box. Shelf has 1 fewer than the system.
  const before = {};
  for (const k of Object.keys(P)) before[P[k].id] = L.stock[skey(P[k].id)] || 0;
  // Before counting: every product's on-hand must equal opening + received − sold + returned ± adjustments.
  const pre = rows((await api.get(`/api/reports/on-hand?outlet_id=${OUTLET}`, { allowFail: true })).body);
  const mism = [];
  for (const k of Object.keys(P)) {
    const q = pre.filter((r) => Number(r.product_id) === P[k].id).reduce((a, r) => a + Number(r.quantity), 0);
    if (!near(q, before[P[k].id])) mism.push(`${P[k].name}: report ${q}, expected ${before[P[k].id]}`);
  }
  for (const k of Object.keys(V)) {
    const v = V[k];
    const vr = rows((await api.get(`/api/products/${v.pid}/variants`, { allowFail: true })).body).find((x) => x.id === v.id);
    const want = L.stock[skey(v.pid, v.id)] || 0;
    if (!vr || !near(vr.stock, want)) mism.push(`${v.name}: variant stock ${vr?.stock}, expected ${want}`);
  }
  check("on-hand for every item = opening + received − sold + returned ± adjustments (before the count)", mism, []);
  const hwOnHand = pre.filter((r) => Number(r.product_id) === V.hwTwin.pid).reduce((a, r) => a + Number(r.quantity), 0);
  const hwVariants = ["hwTwin", "hwBone", "hwDeora"].reduce((a, k) => a + (L.stock[skey(V[k].pid, V[k].id)] || 0), 0);
  check("on-hand report for Hot Wheels singles = sum of its cars' stock", hwOnHand, hwVariants);
}

async function shiftClose() {
  area("7. Close the till");
  const cashIn = L.sales.reduce((s, x) => s + (x.payments.Cash || 0), 0);
  const cashOut = L.refunds.filter((x) => x.method === CASH).reduce((s, x) => s + x.amount, 0);
  const expectedDrawer = r2(5000 + cashIn - cashOut);
  const z = await api.get(`/api/reports/current-session-zreport?shift_id=${SHIFT_ID}&outlet_id=${OUTLET}`, { allowFail: true });
  dump.zreport = z;
  const res = await api.post(`/api/shifts/${SHIFT_ID}/close`, {
    closing_cash: expectedDrawer, notes: "End of day",
    denominations: [{ denomination: 5000, count: Math.floor(expectedDrawer / 5000) }, { denomination: 1, count: expectedDrawer % 5000 }],
  }, { allowFail: true });
  dump.shiftClose = res;
  check("close the shift", res.status, 200);
  const exp = res.body?.expected_cash ?? res.body?.shift?.expected_cash;
  check("shift expected cash = float + cash sales − cash refunds", Number(exp), expectedDrawer);
  const variance = res.body?.variance ?? res.body?.shift?.variance ?? res.body?.cash_variance;
  check("counted drawer matches → variance 0", Number(variance), 0);
  const summary = await api.get(`/api/reports/shift-summary?session_id=${SHIFT_ID}`, { allowFail: true });
  dump.shiftSummary = summary;
  return { expectedDrawer, cashIn, cashOut };
}

async function reports(drawer) {
  area("8. Reports agree with the transactions and with each other");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const q = `date_from=${today}&date_to=${today}&from=${today}&to=${today}&outlet_id=${OUTLET}`;
  // Margin reports sit behind the reports_profit_layer flag, OFF by default for general retail.
  // Owner path: Settings → Business Modules → "Advanced Reports" (module reports_addons).
  const flag = await api.post("/api/business-modules/reports_addons/toggle", { enabled: true }, { allowFail: true });
  dump.enableProfitLayer = flag;
  note("margin reports", `OFF by default for a new retail shop (Business Modules → Advanced Reports); switching on → HTTP ${flag.status}`);
  const R = {};
  for (const name of ["sales-summary", "item-wise", "category-wise", "brand-wise", "supplier-wise",     "profit-summary", "profit-by-product", "profit-by-outlet", "sales-stock", "on-hand", "dashboard", "refunds-voids", "sales-detail", "order-wise",
    "finance-payment-mix", "cash-flow", "product-movement", "inventory-dump", "total-purchases", "itemwise-purchases",
    "payables-receivables", "cashier-wise", "discount-leakage", "shrinkage", "history-cost"]) {
    R[name] = await api.get(`/api/reports/${name}?${q}`, { allowFail: true });
    dump[`report_${name}`] = R[name];
    if (R[name].status !== 200) note(`report ${name}`, `HTTP ${R[name].status}: ${JSON.stringify(R[name].body).slice(0, 160)}`);
  }

  R["payment-summary"] = await api.get(`/api/reports/payment-summary?session_id=${SHIFT_ID}`, { allowFail: true });
  R["shift-summary"] = await api.get(`/api/reports/shift-summary?session_id=${SHIFT_ID}`, { allowFail: true });
  R["zreport"] = await api.get(`/api/reports/current-session-zreport?session_id=${SHIFT_ID}`, { allowFail: true });
  for (const k of ["payment-summary", "shift-summary", "zreport"]) dump[`report_${k}`] = R[k];
  // Shadow totals.
  const gross = r2(L.sales.reduce((s, x) => s + x.subtotal, 0));
  const disc = r2(L.sales.reduce((s, x) => s + x.discount, 0));
  const net = r2(L.sales.reduce((s, x) => s + x.total, 0));
  const refunds = r2(L.refunds.reduce((s, x) => s + x.amount, 0));
  const bills = L.sales.length;
  const cash = r2(L.sales.reduce((s, x) => s + (x.payments.Cash || 0), 0));
  const card = r2(L.sales.reduce((s, x) => s + (x.payments.Card || 0), 0));
  const cogs = r2(L.sales.reduce((s, x) => s + x.lines.reduce((a, l) => a + l.qty * l.cost, 0), 0));
  const returnedCost = r2(L.refunds.reduce((s, x) => s + x.qty * x.cost, 0));
  const shadow = { gross, disc, net, refunds, bills, cash, card, cogs, returnedCost, netAfterReturns: r2(net - refunds) };
  dump.shadow = { ...shadow, ledger: L };
  console.log("  shadow ledger:", JSON.stringify(shadow));
  return { R, shadow };
}

async function stockCount() {
  area("9. Stock count of one shelf (run last: it can wipe stock)");
  const before = {};
  for (const k of Object.keys(P)) before[P[k].id] = L.stock[skey(P[k].id)] || 0;
  const sc = await api.post("/api/stock-counts", { outlet_id: OUTLET, notes: "Crayon shelf" }, { allowFail: true });
  dump.stockCount = sc;
  const scId = sc.body?.stockCount?.id ?? sc.body?.id;
  if (scId) {
    const expected = L.stock[skey(P.crayon.id)];
    const snap = await api.get(`/api/stock-counts/${scId}`, { allowFail: true });
    const snapItem = rows(snap.body?.items).find((i) => Number(i.product_id) === P.crayon.id);
    check("stock count snapshot shows the system quantity for crayons", Number(snapItem?.system_qty), expected);
    for (let i = 0; i < expected - 1; i += 1) {
      await api.post(`/api/stock-counts/${scId}/scan`, { barcode: P.crayon.barcode }, { allowFail: true });
    }
    const detail = await api.get(`/api/stock-counts/${scId}`, { allowFail: true });
    dump.stockCountDetail = detail;
    const crayonRows = rows(detail.body?.items).filter((i) => Number(i.product_id) === P.crayon.id);
    check("scanning the same box repeatedly adds to ONE count line", crayonRows.length, 1);
    check("that line shows counted = scans, system = on-hand",
      crayonRows.length === 1 ? [Number(crayonRows[0].counted_qty), Number(crayonRows[0].system_qty)] : crayonRows.map((r) => [Number(r.counted_qty), Number(r.system_qty)]),
      [expected - 1, expected]);
    const vscan = await api.post(`/api/stock-counts/${scId}/scan`, { barcode: "027084120903" }, { allowFail: true });
    dump.stockCountVariantScan = vscan;
    check("a Hot Wheels variant barcode can be scanned in a stock count", vscan.status, 200);
    const done = await api.post(`/api/stock-counts/${scId}/complete?auto_adjust=true`, {}, { allowFail: true });
    dump.stockCountComplete = done;
    check("complete the count with auto-adjust", done.status, 200);
    // What did the count do to on-hand? Read it back and mirror it in the shadow ledger.
    const after = rows((await api.get(`/api/reports/on-hand?outlet_id=${OUTLET}`, { allowFail: true })).body);
    const qtyNow = (pid) => after.filter((r) => Number(r.product_id) === pid).reduce((a, r) => a + Number(r.quantity), 0);
    check("the counted item (crayons) is corrected to the shelf count", qtyNow(P.crayon.id), expected - 1);
    const wiped = Object.keys(P).filter((k) => k !== "crayon" && before[P[k].id] > 0 && qtyNow(P[k].id) === 0);
    check("items NOT on the counted shelf keep their stock (a shelf count must not zero the rest of the shop)",
      wiped.map((k) => P[k].name), []);
    // Mirror reality so the later report checks compare like with like.
    for (const k of Object.keys(P)) L.stock[skey(P[k].id)] = qtyNow(P[k].id);
    for (const k of Object.keys(V)) {
      const v = V[k];
      const pr = await api.get(`/api/products/${v.pid}/variants`, { allowFail: true });
      const vr = rows(pr.body).find((x) => x.id === v.id);
      if (vr) note(`variant ${v.name} after count`, `stock ${vr.stock}`);
    }
    L.countWiped = wiped.length;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  try {
    await provision();
    await catalogue();
    await purchasing();
    await shiftOpen();
    const ctx = await sellingDay();
    await returnsAndStock(ctx);
    const drawer = await shiftClose();
    const { R, shadow } = await reports(drawer);
    const { assertReports } = await import("./shop-day-reports.mjs");
    await assertReports({ R, shadow, L, P, V, IDS, SUPS, api, check, note, area, OUTLET, OUTLET2, skey, rows, dump, near, r2 });
    await stockCount();
  } catch (err) {
    results.push({ area: currentArea, name: "script crashed", ok: false, detail: err.stack });
    console.error(`\nCRASH in "${currentArea}":`, err.message);
  }
  const fails = results.filter((r) => r.ok === false);
  const passes = results.filter((r) => r.ok === true);
  console.log(`\n══ ${passes.length} passed, ${fails.length} failed, ${results.filter((r) => r.ok === null).length} notes — tenant ${SLUG} — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const outDir = path.resolve(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `ots-shop-day-${SLUG}-results.json`), JSON.stringify(results, null, 2));
  if (DUMP) fs.writeFileSync(path.join(outDir, `ots-shop-day-${SLUG}.json`), JSON.stringify(dump, null, 2));
  process.exit(fails.length ? 1 : 0);
}

main();
