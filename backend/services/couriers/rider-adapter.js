const BaseCourierAdapter = require("./base-adapter");

class RiderAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://api.rider.pk/api/v1";
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
      order_id: String(order.id),
      service_type: options.cod_amount > 0 ? "COD" : "Non-COD",
      description: `Order #${order.id}`,
      shipper_name: sender.name,
      shipper_phone: sender.phone,
      shipper_address: sender.address,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.api_key}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Rider API error: ${res.status}`);
    const data = await res.json();

    if (data.error) {
      throw new Error(data.message || "Rider booking failed");
    }

    return {
      tracking_number: data.tracking_number || data.cn_number || null,
      label_url: data.label_url || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://api.rider.pk/api/v1";
    const url = `${baseUrl}/shipments/track/${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.api_key}` },
    });

    if (!res.ok) throw new Error(`Rider tracking error: ${res.status}`);
    const data = await res.json();

    return {
      status: data.current_status || "unknown",
      events: (data.tracking_history || []).map((e) => ({
        status: e.status,
        location: e.location,
        timestamp: e.date,
        description: e.remarks,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    return { success: false, message: "Contact Rider support to cancel shipments" };
  }
}

module.exports = RiderAdapter;
