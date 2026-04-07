const GenericAdapter = require("./generic-adapter");

/**
 * Bykea is a hyperlocal (within-city) delivery service.
 * Limited public API — extends GenericAdapter with manual tracking entry.
 * When Bykea publishes an API, this can be upgraded to full integration.
 */
class BykeaAdapter extends GenericAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    // Bykea bookings are made via their app/dashboard
    // Return placeholder for manual entry
    return {
      tracking_number: null,
      label_url: null,
      message: "Book via Bykea app/dashboard. Enter tracking number manually after booking.",
    };
  }

  async getTracking(trackingNumber) {
    // No public tracking API — return manual-entry status
    return {
      status: "Track via Bykea app",
      events: [],
    };
  }

  async cancelShipment(trackingNumber) {
    return { success: false, message: "Cancel via Bykea app/dashboard" };
  }
}

module.exports = BykeaAdapter;
