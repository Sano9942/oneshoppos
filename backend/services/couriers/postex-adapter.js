const BaseCourierAdapter = require("./base-adapter");

class PostExAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://api.postex.pk/services/integration/api/order";
    const url = `${baseUrl}/v3/create-order`;

    const payload = {
      cityName: receiver.city,
      customerName: receiver.name,
      customerPhone: receiver.phone,
      deliveryAddress: receiver.address,
      invoiceDivision: options.cod_amount > 0 ? "COD" : "Non COD",
      invoicePayment: options.cod_amount || 0,
      items: 1,
      orderDetail: `Order #${order.id}`,
      orderRefNumber: String(order.id),
      transactionNotes: "",
      pickupAddressCode: this.config.config_json?.pickup_address_code || "001",
      storeAddressCode: this.config.config_json?.store_address_code || "001",
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: this.config.api_key,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`PostEx API error: ${res.status}`);
    const data = await res.json();

    if (!data.dist?.trackingNumber) {
      throw new Error(data.message || "PostEx booking failed");
    }

    return {
      tracking_number: data.dist.trackingNumber,
      label_url: data.dist.labelUrl || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://api.postex.pk/services/integration/api/order";
    const url = `${baseUrl}/v1/track-order?trackingNumber=${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { token: this.config.api_key },
    });

    if (!res.ok) throw new Error(`PostEx tracking error: ${res.status}`);
    const data = await res.json();

    return {
      status: data.dist?.orderStatus || "unknown",
      events: (data.dist?.trackingHistory || []).map((e) => ({
        status: e.status,
        location: e.location,
        timestamp: e.dateTime,
        description: e.description,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://api.postex.pk/services/integration/api/order";
    const url = `${baseUrl}/v1/cancel-order`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token: this.config.api_key,
        },
        body: JSON.stringify({ trackingNumber }),
      });

      if (!res.ok) return { success: false, message: `PostEx cancel error: ${res.status}` };
      const data = await res.json();
      return { success: data.statusCode === "200", message: data.message };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = PostExAdapter;
