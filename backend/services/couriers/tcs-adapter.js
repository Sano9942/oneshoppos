const BaseCourierAdapter = require("./base-adapter");

class TCSAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://apis.tcscourier.com";
    const url = `${baseUrl}/production/v1/cod/create-order`;

    const payload = {
      userName: this.config.api_key,
      password: this.config.api_secret,
      costCenterCode: this.config.config_json?.cost_center || "",
      consigneeName: receiver.name,
      consigneeAddress: receiver.address,
      consigneeMobNo: receiver.phone,
      consigneeCityName: receiver.city,
      weight: options.weight || 0.5,
      pieces: options.pieces || 1,
      codAmount: options.cod_amount || 0,
      customerReferenceNo: String(order.id),
      services: options.cod_amount > 0 ? "COD" : "O",
      productDetails: `Order #${order.id}`,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`TCS API error: ${res.status}`);
    const data = await res.json();

    if (data.returnStatus?.status === "FAIL") {
      throw new Error(data.returnStatus?.message || "TCS booking failed");
    }

    return {
      tracking_number: data.bookingReply?.consignmentNo || null,
      label_url: data.bookingReply?.labelUrl || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://apis.tcscourier.com";
    const url = `${baseUrl}/production/v1/track?consignmentNo=${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: {
        "X-IBM-Client-Id": this.config.api_key,
      },
    });

    if (!res.ok) throw new Error(`TCS tracking error: ${res.status}`);
    const data = await res.json();

    return {
      status: data.trackingDetail?.currentStatus || "unknown",
      events: (data.trackingDetail?.trackingEvents || []).map((e) => ({
        status: e.status,
        location: e.location,
        timestamp: e.dateTime,
        description: e.description,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    return { success: false, message: "Contact TCS support to cancel shipments" };
  }
}

module.exports = TCSAdapter;
