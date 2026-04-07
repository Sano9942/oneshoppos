/**
 * Shopify secret encryption/decryption utilities.
 * Delegates to the generalized crypto module (services/crypto.js).
 */
const { encryptSecret, decryptSecret } = require("../services/crypto");

function encryptShopifySecret(plainText) {
  if (!plainText) return "";
  return encryptSecret(plainText) || "";
}

function decryptShopifySecret(storedText) {
  if (!storedText) return "";
  return decryptSecret(storedText) || "";
}

function logShopifyEvent(level, event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    area: "shopify_connector",
    event,
    ...details,
  };
  const logger =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  logger(JSON.stringify(payload));
}

module.exports = {
  encryptShopifySecret,
  decryptShopifySecret,
  logShopifyEvent,
};
