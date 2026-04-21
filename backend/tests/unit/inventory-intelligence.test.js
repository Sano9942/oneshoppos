const {
  assignAbcRanks,
  computeVelocity,
  computeGmroi,
  resolveLeadTime,
  suggestReorderQty,
} = require('../../services/inventory-intelligence');

describe('assignAbcRanks', () => {
  it('returns empty array for empty input', () => {
    expect(assignAbcRanks([])).toEqual([]);
  });

  it('assigns A to single product', () => {
    const rows = [{ product_id: 1, revenue: 100 }];
    const ranked = assignAbcRanks(rows);
    expect(ranked[0].rank).toBe('A');
    expect(ranked[0].revenue_contribution_pct).toBe(1);
  });

  it('applies classic 80/15/5 Pareto split', () => {
    // 10 products, top 2 = 80%, next 2 = 15%, last 6 = 5%
    const rows = [
      { product_id: 1, revenue: 400 }, { product_id: 2, revenue: 400 },
      { product_id: 3, revenue: 75 },  { product_id: 4, revenue: 75 },
      { product_id: 5, revenue: 10 },  { product_id: 6, revenue: 10 },
      { product_id: 7, revenue: 10 },  { product_id: 8, revenue: 10 },
      { product_id: 9, revenue: 5 },   { product_id: 10, revenue: 5 },
    ];
    const ranked = assignAbcRanks(rows);
    const byId = Object.fromEntries(ranked.map(r => [r.product_id, r.rank]));
    expect(byId[1]).toBe('A');
    expect(byId[2]).toBe('A');
    expect(byId[3]).toBe('B');
    expect(byId[4]).toBe('B');
    expect(byId[10]).toBe('C');
  });

  it('stable tie-break by product_id', () => {
    const rows = [
      { product_id: 2, revenue: 100 },
      { product_id: 1, revenue: 100 },
    ];
    const ranked = assignAbcRanks(rows);
    // equal revenue → product_id ascending for stability
    expect(ranked[0].product_id).toBe(1);
  });

  it('zero-revenue product gets rank null', () => {
    const rows = [
      { product_id: 1, revenue: 100 },
      { product_id: 2, revenue: 0 },
    ];
    const ranked = assignAbcRanks(rows);
    const byId = Object.fromEntries(ranked.map(r => [r.product_id, r.rank]));
    expect(byId[2]).toBeNull();
  });
});

describe('computeVelocity', () => {
  it('returns 0 for zero sales', () => { expect(computeVelocity(0)).toBe(0); });
  it('returns 10 for 300 units over 30 days', () => { expect(computeVelocity(300)).toBe(10); });
  it('handles fractional quantities', () => { expect(computeVelocity(45)).toBe(1.5); });
});

describe('computeGmroi', () => {
  it('returns null when avgInventoryValue is 0', () => {
    expect(computeGmroi(500, 0.8, 0)).toBeNull();
  });
  it('returns 0 when margin is 0', () => {
    expect(computeGmroi(0, 0.8, 1000)).toBe(0);
  });
  it('computes (margin × sellThrough) / avgInventoryValue', () => {
    expect(computeGmroi(1000, 0.5, 2500)).toBe(0.2);
  });
});

describe('resolveLeadTime', () => {
  it('uses product override when set', () => {
    expect(resolveLeadTime({ lead_time_days_override: 14 }, { default_lead_time_days: 7 }, 5)).toBe(14);
  });
  it('falls back to supplier default', () => {
    expect(resolveLeadTime({ lead_time_days_override: null }, { default_lead_time_days: 7 }, 5)).toBe(7);
  });
  it('falls back to tenant default', () => {
    expect(resolveLeadTime({}, null, 5)).toBe(5);
  });
  it('hardcoded 7 when everything is null', () => {
    expect(resolveLeadTime({}, null, null)).toBe(7);
  });
});

describe('suggestReorderQty', () => {
  it('returns 0 when stock above threshold', () => {
    expect(suggestReorderQty(100, 2, 7, 3)).toBe(0); // threshold = 2×10 = 20
  });
  it('returns rounded-up delta when below threshold', () => {
    // threshold = 5×(7+3) = 50, current=10, delta=40
    expect(suggestReorderQty(10, 5, 7, 3)).toBe(40);
  });
  it('handles fractional velocity', () => {
    // threshold = 1.5×(7+3) = 15, current=10, delta=5
    expect(suggestReorderQty(10, 1.5, 7, 3)).toBe(5);
  });
});
