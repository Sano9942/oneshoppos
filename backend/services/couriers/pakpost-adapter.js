const GenericAdapter = require("./generic-adapter");

/**
 * Pakistan Post has limited API availability.
 * Extends GenericAdapter — tracking URL is the primary integration point.
 * Manual tracking entry with web-based tracking link.
 */
class PakPostAdapter extends GenericAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    // Pakistan Post has no booking API. Throw so the booking route does not
    // persist a null-tracking order_shipments row with status='booked'
    // (which would falsely mark the order as shipped and fire a
    // "Tracking: N/A" SMS to the customer). Operators should book at the
    // counter and then use the manual tracking entry flow — either by
    // setting supports_booking=false on this courier row or by pasting
    // the tracking number into the order's manual-ship action.
    const err = new Error(
      "Pakistan Post has no booking API. Book at a PakPost counter and enter the tracking number manually (disable 'supports_booking' on this courier row or use the manual ship action)."
    );
    err.statusCode = 501;
    err.code = "COURIER_NO_BOOKING_API";
    throw err;
  }

  async getTracking(trackingNumber) {
    // Pakistan Post tracking available at ep.gov.pk
    return {
      status: "Track at https://ep.gov.pk/track",
      events: [],
      tracking_url: `https://ep.gov.pk/track/${encodeURIComponent(trackingNumber)}`,
    };
  }

  async cancelShipment(trackingNumber) {
    return { success: false, message: "Contact Pakistan Post to cancel shipments" };
  }
}

module.exports = PakPostAdapter;
