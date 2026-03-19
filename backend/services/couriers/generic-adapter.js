const BaseCourierAdapter = require("./base-adapter");

class GenericAdapter extends BaseCourierAdapter {
  async bookShipment() {
    return {
      tracking_number: null,
      label_url: null,
      message: "Enter tracking number manually",
    };
  }

  async getTracking(trackingNumber) {
    return { status: "unknown", events: [] };
  }

  async cancelShipment() {
    return { success: true };
  }
}

module.exports = GenericAdapter;
