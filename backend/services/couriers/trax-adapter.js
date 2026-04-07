const BaseCourierAdapter = require("./base-adapter");

class TraxAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://sonic.pk/api";
    const url = `${baseUrl}/shipment/book`;

    const payload = {
      consignee_name: receiver.name,
      consignee_address: receiver.address,
      consignee_phone: receiver.phone,
      consignee_city: receiver.city,
      weight: options.weight || 0.5,
      pieces: options.pieces || 1,
      cod_amount: options.cod_amount || 0,
      order_id: String(order.id),
      service_type: options.cod_amount > 0 ? "COD" : "Non COD",
      item_description: `Order #${order.id}`,
      shipper_name: sender.name,
      shipper_phone: sender.phone,
      shipper_address: sender.address,
      shipper_city: sender.city,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.config.api_key,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Trax API error: ${res.status}`);
    const data = await res.json();

    if (!data.tracking_number) {
      throw new Error(data.message || data.error || "Trax booking failed");
    }

    return {
      tracking_number: data.tracking_number,
      label_url: data.label_url || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://sonic.pk/api";
    const url = `${baseUrl}/shipment/track?tracking_number=${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { Authorization: this.config.api_key },
    });

    if (!res.ok) throw new Error(`Trax tracking error: ${res.status}`);
    const data = await res.json();

    return {
      status: data.status || "unknown",
      events: (data.tracking_history || []).map((e) => ({
        status: e.status,
        location: e.location,
        timestamp: e.date_time,
        description: e.description,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://sonic.pk/api";
    const url = `${baseUrl}/shipment/cancel`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.config.api_key,
        },
        body: JSON.stringify({ tracking_number: trackingNumber }),
      });

      if (!res.ok) return { success: false, message: `Trax cancel error: ${res.status}` };
      const data = await res.json();
      return { success: !!data.success, message: data.message };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = TraxAdapter;
