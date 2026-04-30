/**
 * P25 — Dockerfile must install postgresql-client so pg_dump is on PATH.
 *
 * The /api/admin/backup and /api/backup/download endpoints both spawn
 * pg_dump via utils/backup-pg.js. Without postgresql-client in the
 * Alpine image, both endpoints return 503/500 "pg_dump not available
 * on this server" — broken end-to-end on production until this is
 * fixed.
 *
 * Found 2026-04-30 by inspecting R2 (0 backup objects after 50+ days)
 * and hitting the live endpoints with super-admin + tenant tokens.
 *
 * Test reads backend/Dockerfile and asserts the install line includes
 * a postgresql-client variant. Cheap regression guard against future
 * Dockerfile changes that drop the package.
 */
const fs = require("fs");
const path = require("path");

describe("P25 — Dockerfile installs postgresql-client", () => {
  const dockerfilePath = path.join(__dirname, "..", "..", "Dockerfile");
  let dockerfile;

  beforeAll(() => {
    dockerfile = fs.readFileSync(dockerfilePath, "utf8");
  });

  test("Dockerfile contains an apk add line that installs postgresql-client", () => {
    // Match `apk add ...` lines in the production stage (after the second FROM).
    // Accept any postgresql-client variant: postgresql-client, postgresql17-client, etc.
    const apkLines = dockerfile
      .split("\n")
      .filter((line) => /^\s*RUN\s+apk\s+add\b/.test(line));

    expect(apkLines.length).toBeGreaterThan(0);
    const hasPgClient = apkLines.some((line) =>
      /\bpostgresql(\d+)?-client\b/.test(line)
    );
    expect(hasPgClient).toBe(true);
  });

  test("postgresql-client install is in the production stage (not just builder)", () => {
    // Find the second FROM (production stage) and check for pg-client below it.
    const lines = dockerfile.split("\n");
    const fromIdxs = lines
      .map((l, i) => (/^FROM\b/.test(l) ? i : -1))
      .filter((i) => i >= 0);

    expect(fromIdxs.length).toBeGreaterThanOrEqual(2);
    const productionStageStart = fromIdxs[fromIdxs.length - 1];
    const prodStage = lines.slice(productionStageStart).join("\n");
    expect(prodStage).toMatch(/\bpostgresql(\d+)?-client\b/);
  });
});
