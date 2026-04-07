const BaseCourierAdapter = require("./base-adapter");

class FedExAdapter extends BaseCourierAdapter {
  async _getAuthToken() {
    const res = await fetch("https://apis.fedex.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(this.config.api_key)}&client_secret=${encodeURIComponent(this.config.api_secret)}`,
    });
    if (!res.ok) throw new Error(`FedEx auth error: ${res.status}`);
    const data = await res.json();
    return data.access_token;
  }

  async bookShipment(order, sender, receiver, options = {}) {
    const token = await this._getAuthToken();
    const url = "https://apis.fedex.com/ship/v1/shipments";

    const payload = {
      requestedShipment: {
        shipper: {
          contact: {
            personName: sender.name,
            phoneNumber: sender.phone || "",
          },
          address: {
            streetLines: [sender.address || ""],
            city: sender.city || "",
            postalCode: sender.postal_code || "",
            countryCode: sender.country_code || "PK",
          },
        },
        recipients: [{
          contact: {
            personName: receiver.name,
            phoneNumber: receiver.phone || "",
          },
          address: {
            streetLines: [receiver.address || ""],
            city: receiver.city || "",
            postalCode: receiver.postal_code || "",
            countryCode: receiver.country_code || "PK",
          },
        }],
        pickupType: "DROPOFF_AT_FEDEX_LOCATION",
        serviceType: options.service_type || "FEDEX_INTERNATIONAL_PRIORITY",
        packagingType: "YOUR_PACKAGING",
        requestedPackageLineItems: [{
          weight: { value: options.weight || 0.5, units: "KG" },
          dimensions: {
            length: options.length || 10,
            width: options.width || 10,
            height: options.height || 10,
            units: "CM",
          },
        }],
        shippingChargesPayment: {
          paymentType: "SENDER",
        },
      },
      accountNumber: { value: this.config.config_json?.account_number || "" },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`FedEx API error: ${res.status}`);
    const data = await res.json();
    const result = data.output?.transactionShipments?.[0];

    return {
      tracking_number: result?.masterTrackingNumber?.trackingNumber || null,
      label_url: result?.pieceResponses?.[0]?.packageDocuments?.[0]?.url || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const token = await this._getAuthToken();
    const url = "https://apis.fedex.com/track/v1/trackingnumbers";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
        includeDetailedScans: true,
      }),
    });

    if (!res.ok) throw new Error(`FedEx tracking error: ${res.status}`);
    const data = await res.json();
    const result = data.output?.completeTrackResults?.[0]?.trackResults?.[0];

    return {
      status: result?.latestStatusDetail?.statusByLocale || "unknown",
      events: (result?.scanEvents || []).map((e) => ({
        status: e.eventDescription,
        location: e.scanLocation?.city || "",
        timestamp: e.date,
        description: e.eventDescription,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    return { success: false, message: "Contact FedEx support to cancel shipments" };
  }
}

module.exports = FedExAdapter;
