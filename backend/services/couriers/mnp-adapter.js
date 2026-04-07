const BaseCourierAdapter = require("./base-adapter");

class MnPAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://api.mulphico.com/api/v1";
    const url = `${baseUrl}/shipment/create`;

    const payload = {
      consignee_name: receiver.name,
      consignee_address: receiver.address,
      consignee_phone: receiver.phone,
      consignee_city: receiver.city,
      origin_city: sender.city || "",
      weight: options.weight || 0.5,
      pieces: options.pieces || 1,
      cod_amount: options.cod_amount || 0,
      order_ref: String(order.id),
      product_description: `Order #${order.id}`,
      service_type: options.cod_amount > 0 ? "COD" : "Non-COD",
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

    if (!res.ok) throw new Error(`M&P API error: ${res.status}`);
    const data = await res.json();

    if (data.status === "error") {
      throw new Error(data.message || "M&P booking failed");
    }

    return {
      tracking_number: data.tracking_number || data.cn_number || null,
      label_url: data.label_url || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://api.mulphico.com/api/v1";
    const url = `${baseUrl}/shipment/track/${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.api_key}` },
    });

    if (!res.ok) throw new Error(`M&P tracking error: ${res.status}`);
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
    const baseUrl = this.config.api_base_url || "https://api.mulphico.com/api/v1";
    const url = `${baseUrl}/shipment/cancel`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.api_key}`,
        },
        body: JSON.stringify({ tracking_number: trackingNumber }),
      });

      if (!res.ok) return { success: false, message: `M&P cancel error: ${res.status}` };
      const data = await res.json();
      return { success: data.status === "success", message: data.message };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = MnPAdapter;
