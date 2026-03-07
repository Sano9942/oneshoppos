const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function registerPurchasingReports(app, deps, helpers) {
  const { db } = deps;
  const { buildCategoryMetaMap, withCategoryPaths, getDescendantLeafIds } =
    helpers;

  function applyOutletFilter(where, params, rawId, col = "grn.outlet_id") {
    if (!rawId) return;
    const ids = String(rawId).split(",").map(Number).filter(Boolean);
    if (ids.length === 1) {
      where.push(`${col} = ?`);
      params.push(ids[0]);
    } else if (ids.length > 1) {
      where.push(`${col} IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
  }

  async function applyPurchaseProductFilters(where, params, query, alias = "p") {
    const { category_id, brand_id, supplier_id, search } = query || {};
    if (supplier_id) {
      where.push("po.supplier_id = ?");
      params.push(supplier_id);
    }
    if (category_id) {
      const leafIds = await getDescendantLeafIds(category_id);
      if (!leafIds.length) {
        where.push("1 = 0");
      } else if (leafIds.length === 1) {
        where.push(`${alias}.category_id = ?`);
        params.push(Number(leafIds[0]));
      } else {
        where.push(`${alias}.category_id IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }
    if (brand_id) {
      where.push(`${alias}.brand_id = ?`);
      params.push(brand_id);
    }
    if (search) {
      where.push(
        `(${alias}.name LIKE ? OR COALESCE(${alias}.barcode, '') LIKE ? OR CAST(${alias}.id AS TEXT) LIKE ?)`,
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

  function buildTaxFilter(where, params, taxMode) {
    if (taxMode === "gst") {
      where.push("COALESCE(t.rate, p.gst, 0) > 0");
    }
    if (taxMode === "no_gst") {
      where.push("COALESCE(t.rate, p.gst, 0) <= 0");
    }
  }

  function buildStatusFilter(where, params, statusMode) {
    if (statusMode === "received") {
      where.push("po.status = 'Received'");
      return;
    }
    if (statusMode === "pending") {
      where.push("po.status <> 'Received'");
      return;
    }
    if (statusMode === "not_received") {
      where.push("grn.id IS NULL");
    }
  }

  app.get("/api/reports/total-purchases", async (req, res) => {
    const { date_from, date_to, outlet_id } = req.query;
    const taxMode = String(req.query.tax_mode || "all");
    const statusMode = String(req.query.status_mode || "all");
    const tz = req.company?.timezone || "UTC";
    const where = [];
    const params = [];

    if (date_from) {
      where.push("po.created_at >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("po.created_at < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    applyOutletFilter(where, params, outlet_id, "COALESCE(grn.outlet_id, 0)");

    buildStatusFilter(where, params, statusMode);
    await applyPurchaseProductFilters(where, params, req.query);
    buildTaxFilter(where, params, taxMode);

    const sql = `
      SELECT
        po.id,
        po.created_at,
        po.due_date,
        po.status,
        s.name AS supplier_name,
        COALESCE(o.name, 'Unreceived / Not Assigned') AS outlet_name,
        COUNT(DISTINCT poi.id) AS line_count,
        COALESCE(SUM(poi.quantity), 0) AS qty_ordered,
        COALESCE(SUM(gi.qty_received), 0) AS qty_received,
        ROUND(COALESCE(SUM(poi.quantity * poi.cost_price), 0), 2) AS ordered_cost,
        ROUND(COALESCE(SUM(gi.qty_received * gi.cost_price), 0), 2) AS received_cost,
        ROUND(COALESCE(SUM((poi.quantity * poi.cost_price) * (COALESCE(t.rate, p.gst, 0) / 100.0)), 0), 2) AS ordered_tax,
        ROUND(COALESCE(SUM((gi.qty_received * gi.cost_price) * (COALESCE(t.rate, p.gst, 0) / 100.0)), 0), 2) AS received_tax,
        COALESCE(inv.amount, 0) AS invoice_amount,
        COALESCE(inv.status, 'not_invoiced') AS invoice_status,
        ROUND(COALESCE(SUM(poi.quantity * poi.cost_price), 0) - COALESCE(SUM(gi.qty_received * gi.cost_price), 0), 2) AS pending_cost
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN goods_received_notes grn ON grn.po_id = po.id
      LEFT JOIN outlets o ON o.id = grn.outlet_id
      LEFT JOIN supplier_invoices inv ON inv.po_id = po.id
      JOIN purchase_order_items poi ON poi.po_id = po.id
      JOIN products p ON p.id = poi.product_id
      LEFT JOIN taxes t ON t.id = p.tax_id
      LEFT JOIN grn_items gi ON gi.grn_id = grn.id AND gi.product_id = poi.product_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY po.id
      ORDER BY po.created_at DESC, po.id DESC
    `;

    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const summary = (rows || []).reduce(
        (acc, row) => {
          acc.order_count += 1;
          acc.received_count += row.status === "Received" ? 1 : 0;
          acc.pending_count += row.status === "Received" ? 0 : 1;
          acc.not_received_count += Number(row.qty_received || 0) <= 0 ? 1 : 0;
          acc.ordered_cost += Number(row.ordered_cost || 0);
          acc.received_cost += Number(row.received_cost || 0);
          acc.pending_cost += Number(row.pending_cost || 0);
          acc.ordered_tax += Number(row.ordered_tax || 0);
          acc.received_tax += Number(row.received_tax || 0);
          return acc;
        },
        {
          order_count: 0,
          received_count: 0,
          pending_count: 0,
          not_received_count: 0,
          ordered_cost: 0,
          received_cost: 0,
          pending_cost: 0,
          ordered_tax: 0,
          received_tax: 0,
        },
      );
      res.json({ items: rows || [], summary, status_mode: statusMode, tax_mode: taxMode });
    });
  });

  app.get("/api/reports/itemwise-purchases", async (req, res) => {
    const { date_from, date_to, outlet_id } = req.query;
    const taxMode = String(req.query.tax_mode || "all");
    const statusMode = String(req.query.status_mode || "all");
    const tz = req.company?.timezone || "UTC";
    const where = [];
    const params = [];

    if (date_from) {
      where.push("po.created_at >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("po.created_at < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    applyOutletFilter(where, params, outlet_id, "COALESCE(grn.outlet_id, 0)");

    buildStatusFilter(where, params, statusMode);
    await applyPurchaseProductFilters(where, params, req.query);
    buildTaxFilter(where, params, taxMode);

    const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        p.category_id,
        COALESCE(cat.name, '-') AS category,
        COALESCE(b.name, '-') AS brand,
        COALESCE(s.name, '-') AS supplier_name,
        COALESCE(t.name, CASE WHEN COALESCE(p.gst, 0) > 0 THEN 'GST' ELSE 'No Tax' END) AS tax_name,
        COALESCE(t.rate, p.gst, 0) AS tax_rate,
        COUNT(DISTINCT po.id) AS po_count,
        COALESCE(SUM(poi.quantity), 0) AS qty_ordered,
        COALESCE(SUM(gi.qty_received), 0) AS qty_received,
        ROUND(COALESCE(AVG(poi.cost_price), 0), 2) AS avg_cost_price,
        ROUND(COALESCE(SUM(poi.quantity * poi.cost_price), 0), 2) AS ordered_cost,
        ROUND(COALESCE(SUM(gi.qty_received * gi.cost_price), 0), 2) AS received_cost,
        ROUND(COALESCE(SUM((poi.quantity * poi.cost_price) * (COALESCE(t.rate, p.gst, 0) / 100.0)), 0), 2) AS ordered_tax,
        ROUND(COALESCE(SUM((gi.qty_received * gi.cost_price) * (COALESCE(t.rate, p.gst, 0) / 100.0)), 0), 2) AS received_tax,
        MAX(po.created_at) AS last_po_at
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.po_id
      JOIN products p ON p.id = poi.product_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN taxes t ON t.id = p.tax_id
      LEFT JOIN goods_received_notes grn ON grn.po_id = po.id
      LEFT JOIN grn_items gi ON gi.grn_id = grn.id AND gi.product_id = poi.product_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY p.id, s.id
      ORDER BY received_cost DESC, ordered_cost DESC, p.name ASC
    `;

    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows || [], categoryMeta);
      const summary = items.reduce(
        (acc, row) => {
          acc.item_count += 1;
          acc.qty_ordered += Number(row.qty_ordered || 0);
          acc.qty_received += Number(row.qty_received || 0);
          acc.ordered_cost += Number(row.ordered_cost || 0);
          acc.received_cost += Number(row.received_cost || 0);
          return acc;
        },
        {
          item_count: 0,
          qty_ordered: 0,
          qty_received: 0,
          ordered_cost: 0,
          received_cost: 0,
        },
      );
      res.json({ items, summary, status_mode: statusMode, tax_mode: taxMode });
    });
  });

  app.get("/api/reports/po-workflow", (req, res) => {
    const { date_from, date_to, supplier_id } = req.query;
    const tz = req.company?.timezone || "UTC";
    const where = [];
    const params = [];

    if (date_from) {
      where.push("po.created_at >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("po.created_at < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    if (supplier_id) {
      where.push("po.supplier_id = ?");
      params.push(supplier_id);
    }

    const sql = `
      WITH approval_state AS (
        SELECT
          ar.reference_id AS po_id,
          ar.status AS approval_status,
          ar.created_at AS approval_requested_at
        FROM approval_requests ar
        WHERE ar.reference_type = 'purchase_order'
          AND ar.id IN (
            SELECT MAX(ar2.id)
            FROM approval_requests ar2
            WHERE ar2.reference_type = 'purchase_order'
            GROUP BY ar2.reference_id
          )
      ),
      payment_state AS (
        SELECT
          si.id AS invoice_id,
          si.po_id,
          si.amount,
          si.status,
          si.due_date,
          COALESCE(SUM(sp.amount), 0) AS amount_paid
        FROM supplier_invoices si
        LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
        GROUP BY si.id
      )
      SELECT
        po.id,
        po.created_at,
        po.due_date,
        po.status AS po_status,
        s.name AS supplier_name,
        COALESCE(ap.approval_status, CASE WHEN po.status = 'Approved' THEN 'approved' WHEN po.status = 'pending_approval' THEN 'pending_approval' ELSE 'not_submitted' END) AS approval_status,
        ap.approval_requested_at,
        grn.id AS grn_id,
        grn.grn_number,
        grn.received_at,
        COALESCE(o.name, 'Unreceived / Not Assigned') AS outlet_name,
        pay.invoice_id,
        COALESCE(pay.status, 'not_invoiced') AS invoice_status,
        COALESCE(pay.amount, 0) AS invoice_amount,
        COALESCE(pay.amount_paid, 0) AS amount_paid,
        ROUND(COALESCE(pay.amount, 0) - COALESCE(pay.amount_paid, 0), 2) AS amount_due,
        CASE
          WHEN po.status = 'Draft' THEN 'Draft'
          WHEN po.status = 'pending_approval' THEN 'Pending Approval'
          WHEN po.status = 'Approved' AND grn.id IS NULL THEN 'Approved Waiting Receipt'
          WHEN po.status = 'Received' AND grn.id IS NULL THEN 'Received Without GRN'
          WHEN po.status = 'Received' AND pay.invoice_id IS NULL THEN 'Received Not Invoiced'
          WHEN po.status = 'Received' AND COALESCE(pay.status, 'unpaid') IN ('unpaid', 'partial') THEN 'Received Unpaid'
          ELSE 'Complete'
        END AS workflow_stage
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN approval_state ap ON ap.po_id = po.id
      LEFT JOIN goods_received_notes grn ON grn.po_id = po.id
      LEFT JOIN outlets o ON o.id = grn.outlet_id
      LEFT JOIN payment_state pay ON pay.po_id = po.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY po.created_at DESC, po.id DESC
    `;

    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const today = new Date().toISOString().slice(0, 10);
      const summary = (rows || []).reduce(
        (acc, row) => {
          acc.po_count += 1;
          if (row.workflow_stage === "Draft") acc.draft_count += 1;
          if (row.workflow_stage === "Pending Approval")
            acc.pending_approval_count += 1;
          if (row.workflow_stage === "Approved Waiting Receipt")
            acc.approved_waiting_receipt_count += 1;
          if (row.workflow_stage === "Received Without GRN")
            acc.received_without_grn_count += 1;
          if (row.invoice_status === "unpaid" || row.invoice_status === "partial")
            acc.unpaid_invoice_count += 1;
          if (
            row.due_date &&
            row.due_date < today &&
            (row.invoice_status === "unpaid" || row.invoice_status === "partial")
          ) {
            acc.overdue_invoice_count += 1;
          }
          acc.invoice_due += Number(row.amount_due || 0);
          return acc;
        },
        {
          po_count: 0,
          draft_count: 0,
          pending_approval_count: 0,
          approved_waiting_receipt_count: 0,
          received_without_grn_count: 0,
          unpaid_invoice_count: 0,
          overdue_invoice_count: 0,
          invoice_due: 0,
        },
      );
      res.json({ items: rows || [], summary });
    });
  });

  app.get("/api/reports/procurement-parity", (req, res) => {
    const { date_from, date_to, outlet_id } = req.query;
    const tz = req.company?.timezone || "UTC";
    const receiptWhere = [];
    const receiptParams = [];
    const transferWhere = [];
    const transferParams = [];
    const adjustmentWhere = [];
    const adjustmentParams = [];

    if (date_from) {
      receiptWhere.push("date(grn.received_at) >= ?");
      receiptParams.push(date_from);
      transferWhere.push("it.timestamp >= ?");
      transferParams.push(toUtcStart(date_from, tz));
      adjustmentWhere.push("sa.timestamp >= ?");
      adjustmentParams.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      receiptWhere.push("date(grn.received_at) <= ?");
      receiptParams.push(date_to);
      transferWhere.push("it.timestamp < ?");
      transferParams.push(toUtcEnd(date_to, tz));
      adjustmentWhere.push("sa.timestamp < ?");
      adjustmentParams.push(toUtcEnd(date_to, tz));
    }
    if (outlet_id) {
      const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
      if (ids.length === 1) {
        receiptWhere.push("grn.outlet_id = ?");
        receiptParams.push(ids[0]);
        transferWhere.push("(it.from_outlet_id = ? OR it.to_outlet_id = ?)");
        transferParams.push(ids[0], ids[0]);
        adjustmentWhere.push("sa.outlet_id = ?");
        adjustmentParams.push(ids[0]);
      } else if (ids.length > 1) {
        const ph = ids.map(() => "?").join(",");
        receiptWhere.push(`grn.outlet_id IN (${ph})`);
        receiptParams.push(...ids);
        transferWhere.push(`(it.from_outlet_id IN (${ph}) OR it.to_outlet_id IN (${ph}))`);
        transferParams.push(...ids, ...ids);
        adjustmentWhere.push(`sa.outlet_id IN (${ph})`);
        adjustmentParams.push(...ids);
      }
    }

    const receiptSql = `
      SELECT
        'receipt' AS event_type,
        grn.received_at AS event_at,
        p.name AS product_name,
        p.barcode,
        s.name AS supplier_name,
        o.name AS outlet_name,
        gi.qty_received AS quantity,
        gi.cost_price,
        ROUND(gi.qty_received * gi.cost_price, 2) AS estimated_cost,
        grn.grn_number AS reference,
        NULL AS counterparty
      FROM goods_received_notes grn
      JOIN purchase_orders po ON po.id = grn.po_id
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN outlets o ON o.id = grn.outlet_id
      JOIN grn_items gi ON gi.grn_id = grn.id
      JOIN products p ON p.id = gi.product_id
      ${receiptWhere.length ? "WHERE " + receiptWhere.join(" AND ") : ""}
    `;

    const transferSql = `
      SELECT
        'transfer' AS event_type,
        it.timestamp AS event_at,
        COALESCE(p.name, 'Unknown Product') AS product_name,
        COALESCE(p.barcode, '-') AS barcode,
        NULL AS supplier_name,
        COALESCE(fo.name, 'Unknown Outlet') AS outlet_name,
        it.quantity AS quantity,
        COALESCE(p.cost_price, 0) AS cost_price,
        ROUND(it.quantity * COALESCE(p.cost_price, 0), 2) AS estimated_cost,
        ('TR-' || it.id) AS reference,
        COALESCE(to_o.name, 'Unknown Outlet') AS counterparty
      FROM inventory_transfers it
      LEFT JOIN products p ON p.id = it.product_id
      LEFT JOIN outlets fo ON fo.id = it.from_outlet_id
      LEFT JOIN outlets to_o ON to_o.id = it.to_outlet_id
      ${transferWhere.length ? "WHERE " + transferWhere.join(" AND ") : ""}
    `;

    const adjustmentSql = `
      SELECT
        'adjustment' AS event_type,
        sa.timestamp AS event_at,
        COALESCE(p.name, 'Unknown Product') AS product_name,
        COALESCE(p.barcode, '-') AS barcode,
        NULL AS supplier_name,
        COALESCE(o.name, 'Unknown Outlet') AS outlet_name,
        sa.quantity_change AS quantity,
        COALESCE(p.cost_price, 0) AS cost_price,
        ROUND(ABS(sa.quantity_change) * COALESCE(p.cost_price, 0), 2) AS estimated_cost,
        ('ADJ-' || sa.id) AS reference,
        sa.reason AS counterparty
      FROM stock_adjustments sa
      LEFT JOIN products p ON p.id = sa.product_id
      LEFT JOIN outlets o ON o.id = sa.outlet_id
      ${adjustmentWhere.length ? "WHERE " + adjustmentWhere.join(" AND ") : ""}
    `;

    db.all(
      `
      ${receiptSql}
      UNION ALL
      ${transferSql}
      UNION ALL
      ${adjustmentSql}
      ORDER BY event_at DESC
      LIMIT 1000
      `,
      [...receiptParams, ...transferParams, ...adjustmentParams],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const summary = (rows || []).reduce(
          (acc, row) => {
            if (row.event_type === "receipt") acc.receipt_count += 1;
            if (row.event_type === "transfer") acc.transfer_count += 1;
            if (row.event_type === "adjustment") acc.adjustment_count += 1;
            acc.total_estimated_cost += Number(row.estimated_cost || 0);
            return acc;
          },
          {
            receipt_count: 0,
            transfer_count: 0,
            adjustment_count: 0,
            total_estimated_cost: 0,
          },
        );
        res.json({ items: rows || [], summary });
      },
    );
  });
};
