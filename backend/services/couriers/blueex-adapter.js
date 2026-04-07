const BaseCourierAdapter = require("./base-adapter");

class BlueExAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://bilogia.blue-ex.com/api";
    const url = `${baseUrl}/logistic/order/add`;

    const payload = {
      trader_id: this.config.api_key,
      customer_name: receiver.name,
      customer_address: receiver.address,
      customer_phone: receiver.phone,
      customer_city: receiver.city,
      weight: options.weight || 0.5,
      product_value: options.cod_amount || 0,
      shipping_type: options.cod_amount > 0 ? "COD" : "Prepaid",
      item_description: `Order #${order.id}`,
      reference_no: String(order.id),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.api_secret}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`BlueEx API error: ${res.status}`);
    const data = await res.json();

    if (data.status === "error") {
      throw new Error(data.message || "BlueEx booking failed");
    }

    return {
      tracking_number: data.cn_number || data.tracking_number || null,
      label_url: data.label_url || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://bilogia.blue-ex.com/api";
    const url = `${baseUrl}/logistic/tracking/${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.api_secret}` },
    });

    if (!res.ok) throw new Error(`BlueEx tracking error: ${res.status}`);
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
    const baseUrl = this.config.api_base_url || "https://bilogia.blue-ex.com/api";
    const url = `${baseUrl}/logistic/order/cancel`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.api_secret}`,
        },
        body: JSON.stringify({ cn_number: trackingNumber }),
      });

      if (!res.ok) return { success: false, message: `BlueEx cancel error: ${res.status}` };
      const data = await res.json();
      return { success: data.status === "success", message: data.message };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = BlueExAdapter;
