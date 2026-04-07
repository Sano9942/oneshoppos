const { Router } = require("express");

module.exports = function mountIntegrationRoutes(app, deps) {
  const router = Router();

  const { encryptSecret, decryptSecret, maskSecret } = require("../../services/crypto");

  const integrationDeps = {
    ...deps,
    encryptSecret,
    decryptSecret,
    maskSecret,
  };

  require("./hub")(router, integrationDeps);
  require("./credentials")(router, integrationDeps);
  require("./daraz")(router, integrationDeps);
  require("./facebook")(router, integrationDeps);
  require("./whatsapp")(router, integrationDeps);
  require("./google-merchant")(router, integrationDeps);

  app.use("/api/integrations", router);
};
