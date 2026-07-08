const { getAdapter } = require("../services/couriers");
const { encryptSecret, decryptSecret } = require("../services/crypto");
const logger = require("../services/logger").child({ component: "couriers" });

// courier_integrations.config_json is a TEXT column holding a JSON string.
// Adapters read nested fields (`this.config.config_json?.cost_center`, PostEx
// address codes, DHL/FedEx account_number). If we hand them the raw string
// those reads are `undefined`, so parse it to an object on the way in.
function parseCourierConfigJson(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

// Build the config object passed to a courier adapter: decrypt the credentials
// (they are stored AES-256-GCM encrypted; decryptSecret passes plaintext
// through untouched for legacy rows / when no key is configured) and parse the
// jsonb config so nested adapter fields resolve instead of reading undefined.
function buildCourierAdapterConfig(row) {
  return {
    api_key: decryptSecret(row.api_key),
    api_secret: decryptSecret(row.api_secret),
    api_base_url: row.api_base_url,
    config_json: parseCourierConfigJson(row.config_json),
  };
}

/**
 * Send an order-status SMS to the customer if they have sms_consent.
 * Non-blocking — failures are logged, never thrown.
 */
async function notifyCustomerSms(db, orderId, messageTemplate) {
  try {
    // Billing gate: tenants without the phase5_sms_providers add-on must
    // not trigger outbound SMS even when sms_consent is true on the
    // customer, because the carrier charge happens regardless of consent.
    const { rows: [flag] } = await db.query(
      "SELECT enabled FROM feature_flags WHERE key = 'phase5_sms_providers'"
    );
    if (!flag || flag.enabled !== true) return;

    const { rows: [order] } = await db.query(
      `SELECT wo.id, wo.tracking_number, wo.external_order_number,
              c.mobile, c.sms_consent, c.name AS customer_name
       FROM web_orders wo
       LEFT JOIN customers c ON wo.customer_id = c.id
       WHERE wo.id = $1`,
      [orderId]
    );
    if (!order?.mobile || !order.sms_consent) return;

    const sms = require("../services/sms");
    const body = messageTemplate
      .replace("{name}", order.customer_name || "Customer")
      .replace("{order}", order.external_order_number || `#${order.id}`)
      .replace("{tracking}", order.tracking_number || "N/A");

    await sms.sendSms(db, { to: order.mobile, body, type: "transactional" });
  } catch (err) {
    logger.warn({ err: err.message, orderId }, "Order SMS notification failed (non-fatal)");
  }
}

function mountCourierRoutes(app, deps) {
  const db = deps.db;
  const { requirePerm, requireFeature } = deps;

  // GET /api/couriers — list couriers with capability flags
  app.get("/api/couriers", async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, name, adapter_key, tracking_url_template, enabled, api_base_url,
                supports_booking, supports_tracking, supports_cancellation, supports_labels,
                provider_category, flat_shipping_rate, config_json,
                last_healthcheck_at, last_healthcheck_status
         FROM courier_integrations ORDER BY name`
      );
      res.json({
        couriers: rows.map((c) => ({
          ...c,
          flat_shipping_rate: c.flat_shipping_rate ? Number(c.flat_shipping_rate) : null,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/couriers/:id/csv-mapping — save COD CSV column mapping
  app.patch(
    "/api/couriers/:id/csv-mapping",
    requirePerm("manage_orders"),
    async (req, res) => {
      try {
        const { mapping } = req.body || {};
        if (!mapping || typeof mapping !== "object") {
          return res.status(400).json({ error: "mapping object required" });
        }
        if (!mapping.courier_tracking_number || !mapping.remitted_amount) {
          return res.status(400).json({
            error: "courier_tracking_number and remitted_amount are required in mapping",
          });
        }

        // courier_integrations.config_json is TEXT (JSON string). Cast to jsonb
        // to merge, then cast the merged object back to text for storage so we
        // preserve any existing keys the courier adapters rely on.
        await db.query(
          `UPDATE courier_integrations SET
             config_json = (
               COALESCE(NULLIF(config_json, '')::jsonb, '{}'::jsonb)
               || jsonb_build_object('cod_csv_mapping', $1::jsonb)
             )::text
           WHERE id = $2`,
          [JSON.stringify(mapping), req.params.id]
        );

        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // PUT /api/couriers/:id — admin configures courier
  app.put("/api/couriers/:id", requirePerm("all_access"), async (req, res) => {
    try {
      const { id } = req.params;
      const { enabled, api_key, api_secret, api_base_url, flat_shipping_rate } = req.body || {};
      // Encrypt credentials at rest (AES-256-GCM, enc:v1 format — same path
      // Shopify/marketplace use). encryptSecret returns null for null input so
      // COALESCE keeps the existing value when a field is omitted, and is a
      // no-op for a value already carrying the enc:v1 prefix.
      await db.query(
        `UPDATE courier_integrations SET
          enabled = COALESCE($1, enabled),
          api_key = COALESCE($2, api_key),
          api_secret = COALESCE($3, api_secret),
          api_base_url = COALESCE($4, api_base_url),
          flat_shipping_rate = COALESCE($5, flat_shipping_rate)
         WHERE id = $6`,
        [enabled, encryptSecret(api_key), encryptSecret(api_secret), api_base_url, flat_shipping_rate, id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/couriers — admin adds custom courier
  app.post("/api/couriers", requirePerm("all_access"), async (req, res) => {
    try {
      const { name, tracking_url_template } = req.body || {};
      if (!name) return res.status(400).json({ error: "Name required" });
      const { rows: [courier] } = await db.query(
        `INSERT INTO courier_integrations (name, adapter_key, tracking_url_template, enabled)
         VALUES ($1, 'generic', $2, true) RETURNING *`,
        [name, tracking_url_template || ""]
      );
      res.json({ courier });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/couriers/:id/test-booking — test courier connectivity
  app.post(
    "/api/couriers/:id/test-booking",
    requirePerm("all_access"),
    requireFeature("phase5_shipping_automation"),
    async (req, res) => {
      try {
        const { rows: [courier] } = await db.query(
          "SELECT * FROM courier_integrations WHERE id = $1",
          [req.params.id]
        );
        if (!courier) return res.status(404).json({ error: "Courier not found" });

        if (!courier.supports_booking) {
          return res.json({
            success: false,
            message: `${courier.name} does not support automated booking. Use manual tracking entry.`,
          });
        }

        const adapter = getAdapter(courier.adapter_key, buildCourierAdapterConfig(courier));

        // Attempt a test booking with dummy data
        try {
          const result = await adapter.bookShipment(
            { id: 0, grand_total: 100 },
            { name: "Test Sender", phone: "03001234567", address: "Test Address", city: "Karachi" },
            { name: "Test Receiver", phone: "03009876543", address: "Test Address", city: "Lahore" },
            { weight: 0.5, cod_amount: 0, is_test: true }
          );
          // Update healthcheck
          await db.query(
            `UPDATE courier_integrations SET last_healthcheck_at = NOW(), last_healthcheck_status = 'ok' WHERE id = $1`,
            [courier.id]
          );
          res.json({ success: true, message: `${courier.name} connectivity verified`, result });
        } catch (adapterErr) {
          await db.query(
            `UPDATE courier_integrations SET last_healthcheck_at = NOW(), last_healthcheck_status = $1 WHERE id = $2`,
            [adapterErr.message?.slice(0, 200) || "error", courier.id]
          );
          res.json({ success: false, message: adapterErr.message });
        }
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/orders/:id/ship — manual ship (legacy, kept for compatibility)
  app.post("/api/orders/:id/ship", requirePerm("manage_orders"), async (req, res) => {
    try {
      const { id } = req.params;
      const { courier_id, tracking_number } = req.body || {};
      if (!courier_id || !tracking_number) {
        return res.status(400).json({ error: "courier_id and tracking_number required" });
      }

      const { rows: [order] } = await db.query(
        "SELECT id, order_status FROM web_orders WHERE id = $1", [id]
      );
      if (!order) return res.status(404).json({ error: "Order not found" });

      await db.query(
        `UPDATE web_orders SET courier_id = $1, tracking_number = $2, shipped_at = NOW(),
           fulfillment_status = 'shipped'
         WHERE id = $3`,
        [courier_id, tracking_number, id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/orders/:id/shipments/book — book shipment via courier adapter
  app.post(
    "/api/orders/:id/shipments/book",
    requirePerm("manage_orders"),
    requireFeature("phase5_shipping_automation"),
    async (req, res) => {
      try {
        const orderId = req.params.id;
        const { courier_id } = req.body || {};
        if (!courier_id) return res.status(400).json({ error: "courier_id required" });

        const result = await db.transaction(async (client) => {
          // Load order
          // FOR UPDATE OF wo — scope the row lock to web_orders only.
          // Unqualified FOR UPDATE on a LEFT JOIN raises
          // "FOR UPDATE cannot be applied to the nullable side of an outer join"
          // the moment someone books a shipment for a walk-in order
          // (customer_id IS NULL). Pre-existing bug unrelated to Phase 5 H1
          // but discovered while writing H1 regression tests — fixed as a
          // drive-by, same pattern as Pattern A lastPollAt / M1 payment_intents.
          const { rows: [order] } = await client.query(
            `SELECT wo.*, c.name AS customer_name, c.mobile AS customer_phone, c.email AS customer_email
             FROM web_orders wo
             LEFT JOIN customers c ON wo.customer_id = c.id
             WHERE wo.id = $1 FOR UPDATE OF wo`,
            [orderId]
          );
          if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });

          // Load courier
          const { rows: [courier] } = await client.query(
            "SELECT * FROM courier_integrations WHERE id = $1",
            [courier_id]
          );
          if (!courier) throw Object.assign(new Error("Courier not found"), { statusCode: 404 });

          // Parse shipping address
          const addr = order.shipping_address_json
            ? (typeof order.shipping_address_json === "string" ? JSON.parse(order.shipping_address_json) : order.shipping_address_json)
            : {};

          const receiver = {
            name: order.customer_name || addr.name || "Customer",
            phone: order.customer_phone || addr.phone || "",
            email: order.customer_email || "",
            address: [addr.address_line_1, addr.address_line_2].filter(Boolean).join(", ") || addr.address || "",
            city: addr.city || "",
          };

          // Load company for sender info.
          // `company_profile.name` doesn't exist — the canonical column is
          // `company_name`. Pre-existing dead code path discovered via
          // Phase 5 H1 regression tests. Drive-by fix alongside the
          // FOR UPDATE scoping above.
          const { rows: companyRows } = await client.query(
            "SELECT company_name, phone, address FROM company_profile LIMIT 1"
          );
          const company = companyRows[0] || {};
          const sender = {
            name: company.company_name || "Store",
            phone: company.phone || "",
            address: company.address || "",
            city: "",
          };

          // Determine COD
          const isCod = order.payment_status === "cod" || order.payment_status === "pending";
          const codAmount = isCod ? Number(order.grand_total) : 0;

          if (courier.supports_booking) {
            // Use adapter to book
            const adapter = getAdapter(courier.adapter_key, buildCourierAdapterConfig(courier));

            const bookingResult = await adapter.bookShipment(order, sender, receiver, {
              weight: req.body.weight || 0.5,
              cod_amount: codAmount,
            });

            // Persist to order_shipments
            const { rows: [shipment] } = await client.query(
              `INSERT INTO order_shipments
                (web_order_id, courier_id, tracking_number, label_url, booking_ref,
                 booking_response, status, shipping_cost, booked_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'booked', $7, NOW())
               RETURNING *`,
              [
                orderId, courier_id,
                bookingResult.tracking_number || null,
                bookingResult.label_url || null,
                bookingResult.booking_ref || bookingResult.tracking_number || null,
                JSON.stringify(bookingResult),
                courier.flat_shipping_rate ? Number(courier.flat_shipping_rate) : null,
              ]
            );

            // Update web_orders
            await client.query(
              `UPDATE web_orders SET
                 courier_id = $1,
                 tracking_number = $2,
                 active_shipment_id = $3,
                 shipping_provider_status = 'booked',
                 fulfillment_status = 'shipped',
                 shipped_at = NOW(),
                 updated_at = NOW()
               WHERE id = $4`,
              [courier_id, bookingResult.tracking_number || null, shipment.id, orderId]
            );

            return { shipment, booking: bookingResult, _orderId: orderId };
          } else {
            // Manual fallback — create draft shipment for manual tracking entry
            const trackingNumber = req.body.tracking_number || null;
            const { rows: [shipment] } = await client.query(
              `INSERT INTO order_shipments
                (web_order_id, courier_id, tracking_number, status, shipping_cost)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *`,
              [
                orderId, courier_id, trackingNumber,
                trackingNumber ? "booked" : "draft",
                courier.flat_shipping_rate ? Number(courier.flat_shipping_rate) : null,
              ]
            );

            if (trackingNumber) {
              await client.query(
                `UPDATE web_orders SET
                   courier_id = $1, tracking_number = $2, active_shipment_id = $3,
                   shipping_provider_status = 'manual',
                   fulfillment_status = 'shipped', shipped_at = NOW(), updated_at = NOW()
                 WHERE id = $4`,
                [courier_id, trackingNumber, shipment.id, orderId]
              );
            } else {
              await client.query(
                `UPDATE web_orders SET
                   courier_id = $1, active_shipment_id = $2,
                   shipping_provider_status = 'pending_tracking',
                   updated_at = NOW()
                 WHERE id = $3`,
                [courier_id, shipment.id, orderId]
              );
            }

            return { shipment, manual: true };
          }
        });

        // Fire-and-forget SMS notification for shipped orders
        if (result.shipment?.status === "booked" || result.shipment?.tracking_number) {
          notifyCustomerSms(
            db, orderId,
            "Hi {name}, your order {order} has been shipped! Tracking: {tracking}"
          );
        }

        res.json(result);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  // POST /api/orders/:id/shipments/:shipmentId/cancel — attempt cancellation
  app.post(
    "/api/orders/:id/shipments/:shipmentId/cancel",
    requirePerm("manage_orders"),
    requireFeature("phase5_shipping_automation"),
    async (req, res) => {
      try {
        const { id: orderId, shipmentId } = req.params;

        const { rows: [shipment] } = await db.query(
          `SELECT os.*, ci.adapter_key, ci.api_key, ci.api_secret, ci.api_base_url,
                  ci.config_json, ci.supports_cancellation
           FROM order_shipments os
           JOIN courier_integrations ci ON os.courier_id = ci.id
           WHERE os.id = $1 AND os.web_order_id = $2`,
          [shipmentId, orderId]
        );
        if (!shipment) return res.status(404).json({ error: "Shipment not found" });
        if (shipment.status === "cancelled") return res.json({ ok: true, message: "Already cancelled" });

        let cancelResult = { success: false, message: "Courier does not support API cancellation" };

        if (shipment.supports_cancellation && shipment.tracking_number) {
          const adapter = getAdapter(shipment.adapter_key, buildCourierAdapterConfig(shipment));
          try {
            cancelResult = await adapter.cancelShipment(shipment.tracking_number);
          } catch (err) {
            cancelResult = { success: false, message: err.message };
          }
        }

        // Mark cancelled regardless (user initiated)
        await db.query(
          `UPDATE order_shipments SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
          [shipmentId]
        );
        await db.query(
          `UPDATE web_orders SET shipping_provider_status = 'cancelled', updated_at = NOW() WHERE id = $1 AND active_shipment_id = $2`,
          [orderId, shipmentId]
        );

        res.json({ ok: true, cancel_result: cancelResult });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/orders/:id/tracking/refresh — pull latest tracking from courier
  app.post(
    "/api/orders/:id/tracking/refresh",
    requirePerm("manage_orders"),
    requireFeature("phase5_shipping_automation"),
    async (req, res) => {
      try {
        const { rows: [shipment] } = await db.query(
          `SELECT os.*, ci.adapter_key, ci.api_key, ci.api_secret, ci.api_base_url,
                  ci.config_json, ci.supports_tracking
           FROM order_shipments os
           JOIN courier_integrations ci ON os.courier_id = ci.id
           WHERE os.web_order_id = $1 AND os.status NOT IN ('cancelled','failed')
           ORDER BY os.id DESC LIMIT 1`,
          [req.params.id]
        );
        if (!shipment) return res.status(404).json({ error: "No active shipment found" });
        if (!shipment.tracking_number) return res.status(400).json({ error: "No tracking number on shipment" });

        if (!shipment.supports_tracking) {
          return res.json({ message: "Courier does not support tracking API", events: [] });
        }

        const adapter = getAdapter(shipment.adapter_key, buildCourierAdapterConfig(shipment));

        const trackingResult = await adapter.getTracking(shipment.tracking_number);

        // Persist events
        const events = trackingResult.events || [];
        for (const evt of events) {
          await db.query(
            `INSERT INTO shipment_tracking_events
              (shipment_id, event_status, event_description, event_location, event_timestamp, raw_payload)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              shipment.id,
              evt.status || evt.event_status || null,
              evt.description || evt.event_description || null,
              evt.location || evt.event_location || null,
              evt.timestamp || evt.event_timestamp || null,
              JSON.stringify(evt),
            ]
          );
        }

        // Update shipment tracking metadata
        const newStatus = trackingResult.status === "delivered" ? "delivered"
          : trackingResult.status === "in_transit" ? "in_transit"
          : shipment.status;

        await db.query(
          `UPDATE order_shipments SET
             last_tracking_refresh_at = NOW(),
             last_tracking_payload = $1,
             status = $2,
             delivered_at = CASE WHEN $2 = 'delivered' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END
           WHERE id = $3`,
          [JSON.stringify(trackingResult), newStatus, shipment.id]
        );

        // Update order status if delivered
        if (newStatus === "delivered") {
          await db.query(
            `UPDATE web_orders SET fulfillment_status = 'delivered', delivered_at = NOW(), shipping_provider_status = 'delivered', updated_at = NOW() WHERE id = $1`,
            [req.params.id]
          );
          // Fire-and-forget delivery SMS
          notifyCustomerSms(
            db, Number(req.params.id),
            "Hi {name}, your order {order} has been delivered! Thank you for shopping with us."
          );
        }

        res.json({ status: newStatus, events, raw: trackingResult });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // GET /api/orders/:id/tracking — get persisted tracking info + events
  app.get("/api/orders/:id/tracking", async (req, res) => {
    try {
      const { rows: [order] } = await db.query(
        `SELECT wo.tracking_number, wo.shipped_at, wo.delivered_at, wo.fulfillment_status,
                wo.active_shipment_id, wo.shipping_provider_status,
                ci.name as courier_name, ci.tracking_url_template
         FROM web_orders wo
         LEFT JOIN courier_integrations ci ON wo.courier_id = ci.id
         WHERE wo.id = $1`,
        [req.params.id]
      );
      if (!order) return res.status(404).json({ error: "Order not found" });

      let tracking_url = null;
      if (order.tracking_number && order.tracking_url_template) {
        tracking_url = order.tracking_url_template.replace("{tracking}", order.tracking_number);
      }

      // Fetch shipment events if we have an active shipment
      let events = [];
      if (order.active_shipment_id) {
        const { rows } = await db.query(
          `SELECT event_status, event_description, event_location, event_timestamp, created_at
           FROM shipment_tracking_events
           WHERE shipment_id = $1
           ORDER BY event_timestamp DESC NULLS LAST, created_at DESC`,
          [order.active_shipment_id]
        );
        events = rows;
      }

      res.json({ ...order, tracking_url, events });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = Object.assign(mountCourierRoutes, { notifyCustomerSms });
