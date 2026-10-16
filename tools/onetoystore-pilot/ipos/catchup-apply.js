// iPOS stock catch-up, step 2: load catchup-counts.json into ONE new stock count.
// (Step 1 = ipos_catchup.py; see its header and docs/onetoystore-pilot/PROGRESS.md.)
//
// Runs inside a SanoPOS page where the owner is logged in (the AuthProvider fetch
// patch adds the login to every /api/ call). It only CREATES the count and types
// the counted quantities; it never finishes it. The owner then opens Stock Count,
// checks the differences and presses Complete with "Adjust stock" ticked and
// "Full count" OFF, so toys not counted here are left alone.
//
// Use: evaluate `(${source})({ apiBase, outletName, note, counts })` in the page.
// apiBase = "" on localhost (Vite proxy) or "https://api.sanopos.com" on prod.
async ({ apiBase = "", outletName = "Packages Mall", note, counts, concurrency = 6 }) => {
  const call = async (method, path, body) => {
    const res = await fetch(apiBase + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data.error || ""}`);
    return data;
  };
  const key = (s) => String(s ?? "").trim().toUpperCase();

  // Check everything before the count is created: there is no "cancel count".
  if (!note) throw new Error("note is required");
  if (!Array.isArray(counts) || !counts.length) throw new Error("counts must be a non-empty list");
  for (const c of counts) {
    if (!c || !String(c.sku ?? "").trim() || !Number.isInteger(c.counted_qty) || c.counted_qty < 0) {
      throw new Error(`bad count line ${JSON.stringify(c)}`);
    }
  }

  const outlets = await call("GET", "/api/outlets");
  const list = Array.isArray(outlets) ? outlets : outlets.outlets || [];
  const outlet = list.find((o) => o.name === outletName);
  if (!outlet) throw new Error(`no outlet named ${outletName}`);

  const open = await call("GET", "/api/stock-counts?status=in_progress");
  if ((open.stockCounts || []).length) {
    throw new Error(`a stock count is already open (${open.stockCounts.map((c) => c.count_number).join(", ")}); finish or cancel it first`);
  }

  const { stockCount } = await call("POST", "/api/stock-counts", { outlet_id: outlet.id, notes: note });
  const { items } = await call("GET", `/api/stock-counts/${stockCount.id}`);
  const bySku = new Map();
  for (const it of items) if (it.variant_id == null && it.sku) bySku.set(key(it.sku), it);

  const missing = [], alreadyRight = [], failed = [];
  const todo = [];
  for (const c of counts) {
    const it = bySku.get(key(c.sku));
    if (!it) missing.push(c.sku);
    else if (Number(it.system_qty) === Number(c.counted_qty)) alreadyRight.push(c.sku);
    else todo.push({ it, c });
  }

  let done = 0;
  const worker = async () => {
    while (todo.length) {
      const { it, c } = todo.shift();
      try {
        await call("PUT", `/api/stock-counts/${stockCount.id}/items/${it.id}`, { counted_qty: c.counted_qty });
        done += 1;
      } catch (e) {
        failed.push({ sku: c.sku, error: e.message });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  return {
    countId: stockCount.id,
    countNumber: stockCount.count_number,
    linesInCount: items.length,
    entered: done,
    alreadyRight: alreadyRight.length,
    missing,
    failed,
  };
}
