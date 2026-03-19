const BaseCourierAdapter = require("./base-adapter");

class LeopardsAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const apiKey = this.config.api_key;
    const apiPassword = this.config.api_secret;
    if (!apiKey || !apiPassword) {
      throw new Error("Leopards API credentials not configured");
    }

    const res = await fetch(
      "https://merchantapi.leopardscourier.com/api/bookPacket/format/json/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          api_password: apiPassword,
          booked_packet_weight: options.weight || "0.5",
          booked_packet_no_piece: "1",
          booked_packet_collect_amount: options.cod_amount || "0",
          booked_packet_order_id: String(order.id),
          origin_city: sender.city || "",
          destination_city: receiver.city || "",
          shipment_name_eng: receiver.name || "",
          shipment_email: receiver.email || "",
          shipment_phone: receiver.phone || "",
          shipment_address: receiver.address || "",
          consignment_type: options.cod_amount > 0 ? "COD" : "Overnight",
        }),
      }
    );
    const data = await res.json();
    if (!data.status || data.status === 0) {
      throw new Error(data.error || "Booking failed");
    }
    return {
      tracking_number: data.track_number || data.slip_link,
      label_url: data.slip_link || null,
    };
  }

  async getTracking(trackingNumber) {
    const apiKey = this.config.api_key;
    const apiPassword = this.config.api_secret;
    const res = await fetch(
      "https://merchantapi.leopardscourier.com/api/trackBookedPacket/format/json/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          api_password: apiPassword,
          track_numbers: trackingNumber,
        }),
      }
    );
    const data = await res.json();
    return {
      status: data.packet_list?.[0]?.booked_packet_status || "unknown",
      events: data.packet_list?.[0]?.activity || [],
    };
  }

  async cancelShipment(trackingNumber) {
    return { success: false, message: "Contact Leopards support to cancel" };
  }
}

module.exports = LeopardsAdapter;
