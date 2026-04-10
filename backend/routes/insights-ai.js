const rateLimits = new Map(); // key: tenantId or "default", value: { count, resetAt }

function checkRateLimit(key) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + 86400000 }); // 24h window
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count += 1;
  return true;
}

module.exports = function mountInsightAIRoutes(app, deps) {
  const db = deps.db;

  // POST /api/insights/ask — AI-powered question answering
  app.post("/api/insights/ask", async (req, res) => {
    try {
      // 1. Check API key
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(400).json({ error: "AI insights not configured (missing API key)" });
      }

      // 2. Check feature flag
      try {
        const { rows } = await db.query(
          "SELECT enabled FROM feature_flags WHERE key = $1",
          ["ai_insights"]
        );
        if (!rows.length || !rows[0].enabled) {
          return res.status(403).json({ error: "AI insights feature is not enabled" });
        }
      } catch {
        return res.status(403).json({ error: "AI insights feature is not enabled" });
      }

      // 3. Rate limit
      const limitKey = req.tenantId || "default";
      if (!checkRateLimit(limitKey)) {
        return res.status(429).json({ error: "Daily AI query limit reached (20/day). Try again tomorrow." });
      }

      // 4. Validate input
      const { question } = req.body || {};
      if (!question || typeof question !== "string" || question.trim().length === 0) {
        return res.status(400).json({ error: "Question is required" });
      }
      if (question.length > 500) {
        return res.status(400).json({ error: "Question too long (max 500 characters)" });
      }

      // 5. Gather context
      const [salesSummary, topProducts, lowStockCount, avgTxn, storeName] = await Promise.all([
        db.query(
          `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total FROM sales
           WHERE timestamp >= NOW() - INTERVAL '30 days' AND voided = false`
        ).then((r) => r.rows[0]),
        db.query(
          `SELECT p.name, SUM(si.quantity) as qty FROM sale_items si
           JOIN sales s ON si.sale_id = s.id
           JOIN products p ON si.product_id = p.id
           WHERE s.timestamp >= NOW() - INTERVAL '30 days' AND s.voided = false
           GROUP BY p.name ORDER BY qty DESC LIMIT 5`
        ).then((r) => r.rows),
        db.query(
          `SELECT COUNT(*) as count FROM products p
           JOIN outlet_stock os ON p.id = os.product_id
           WHERE os.quantity <= p.min_qty AND p.min_qty > 0 AND p.deleted_at IS NULL`
        ).then((r) => r.rows[0]),
        db.query(
          `SELECT COALESCE(AVG(total_amount), 0) as avg FROM sales
           WHERE timestamp >= NOW() - INTERVAL '30 days' AND voided = false`
        ).then((r) => r.rows[0]),
        db.query("SELECT store_name FROM company_profile LIMIT 1")
          .then((r) => r.rows[0]?.store_name || "the store")
          .catch(() => "the store"),
      ]);

      const contextString = [
        `Store: ${storeName}`,
        `Last 30 days: ${salesSummary.count} sales totaling ${Number(salesSummary.total).toFixed(2)}`,
        `Average transaction: ${Number(avgTxn.avg).toFixed(2)}`,
        `Top products (30d): ${topProducts.map((p) => `${p.name} (${p.qty} sold)`).join(", ") || "No sales data"}`,
        `Low stock items: ${lowStockCount.count} products below reorder level`,
      ].join("\n");

      // 6. Call Claude API
      const Anthropic = require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: `You are a retail analytics assistant for ${storeName}. Answer concisely based on this data:\n${contextString}`,
        messages: [{ role: "user", content: question.trim() }],
      });

      const answer = response.content?.[0]?.text || "Unable to generate a response.";
      res.json({ answer });
    } catch (err) {
      console.error("AI insights error:", err.message);
      res.status(500).json({ error: "Failed to generate AI response" });
    }
  });
};
