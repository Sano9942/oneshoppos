const helpersInit = require("./helpers");
const dashboard = require("./dashboard");
const sales = require("./sales");
const inventory = require("./inventory");
const analytics = require("./analytics");
const purchasing = require("./purchasing");
const finance = require("./finance");
const shifts = require("./shifts");
const governance = require("./governance");
const staff = require("./staff");

module.exports = function registerReportsRoutes(app, deps) {
  const { db } = deps;

  // Initialize helpers with db
  const helpers = helpersInit(db);

  // Initialize all modular report domains
  dashboard(app, deps, helpers);
  sales(app, deps, helpers);
  inventory(app, deps, helpers);
  analytics(app, deps, helpers);
  purchasing(app, deps, helpers);
  finance(app, deps, helpers);
  staff(app, deps, helpers);
  shifts(app, deps, helpers);
  const governanceModule = governance(app, deps, helpers);

  // FBR e-invoicing export
  require("./fbr-export")(app, deps);

  // Stock aging report (Wave 3)
  require("./stock-aging")(app, deps, helpers);

  // Multi-channel reports (Wave 6)
  require("./multichannel")(app, deps, helpers);

  // Clinical reports (M10) — treatment_plans mode
  require("./clinical")(app, deps, helpers);

  // KDS analytics (2-R.5) — restaurant mode
  require("./kds-analytics")(app, deps, helpers);

  // Return the processPendingReportSchedules function required by registerAllRoutes.js
  return {
    processPendingReportSchedules:
      governanceModule.processPendingReportSchedules,
  };
};
