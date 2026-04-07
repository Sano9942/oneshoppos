const BaseCourierAdapter = require("./base-adapter");

class SwyftAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://api.swyft.pk/api/v2";
    const url = `${baseUrl}/shipments`;

    const payload = {
      consignee_name: receiver.name,
      consignee_address: receiver.address,
      consignee_phone: receiver.phone,
      consignee_city: receiver.city,
      origin_city: sender.city || "",
      weight: options.weight || 0.5,
      pieces: options.pieces || 1,
      cod_amount: options.cod_amount || 0,
      order_reference: String(order.id),
      product_description: `Order #${order.id}`,
      service_type: options.cod_amount > 0 ? "COD" : "Non-COD",
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.api_key}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Swyft API error: ${res.status}`);
    const data = await res.json();

    if (!data.tracking_number) {
      throw new Error(data.message || "Swyft booking failed");
    }

    return {
      tracking_number: data.tracking_number,
      label_url: data.label_url || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://api.swyft.pk/api/v2";
    const url = `${baseUrl}/shipments/track?tracking_number=${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.api_key}` },
    });

    if (!res.ok) throw new Error(`Swyft tracking error: ${res.status}`);
    const data = await res.json();

    return {
      status: data.current_status || "unknown",
      events: (data.tracking_history || []).map((e) => ({
        status: e.status,
        location: e.location,
        timestamp: e.date_time,
        description: e.description,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://api.swyft.pk/api/v2";
    const url = `${baseUrl}/shipments/cancel`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.api_key}`,
        },
        body: JSON.stringify({ tracking_number: trackingNumber }),
      });

      if (!res.ok) return { success: false, message: `Swyft cancel error: ${res.status}` };
      const data = await res.json();
      return { success: !!data.success, message: data.message };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = SwyftAdapter;
