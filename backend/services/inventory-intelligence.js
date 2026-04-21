// 2-G.8 Inventory Intelligence — pure functions, no DB.
// Used by abc-worker-boss.js (nightly rollup) + routes/inventory-intelligence.js
// (realtime reorder suggestions) so the math is unit-testable in isolation.

function assignAbcRanks(rows) {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return a.product_id - b.product_id;
  });
  const totalRevenue = sorted.reduce((sum, r) => sum + r.revenue, 0);
  if (totalRevenue === 0) {
    return sorted.map((r) => ({
      ...r,
      rank: null,
      revenue_contribution_pct: 0,
    }));
  }
  let cumulative = 0;
  return sorted.map((r, idx) => {
    const pct = r.revenue / totalRevenue;
    if (r.revenue === 0) {
      return { ...r, rank: null, revenue_contribution_pct: 0 };
    }
    cumulative += pct;
    let rank;
    if (cumulative <= 0.8) rank = "A";
    else if (cumulative <= 0.95) rank = "B";
    else rank = "C";
    // Top-product edge case: a single product carrying >80% of revenue still
    // ranks A, even though cumulative crosses the 0.80 threshold in one step.
    if (idx === 0 && pct > 0) rank = "A";
    return { ...r, rank, revenue_contribution_pct: pct };
  });
}

function computeVelocity(unitsSold30d) {
  return unitsSold30d / 30;
}

function computeGmroi(margin, sellThrough, avgInventoryValue) {
  if (avgInventoryValue === 0 || avgInventoryValue == null) return null;
  return (margin * sellThrough) / avgInventoryValue;
}

function resolveLeadTime(product, supplier, tenantDefault) {
  if (product?.lead_time_days_override != null) {
    return product.lead_time_days_override;
  }
  if (supplier?.default_lead_time_days != null) {
    return supplier.default_lead_time_days;
  }
  if (tenantDefault != null) return tenantDefault;
  return 7;
}

function suggestReorderQty(currentStock, velocity, leadTimeDays, safetyStockDays) {
  const threshold = velocity * (leadTimeDays + safetyStockDays);
  if (currentStock >= threshold) return 0;
  return Math.ceil(threshold - currentStock);
}

module.exports = {
  assignAbcRanks,
  computeVelocity,
  computeGmroi,
  resolveLeadTime,
  suggestReorderQty,
};
