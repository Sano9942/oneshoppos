const helpersInit = require("./helpers");
const dashboard = require("./dashboard");
const sales = require("./sales");
const inventory = require("./inventory");
const analytics = require("./analytics");
const shifts = require("./shifts");
const governance = require("./governance");

module.exports = function registerReportsRoutes(app, deps) {
  const { db } = deps;

  // Initialize helpers with db
  const helpers = helpersInit(db);

  // Initialize all modular report domains
  dashboard(app, deps, helpers);
  sales(app, deps, helpers);
  const inventoryModule = inventory(app, deps, helpers);
  analytics(app, deps, helpers);
  shifts(app, deps, helpers);
  const governanceModule = governance(app, deps, helpers);

  // Return the processPendingReportSchedules function required by registerAllRoutes.js
  return {
    processPendingReportSchedules:
      governanceModule.processPendingReportSchedules,
  };
};
