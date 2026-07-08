/**
 * Per-line commission attribution — THE commission calculation engine.
 *
 * 2-G.10 semantics: sale_items are grouped by attributed employee
 * (item.staff_id wins, falling back to the sale's cashier employee_id),
 * each employee's OWN commission plan is applied to their share, and one
 * commission_earnings row is written per (employee, sale).
 *
 * Extracted from routes/commissions.js POST /calculate for F06: the POS
 * checkout auto-calc must attribute a salon color+cut to the stylists on
 * each line, not the cashier who rang it up. Both the manual route and the
 * sales.js post-commit hook call this — never re-implement the math inline.
 */

function findItemRule(rules, item) {
  return rules.find((r) => {
    if (r.scope_type === "all") return true;
    if (r.scope_type === "product" && r.scope_id === item.product_id) return true;
    if (r.scope_type === "category" && r.scope_id === item.category_id) return true;
    if (r.scope_type === "brand" && r.scope_id === item.brand_id) return true;
    return false;
  });
}

// Tier step resolution for type='tiered': the 'all'-scope rule with the
// highest min_threshold ≤ the amount wins. v1 operates per sale — no
// cross-sale period accumulation yet.
function resolveTierForAmount(rules, amount) {
  const eligible = rules
    .filter((r) => r.scope_type === "all")
    .filter((r) => Number(r.min_threshold || 0) <= amount)
    .sort((a, b) => Number(b.min_threshold || 0) - Number(a.min_threshold || 0));
  return eligible[0] || null;
}

async function insertEarning(client, row) {
  const { rows } = await client.query(
    `INSERT INTO commission_earnings (employee_id, sale_id, plan_id, rule_id, sale_amount, commission_amount)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [row.employee_id, row.sale_id, row.plan_id, row.rule_id, row.sale_amount, row.commission_amount],
  );
  return rows[0];
}

/**
 * Calculate + persist commission earnings for one sale.
 * @returns {Promise<{earnings: object[], messages: string[]}>}
 * @throws 404 when the sale is missing or voided
 */
async function calculateCommissionsForSale(db, saleId) {
  return db.transaction(async (client) => {
    const { rows: saleRows } = await client.query(
      "SELECT s.* FROM sales s WHERE s.id = $1 AND s.voided = FALSE",
      [saleId],
    );
    if (!saleRows.length) {
      const err = new Error("Sale not found or voided");
      err.statusCode = 404;
      throw err;
    }
    const sale = saleRows[0];

    // M4 idempotency: a sale can be commission-calc'd twice — once by the POS
    // checkout auto-hook (sales.js) and again by a manager's manual recalc
    // (commissions.js POST /calculate). Both call this engine with a bare
    // INSERT, so without a pre-delete the second run writes a *second* full set
    // of commission_earnings for the same (employee, sale) → payroll double-pay.
    // Clear this sale's still-pending commission rows first so a recalc REPLACES
    // rather than duplicates. Approved/paid rows are left intact (never silently
    // un-pay actioned payroll); tip rows (earning_type='tip', sale_id NULL) never
    // match this predicate.
    await client.query(
      `DELETE FROM commission_earnings
       WHERE sale_id = $1 AND earning_type = 'commission' AND status = 'pending'`,
      [saleId],
    );

    const { rows: items } = await client.query(
      `SELECT si.*, p.category_id, p.brand_id
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1`,
      [saleId],
    );

    const itemsByEmployee = new Map();
    for (const item of items) {
      const empId = item.staff_id != null ? item.staff_id : sale.employee_id;
      if (empId == null) continue;
      if (!itemsByEmployee.has(empId)) itemsByEmployee.set(empId, []);
      itemsByEmployee.get(empId).push(item);
    }

    const earnings = [];
    const messages = [];

    for (const [employeeId, empItems] of itemsByEmployee.entries()) {
      const { rows: empRows } = await client.query(
        "SELECT id, commission_plan_id FROM employees WHERE id = $1",
        [employeeId],
      );
      const emp = empRows[0];
      if (!emp || !emp.commission_plan_id) {
        messages.push(`Employee ${employeeId} has no commission plan`);
        continue;
      }

      const { rows: planRows } = await client.query(
        `SELECT * FROM commission_plans WHERE id = $1 AND is_active = TRUE
         AND (starts_at IS NULL OR starts_at <= $2) AND (ends_at IS NULL OR ends_at >= $2)`,
        [emp.commission_plan_id, sale.timestamp],
      );
      if (!planRows.length) {
        messages.push(`Plan ${emp.commission_plan_id} not active for employee ${employeeId}`);
        continue;
      }
      const plan = planRows[0];

      const { rows: rules } = await client.query(
        "SELECT * FROM commission_plan_rules WHERE plan_id = $1 ORDER BY priority DESC, min_threshold DESC",
        [plan.id],
      );

      const empSaleAmount = empItems.reduce(
        (s, i) => s + Number(i.price_at_sale) * Number(i.quantity),
        0,
      );

      let commission = 0;
      let ruleIdUsed = null;

      if (plan.type === "percentage") {
        for (const item of empItems) {
          const rule = findItemRule(rules, item);
          if (!rule) continue;
          const itemTotal = Number(item.price_at_sale) * Number(item.quantity);
          if (itemTotal < Number(rule.min_threshold || 0)) continue;
          let c = (itemTotal * Number(rule.rate)) / 100;
          if (rule.max_cap && c > Number(rule.max_cap)) c = Number(rule.max_cap);
          commission += c;
          ruleIdUsed = rule.id;
        }
      } else if (plan.type === "tiered") {
        const tier = resolveTierForAmount(rules, empSaleAmount);
        if (tier) {
          let c = (empSaleAmount * Number(tier.rate)) / 100;
          if (tier.max_cap && c > Number(tier.max_cap)) c = Number(tier.max_cap);
          commission = c;
          ruleIdUsed = tier.id;
        }
      } else if (plan.type === "fixed_per_sale") {
        const rule = rules[0];
        if (rule && empSaleAmount >= Number(rule.min_threshold || 0)) {
          commission = Math.min(
            Number(rule.rate),
            rule.max_cap ? Number(rule.max_cap) : Infinity,
          );
          ruleIdUsed = rule.id;
        }
      } else if (plan.type === "fixed_per_item") {
        const rule = rules[0];
        if (rule) {
          const totalQty = empItems.reduce((s, i) => s + Number(i.quantity), 0);
          commission = Math.min(
            totalQty * Number(rule.rate),
            rule.max_cap ? Number(rule.max_cap) : Infinity,
          );
          ruleIdUsed = rule.id;
        }
      }

      if (commission > 0) {
        const row = await insertEarning(client, {
          employee_id: employeeId,
          sale_id: saleId,
          plan_id: plan.id,
          rule_id: ruleIdUsed,
          sale_amount: Math.round(empSaleAmount * 100) / 100,
          commission_amount: Math.round(commission * 100) / 100,
        });
        earnings.push(row);
      }
    }

    return { earnings, messages };
  });
}

module.exports = { calculateCommissionsForSale, findItemRule, resolveTierForAmount };
