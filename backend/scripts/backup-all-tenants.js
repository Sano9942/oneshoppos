#!/usr/bin/env node
// backend/scripts/backup-all-tenants.js
// Daily backup: master.db + all tenant DBs → gzip → Cloudflare R2
// Run via Railway cron or manually: node backend/scripts/backup-all-tenants.js
//
// Required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// Optional: DATA_DIR (defaults to backend/)

const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "..");
const RETENTION_DAYS = 30;

// --- R2 client setup ---
function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error("Missing R2 env vars (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

// --- SQLite safe backup ---
function backupDb(dbPath) {
  const tmpPath = dbPath + ".backup";
  execFileSync("sqlite3", [dbPath, `.backup '${tmpPath}'`]);
  const data = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);
  return data;
}

// --- Upload gzipped backup to R2 ---
async function uploadToR2(client, bucket, key, data) {
  const gzipped = zlib.gzipSync(data);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: gzipped,
      ContentType: "application/gzip",
    })
  );
  console.log(`  Uploaded ${key} (${(gzipped.length / 1024).toFixed(1)} KB)`);
}

// --- Delete objects older than RETENTION_DAYS ---
async function pruneOldBackups(client, bucket) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: bucket })
  );
  if (!listed.Contents || listed.Contents.length === 0) return;

  const toDelete = listed.Contents.filter(
    (obj) => obj.LastModified < cutoff
  ).map((obj) => ({ Key: obj.Key }));

  if (toDelete.length === 0) {
    console.log(`  No backups older than ${RETENTION_DAYS} days to prune.`);
    return;
  }

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: toDelete },
    })
  );
  console.log(`  Pruned ${toDelete.length} backup(s) older than ${RETENTION_DAYS} days.`);
}

// --- Main ---
async function main() {
  const bucket = process.env.R2_BUCKET || "sanopos-backups";
  const client = getR2Client();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  console.log(`[backup] Starting backup at ${ts}`);
  console.log(`[backup] DATA_DIR = ${DATA_DIR}`);

  // 1. Backup master.db
  const masterPath = path.join(DATA_DIR, "master.db");
  if (fs.existsSync(masterPath)) {
    console.log("[backup] Backing up master.db...");
    const data = backupDb(masterPath);
    await uploadToR2(client, bucket, `${ts}/master.db.gz`, data);
  } else {
    console.log("[backup] No master.db found — skipping.");
  }

  // 2. Backup each tenant DB
  const tenantsDir = path.join(DATA_DIR, "tenants");
  if (fs.existsSync(tenantsDir)) {
    const slugs = fs
      .readdirSync(tenantsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    console.log(`[backup] Found ${slugs.length} tenant(s).`);

    for (const slug of slugs) {
      const dbPath = path.join(tenantsDir, slug, "sanopos.db");
      if (!fs.existsSync(dbPath)) {
        console.log(`  [${slug}] No sanopos.db — skipping.`);
        continue;
      }
      console.log(`  [${slug}] Backing up...`);
      const data = backupDb(dbPath);
      await uploadToR2(client, bucket, `${ts}/tenants/${slug}.db.gz`, data);
    }
  } else {
    console.log("[backup] No tenants/ directory — skipping tenant backups.");
  }

  // 3. Prune old backups
  console.log("[backup] Pruning old backups...");
  await pruneOldBackups(client, bucket);

  console.log("[backup] Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backup] FAILED:", err.message);
    process.exit(1);
  });
