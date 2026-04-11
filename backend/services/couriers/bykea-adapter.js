const GenericAdapter = require("./generic-adapter");

/**
 * Bykea is a hyperlocal (within-city) delivery service.
 * Limited public API — extends GenericAdapter with manual tracking entry.
 * When Bykea publishes an API, this can be upgraded to full integration.
 */
class BykeaAdapter extends GenericAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    // Bykea has no public booking API. Throw so the booking route does not
    // persist a null-tracking order_shipments row with status='booked'
    // (which would falsely mark the order as shipped and fire a
    // "Tracking: N/A" SMS to the customer). Operators should book via the
    // Bykea app/dashboard and then use the manual tracking entry flow —
    // either by setting supports_booking=false on this courier row or by
    // pasting the tracking number into the order's manual-ship action.
    const err = new Error(
      "Bykea has no booking API. Book via the Bykea app/dashboard and enter the tracking number manually (disable 'supports_booking' on this courier row or use the manual ship action)."
    );
    err.statusCode = 501;
    err.code = "COURIER_NO_BOOKING_API";
    throw err;
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
