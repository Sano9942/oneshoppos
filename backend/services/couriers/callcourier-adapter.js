const BaseCourierAdapter = require("./base-adapter");

class CallCourierAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://cod.callcourier.com.pk/api/CallCourier";
    const url = `${baseUrl}/SaveBooking`;

    const payload = {
      loginId: this.config.api_key,
      password: this.config.api_secret,
      ConsigneeName: receiver.name,
      ConsigneeAddress: receiver.address,
      ConsigneeMobNo: receiver.phone,
      DestCityName: receiver.city,
      OriginCityName: sender.city || "",
      Weight: options.weight || 0.5,
      Pieces: options.pieces || 1,
      CodAmount: options.cod_amount || 0,
      SpecialHandling: false,
      MyBoxId: String(order.id),
      ProductDetail: `Order #${order.id}`,
      ServiceTypeId: options.cod_amount > 0 ? "7" : "1", // 7=COD, 1=Overnight
      ShipperName: sender.name,
      ShipperCellNo: sender.phone,
      ShipperAddress: sender.address,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`CallCourier API error: ${res.status}`);
    const data = await res.json();

    if (!data.Response) {
      throw new Error(data.Description || "CallCourier booking failed");
    }

    return {
      tracking_number: data.ABORTEFCN || null,
      label_url: null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://cod.callcourier.com.pk/api/CallCourier";
    const url = `${baseUrl}/GetPacketStatus?cn=${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) throw new Error(`CallCourier tracking error: ${res.status}`);
    const data = await res.json();

    return {
      status: data.PacketStatus || "unknown",
      events: (data.TrackingDetails || []).map((e) => ({
        status: e.Status,
        location: e.Location,
        timestamp: e.DateTime,
        description: e.Description,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    return { success: false, message: "Contact CallCourier support to cancel shipments" };
  }
}

module.exports = CallCourierAdapter;
