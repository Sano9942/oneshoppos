/**
 * Customer-facing display routes — real-time cart/checkout status for secondary screen
 *
 * POST /api/pos/customer-display  — POS pushes current cart state (auth required)
 * GET  /api/pos/customer-display  — display page polls for current state (NO auth)
 *
 * Data is stored in-memory (Map keyed by shift_id), auto-cleaned after 8 hours.
 */

module.exports = function customerDisplayRoutes(app, deps) {
  // In-memory store: Map<shift_id, { items, subtotal, tax, total, status, updatedAt }>
  const displayStore = new Map();

  // Cleanup entries older than 8 hours
  function cleanup() {
    const cutoff = Date.now() - 8 * 60 * 60 * 1000;
    for (const [key, val] of displayStore) {
      if (val.updatedAt < cutoff) displayStore.delete(key);
    }
  }

  // POST /api/pos/customer-display — POS pushes cart state (auth required)
  app.post("/api/pos/customer-display", (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    cleanup();
    const { shift_id, items, subtotal, tax, total, status } = req.body;
    if (!shift_id) return res.status(400).json({ error: "shift_id required" });

    displayStore.set(String(shift_id), {
      items: (items || []).map((i) => ({
        name: i.name,
        qty: i.quantity || i.qty,
        price: i.price,
        total: i.total,
      })),
      subtotal: subtotal || 0,
      tax: tax || 0,
      total: total || 0,
      status: status || "active",
      updatedAt: Date.now(),
    });
    res.json({ ok: true });
  });

  // GET /api/pos/customer-display — display polls (NO auth — public-facing screen)
  app.get("/api/pos/customer-display", (req, res) => {
    const { shift_id } = req.query;
    if (!shift_id) return res.status(400).json({ error: "shift_id required" });

    const data = displayStore.get(String(shift_id));
    if (!data) {
      return res.json({
        items: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        status: "idle",
      });
    }
    res.json({
      items: data.items,
      subtotal: data.subtotal,
      tax: data.tax,
      total: data.total,
      status: data.status,
    });
  });
};
