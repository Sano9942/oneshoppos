/**
 * backup-pg.js — pg_dump / pg_restore wrappers for per-tenant backup/restore.
 *
 * Backup: streams a pg_dump custom-format archive for a single schema.
 * Restore: runs pg_restore from a file path into the target schema.
 */
const { spawn } = require("child_process");

const MAX_BACKUP_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Checks whether pg_dump is available on the system PATH.
 * @returns {Promise<boolean>}
 */
function isPgDumpAvailable() {
  return new Promise((resolve) => {
    const proc = spawn("pg_dump", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Returns a readable stream of pg_dump output for the given schema.
 *
 * @param {string} schemaName - Postgres schema name (e.g. "tenant_aces_hardware" or "public")
 * @returns {{ stream: ChildProcess.stdout, process: ChildProcess }}
 */
function backupSchema(schemaName) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const args = [
    dbUrl,
    "--schema", schemaName,
    "--format", "custom",
    "--no-owner",
    "--no-privileges",
  ];

  const proc = spawn("pg_dump", args, { stdio: ["ignore", "pipe", "pipe"] });
  return { stream: proc.stdout, process: proc };
}

/**
 * Restores a pg_dump custom-format archive into the given schema.
 *
 * @param {string} schemaName - Postgres schema name
 * @param {string} filePath - Path to the uploaded .dump file
 * @returns {Promise<{ success: boolean, stderr: string }>}
 */
function restoreSchema(schemaName, filePath) {
  return new Promise((resolve, reject) => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return reject(new Error("DATABASE_URL not set"));

    const args = [
      "--dbname", dbUrl,
      "--schema", schemaName,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      filePath,
    ];

    const proc = spawn("pg_restore", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      // pg_restore returns 0 on success, 1 on warnings (some objects already exist), 2+ on errors
      if (code <= 1) {
        resolve({ success: true, stderr });
      } else {
        reject(new Error(`pg_restore exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`pg_restore failed to start: ${err.message}`));
    });
  });
}

/**
 * Returns a readable stream of pg_dump output for multiple schemas in one archive.
 *
 * @param {string[]} schemaNames - Array of Postgres schema names
 * @returns {{ stream: ChildProcess.stdout, process: ChildProcess }}
 */
function backupAllSchemas(schemaNames) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");
  if (!schemaNames.length) throw new Error("No schemas to backup");

  const args = [dbUrl, "--format", "custom", "--no-owner", "--no-privileges"];
  for (const s of schemaNames) {
    args.push("--schema", s);
  }

  const proc = spawn("pg_dump", args, { stdio: ["ignore", "pipe", "pipe"] });
  return { stream: proc.stdout, process: proc };
}

/**
 * Lists schemas contained in a pg_dump custom-format archive.
 * Uses `pg_restore --list` to read the table of contents, then extracts
 * unique schema names. Useful for verifying a backup includes all expected schemas.
 *
 * @param {string} filePath - Path to the .dump file
 * @returns {Promise<string[]>} - Sorted array of unique schema names in the archive
 */
function listSchemasInBackup(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("pg_restore", ["--list", filePath], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });

    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`pg_restore --list exited ${code}: ${stderr}`));
      // TOC lines look like: "123; 1259 16456 TABLE public tenants postgres"
      // Schema name is the token after TABLE/INDEX/SEQUENCE/etc type keyword
      const schemas = new Set();
      for (const line of stdout.split("\n")) {
        if (line.startsWith(";")) continue; // comment line
        const match = line.match(/\b(?:TABLE|INDEX|SEQUENCE|CONSTRAINT|FK CONSTRAINT|DEFAULT|TRIGGER|TABLE DATA|FUNCTION|TYPE|ACL|COMMENT)\s+([\w]+)\s/);
        if (match) schemas.add(match[1]);
      }
      resolve([...schemas].sort());
    });

    proc.on("error", (err) => reject(new Error(`pg_restore failed to start: ${err.message}`)));
  });
}

/**
 * Returns the schema name for a given tenant slug, or "public" for single-tenant.
 */
function getSchemaName(tenantSlug) {
  return tenantSlug ? `tenant_${tenantSlug}` : "public";
}

module.exports = { backupSchema, backupAllSchemas, restoreSchema, listSchemasInBackup, getSchemaName, isPgDumpAvailable, MAX_BACKUP_SIZE };
