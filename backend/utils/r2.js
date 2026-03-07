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
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET || "sanopos-uploads";
const endpoint =
  process.env.R2_ENDPOINT ||
  `https://${accountId}.r2.cloudflarestorage.com`;

const r2 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

/**
 * Upload a buffer to R2 and return the served URL.
 *
 * @param {Buffer} buffer       - File contents
 * @param {string} key          - Object key, e.g. "products/product_123.jpg"
 * @param {string} contentType  - MIME type, e.g. "image/jpeg"
 * @returns {Promise<string>}   - URL to access the file
 */
async function uploadToR2(buffer, key, contentType) {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  // If a public URL prefix is configured (custom domain or public bucket),
  // use it. Otherwise fall back to the /r2/ proxy endpoint on our own server.
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }
  return `/r2/${key}`;
}

module.exports = { uploadToR2, r2, bucket };
