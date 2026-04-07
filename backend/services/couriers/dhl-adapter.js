const BaseCourierAdapter = require("./base-adapter");

class DHLAdapter extends BaseCourierAdapter {
  async _getAuthToken() {
    const res = await fetch("https://api.dhl.com/ecs/v1/auth/accesstoken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `client_id=${encodeURIComponent(this.config.api_key)}&client_secret=${encodeURIComponent(this.config.api_secret)}&grant_type=client_credentials`,
    });
    if (!res.ok) throw new Error(`DHL auth error: ${res.status}`);
    const data = await res.json();
    return data.access_token;
  }

  async bookShipment(order, sender, receiver, options = {}) {
    const token = await this._getAuthToken();
    const baseUrl = this.config.api_base_url || "https://api.dhl.com/ecs/v1";
    const url = `${baseUrl}/shipments`;

    const payload = {
      plannedShippingDateAndTime: new Date().toISOString(),
      productCode: options.service_code || "P",
      accounts: [{ typeCode: "shipper", number: this.config.config_json?.account_number || "" }],
      customerDetails: {
        shipperDetails: {
          postalAddress: {
            cityName: sender.city || "",
            postalCode: sender.postal_code || "",
            countryCode: sender.country_code || "PK",
            addressLine1: sender.address || "",
          },
          contactInformation: {
            fullName: sender.name,
            phone: sender.phone || "",
            email: sender.email || "",
          },
        },
        receiverDetails: {
          postalAddress: {
            cityName: receiver.city || "",
            postalCode: receiver.postal_code || "",
            countryCode: receiver.country_code || "PK",
            addressLine1: receiver.address || "",
          },
          contactInformation: {
            fullName: receiver.name,
            phone: receiver.phone || "",
            email: receiver.email || "",
          },
        },
      },
      content: {
        packages: [{
          weight: options.weight || 0.5,
          dimensions: {
            length: options.length || 10,
            width: options.width || 10,
            height: options.height || 10,
          },
        }],
        description: `Order #${order.id}`,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`DHL API error: ${res.status}`);
    const data = await res.json();

    return {
      tracking_number: data.shipmentTrackingNumber || null,
      label_url: data.documents?.[0]?.url || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const token = await this._getAuthToken();
    const url = `https://api.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`DHL tracking error: ${res.status}`);
    const data = await res.json();
    const shipment = data.shipments?.[0];

    return {
      status: shipment?.status?.statusCode || "unknown",
      events: (shipment?.events || []).map((e) => ({
        status: e.status,
        location: e.location?.address?.addressLocality || "",
        timestamp: e.timestamp,
        description: e.description,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    return { success: false, message: "Contact DHL support to cancel shipments" };
  }
}

module.exports = DHLAdapter;
