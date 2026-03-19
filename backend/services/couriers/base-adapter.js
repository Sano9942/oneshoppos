class BaseCourierAdapter {
  constructor(config) {
    this.config = config;
  }

  /**
   * Book a shipment with the courier.
   * @param {Object} order  - Order record (id, total, items, etc.)
   * @param {Object} sender - { name, phone, address, city }
   * @param {Object} receiver - { name, phone, email, address, city }
   * @param {Object} options - { weight, cod_amount, ... }
   * @returns {Promise<{ tracking_number, label_url, ... }>}
   */
  async bookShipment(order, sender, receiver, options) {
    throw new Error("Not implemented");
  }

  /**
   * Get tracking status for a shipment.
   * @param {string} trackingNumber
   * @returns {Promise<{ status, events[] }>}
   */
  async getTracking(trackingNumber) {
    throw new Error("Not implemented");
  }

  /**
   * Cancel a booked shipment.
   * @param {string} trackingNumber
   * @returns {Promise<{ success, message? }>}
   */
  async cancelShipment(trackingNumber) {
    throw new Error("Not implemented");
  }
}

module.exports = BaseCourierAdapter;
