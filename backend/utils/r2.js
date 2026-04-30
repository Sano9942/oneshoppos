/**
 * r2.js — Cloudflare R2 upload helper (S3-compatible).
 *
 * Exports a single function: uploadToR2(buffer, key, contentType)
 * Returns the public CDN URL of the uploaded object.
 *
 * Env vars required:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET, R2_ENDPOINT (optional — derived from account ID if absent)
 *   R2_PUBLIC_URL (optional — custom domain / public bucket URL prefix)
 */
const path = require("path");
const fs = require("fs");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET || "sanopos-uploads";
const endpoint =
  process.env.R2_ENDPOINT ||
  `https://${accountId}.r2.cloudflarestorage.com`;

const hasR2Credentials = !!(accountId && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

const r2 = hasR2Credentials
  ? new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

/**
 * Upload a buffer to R2 and return the served URL.
 * Falls back to local file storage when R2 credentials are not configured.
 *
 * @param {Buffer} buffer       - File contents
 * @param {string} key          - Object key, e.g. "products/product_123.jpg"
 * @param {string} contentType  - MIME type, e.g. "image/jpeg"
 * @returns {Promise<string>}   - URL to access the file
 */
async function uploadToR2(buffer, key, contentType) {
  if (!r2) {
    // Local fallback: write to backend/exports/<key>
    const localDir = path.join(__dirname, "..", "exports", path.dirname(key));
    fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(__dirname, "..", "exports", key);
    fs.writeFileSync(localPath, buffer);
    return `exports/${key}`;
  }

  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  // Always return an absolute URL so the frontend (often hosted on a different
  // origin than the API) can fetch the asset. Prefer R2_PUBLIC_URL (custom CDN
  // domain) when set; otherwise route through the backend's /r2/<key> proxy at
  // APP_PUBLIC_BASE_URL. A bare relative `/r2/<key>` would resolve against the
  // frontend host (Vercel) and never reach the backend (Railway) — see P23.
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }
  if (process.env.APP_PUBLIC_BASE_URL) {
    return `${process.env.APP_PUBLIC_BASE_URL.replace(/\/$/, "")}/r2/${key}`;
  }
  throw new Error(
    "R2 upload misconfigured: set R2_PUBLIC_URL (CDN/custom domain) or APP_PUBLIC_BASE_URL (backend proxy) — a relative URL would resolve against the wrong host under split-host deploys"
  );
}

/**
 * Delete an object from R2 by key.
 * No-op when R2 credentials are not configured (local fallback files
 * are left on disk — they'll be cleaned up by the local unlink path).
 *
 * @param {string} key - Object key, e.g. "products/product_123.webp"
 */
async function deleteFromR2(key) {
  if (!r2) return;
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

module.exports = { uploadToR2, deleteFromR2, r2, bucket };
