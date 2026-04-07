class BaseMarketplace {
  constructor(config) {
    this.config = config;
  }

  async testConnection() {
    throw new Error("Not implemented");
  }

  async syncProducts(products) {
    throw new Error("Not implemented");
  }

  async pullOrders(since) {
    throw new Error("Not implemented");
  }

  async pushInventory(updates) {
    throw new Error("Not implemented");
  }
}

module.exports = BaseMarketplace;
