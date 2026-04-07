/**
 * Generalized secret encryption/decryption for all integrations.
 * Uses AES-256-GCM. Key from INTEGRATION_SECRET_KEY or SHOPIFY_SECRET_KEY env var.
 */
const crypto = require("crypto");

const ENC_PREFIX = "enc:v1";

function getKeyBuffer() {
  const raw = String(process.env.INTEGRATION_SECRET_KEY || process.env.SHOPIFY_SECRET_KEY || "").trim();
  if (!raw) throw new Error("INTEGRATION_SECRET_KEY or SHOPIFY_SECRET_KEY env var required");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch {}
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function encryptSecret(plainText) {
  if (!plainText) return null;
  const value = String(plainText).trim();
  if (!value) return null;
  if (value.startsWith(ENC_PREFIX + ":")) return value; // already encrypted
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(storedText) {
  if (!storedText) return null;
  const stored = String(storedText).trim();
  if (!stored.startsWith(ENC_PREFIX + ":")) return stored; // plaintext fallback
  const key = getKeyBuffer();
  const parts = stored.split(":");
  if (parts.length < 5) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const encrypted = Buffer.from(parts[4], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function maskSecret(value) {
  if (!value) return null;
  const plain = value.startsWith(ENC_PREFIX + ":") ? "••••" : String(value);
  if (plain.length <= 4) return "••••";
  return "••••" + plain.slice(-4);
}

module.exports = { encryptSecret, decryptSecret, maskSecret };
