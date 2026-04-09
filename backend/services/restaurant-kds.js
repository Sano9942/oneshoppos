/**
 * Kitchen Display System service — tickets, routing, bump.
 */

async function getStations(db, outletId) {
  const { rows } = await db.query(
    `SELECT ks.*,
       (SELECT COUNT(*)::int FROM kds_tickets kt WHERE kt.station_id = ks.id AND kt.status IN ('new','in_progress')) AS active_tickets
     FROM kds_stations ks
     WHERE ks.outlet_id = $1
     ORDER BY ks.name`,
    [outletId]
  );
  return rows;
}

async function createStation(db, data) {
  const { rows: [station] } = await db.query(
    `INSERT INTO kds_stations (outlet_id, name, station_role)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.outlet_id, data.name, data.station_role || "prep"]
  );
  return station;
}

async function updateStation(db, id, data) {
  const sets = [];
  const params = [];
  let idx = 0;
  if (data.name !== undefined) { idx++; sets.push(`name = $${idx}`); params.push(data.name); }
  if (data.station_role !== undefined) { idx++; sets.push(`station_role = $${idx}`); params.push(data.station_role); }
  if (data.is_active !== undefined) { idx++; sets.push(`is_active = $${idx}`); params.push(data.is_active); }
  if (!sets.length) return null;
  idx++; params.push(id);
  sets.push("updated_at = NOW()");
  const { rows: [station] } = await db.query(
    `UPDATE kds_stations SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return station;
}

async function sendToKitchen(db, draftOrderId) {
  // Get items and route to stations
  const { rows: items } = await db.query(
    `SELECT di.*, p.category_id, d.table_id
     FROM draft_order_items di
     JOIN draft_orders d ON d.id = di.draft_order_id
     LEFT JOIN products p ON p.id = di.product_id
     WHERE di.draft_order_id = $1 AND di.kitchen_status = 'pending'`,
    [draftOrderId]
  );
  if (!items.length) return [];

  // Get order context for table label
  const { rows: [order] } = await db.query(
    `SELECT d.*, rt.label AS table_label
     FROM draft_orders d
     LEFT JOIN restaurant_tables rt ON rt.id = d.table_id
     WHERE d.id = $1`,
    [draftOrderId]
  );

  // Get outlet's stations and routing rules
  const { rows: stations } = await db.query(
    "SELECT * FROM kds_stations WHERE outlet_id = $1 AND is_active = true",
    [order.outlet_id]
  );
  const { rows: routes } = await db.query(
    `SELECT sr.* FROM kds_station_routes sr
     JOIN kds_stations ks ON ks.id = sr.station_id
     WHERE ks.outlet_id = $1`,
    [order.outlet_id]
  );

  const tickets = [];
  for (const item of items) {
    // Find matching station by category routing, fallback to match_all
    let targetStation = null;
    for (const route of routes) {
      if (route.category_id === item.category_id) {
        targetStation = stations.find(s => s.id === route.station_id);
        break;
      }
    }
    if (!targetStation) {
      const catchAll = routes.find(r => r.match_all);
      if (catchAll) targetStation = stations.find(s => s.id === catchAll.station_id);
    }
    if (!targetStation && stations.length) targetStation = stations[0];
    if (!targetStation) continue;

    const { rows: [ticket] } = await db.query(
      `INSERT INTO kds_tickets (station_id, draft_order_id, table_label, seat_label, course_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [targetStation.id, draftOrderId, order.table_label || null, item.seat_number ? `S${item.seat_number}` : null, item.course_name || "main"]
    );

    // Log event
    await db.query(
      "INSERT INTO kds_ticket_events (ticket_id, event_type) VALUES ($1, 'created')",
      [ticket.id]
    );

    tickets.push(ticket);
  }

  // Mark items as sent
  await db.query(
    "UPDATE draft_order_items SET kitchen_status = 'sent' WHERE draft_order_id = $1 AND kitchen_status = 'pending'",
    [draftOrderId]
  );

  return tickets;
}

async function getTickets(db, stationId, statusFilter) {
  const params = [stationId];
  let where = "kt.station_id = $1";
  if (statusFilter) {
    params.push(statusFilter);
    where += ` AND kt.status = $${params.length}`;
  } else {
    where += " AND kt.status IN ('new','in_progress','ready')";
  }

  const { rows } = await db.query(
    `SELECT kt.*,
       json_agg(json_build_object(
         'id', di.id, 'product_name', di.product_name, 'quantity', di.quantity,
         'notes', di.notes, 'seat_number', di.seat_number, 'course_name', di.course_name
       )) AS items
     FROM kds_tickets kt
     LEFT JOIN draft_order_items di ON di.draft_order_id = kt.draft_order_id AND di.course_name = kt.course_name
     WHERE ${where}
     GROUP BY kt.id
     ORDER BY kt.priority DESC, kt.created_at ASC`,
    params
  );
  return rows;
}

async function bumpTicket(db, ticketId, actorId) {
  const { rows: [ticket] } = await db.query(
    "UPDATE kds_tickets SET status = 'bumped', updated_at = NOW() WHERE id = $1 RETURNING *",
    [ticketId]
  );
  if (!ticket) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });

  await db.query(
    "INSERT INTO kds_ticket_events (ticket_id, event_type, actor_id) VALUES ($1, 'bumped', $2)",
    [ticketId, actorId]
  );

  // Check if all tickets for this order are bumped → mark expo
  const { rows: remaining } = await db.query(
    "SELECT id FROM kds_tickets WHERE draft_order_id = $1 AND status IN ('new','in_progress')",
    [ticket.draft_order_id]
  );

  // Route to expo station if all prep done
  if (!remaining.length) {
    const { rows: expoStations } = await db.query(
      `SELECT ks.id FROM kds_stations ks
       JOIN kds_tickets kt ON kt.station_id = ks.id
       WHERE kt.draft_order_id = $1 AND ks.station_role = 'expo'
       LIMIT 1`,
      [ticket.draft_order_id]
    );
    // If no expo ticket exists, create one
    if (!expoStations.length) {
      const { rows: [expo] } = await db.query(
        `SELECT id FROM kds_stations WHERE outlet_id = (SELECT outlet_id FROM draft_orders WHERE id = $1) AND station_role = 'expo' AND is_active = true LIMIT 1`,
        [ticket.draft_order_id]
      );
      if (expo) {
        const { rows: [expoTicket] } = await db.query(
          `INSERT INTO kds_tickets (station_id, draft_order_id, table_label, course_name, status)
           VALUES ($1, $2, $3, $4, 'new') RETURNING *`,
          [expo.id, ticket.draft_order_id, ticket.table_label, ticket.course_name]
        );
        await db.query(
          "INSERT INTO kds_ticket_events (ticket_id, event_type) VALUES ($1, 'created')",
          [expoTicket.id]
        );
      }
    }
  }

  return ticket;
}

module.exports = { getStations, createStation, updateStation, sendToKitchen, getTickets, bumpTicket };
