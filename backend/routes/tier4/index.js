const express = require("express");
const createNotificationsRouter = require("./notifications");
const createCompanyProfileRouter = require("./company-profile");
const createAccountingRouter = require("./accounting");
const createHRRouter = require("./hr");
const createCRMRouter = require("./crm");

module.exports = function createTier4Router(deps) {
  const router = express.Router();

  // Register sub-modules
  router.use(createNotificationsRouter(deps));
  router.use(createCompanyProfileRouter(deps));
  router.use(createAccountingRouter(deps));
  router.use(createHRRouter(deps));
  router.use(createCRMRouter(deps));

  return router;
};
