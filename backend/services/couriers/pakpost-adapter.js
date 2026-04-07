const GenericAdapter = require("./generic-adapter");

/**
 * Pakistan Post has limited API availability.
 * Extends GenericAdapter — tracking URL is the primary integration point.
 * Manual tracking entry with web-based tracking link.
 */
class PakPostAdapter extends GenericAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    return {
      tracking_number: null,
      label_url: null,
      message: "Book at Pakistan Post counter. Enter tracking number manually after booking.",
    };
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
