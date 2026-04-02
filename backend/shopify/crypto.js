/**
 * Shopify secret encryption/decryption utilities.
 * Uses AES-256-GCM with a key derived from SHOPIFY_SECRET_KEY env var.
 */
const crypto = require("crypto");

const SHOPIFY_SECRET_ENC_PREFIX = "enc:v1";

function getShopifySecretKeyBuffer() {
  const raw = String(process.env.SHOPIFY_SECRET_KEY || "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch {
    // ignore parse issues
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function encryptShopifySecret(plainText) {
  const value = String(plainText || "");
  if (!value) return "";
  const key = getShopifySecretKeyBuffer();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${SHOPIFY_SECRET_ENC_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptShopifySecret(storedText) {
  const stored = String(storedText || "");
  if (!stored) return "";
  if (!stored.startsWith(`${SHOPIFY_SECRET_ENC_PREFIX}:`)) return stored;
  const key = getShopifySecretKeyBuffer();
  if (!key) {
    throw new Error(
      "SHOPIFY_SECRET_KEY is required to decrypt Shopify secrets",
    );
  }
  const parts = stored.split(":");
  if (parts.length !== 5)
    throw new Error("Invalid encrypted Shopify secret format");
  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const encrypted = Buffer.from(parts[4], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
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
