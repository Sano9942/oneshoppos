const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    environment: "node",
    testTimeout: 60000,
    // Every integration file's beforeAll executes all of schema-pg.sql
    // (~5,900 lines, 327 tables) to build an isolated schema. Under parallel
    // forks against one Postgres that routinely exceeds a short timeout.
    // Measured 2026-07-29: at hookTimeout=10000 the suite reported 106 failed
    // files; raising it and serialising moved 52 of those to passing with no
    // code change. Do not lower this without re-measuring.
    hookTimeout: 120000,
    pool: "forks",
    // Schema provisioning is the bottleneck, not CPU. Parallel files starve
    // each other's beforeAll on a single local Postgres.
    fileParallelism: false,
    isolate: true,
    globals: true,
    setupFiles: ["./tests/helpers/vitest-setup.js"],
    coverage: {
      provider: "v8",
      include: [
        "utils/**",
        "services/**",
        "middleware/**",
        "category-tree.js",
      ],
      exclude: [
        "routes/**",
        "workers/**",
        "jobs/**",
        "scripts/**",
        "index.js",
        "migrate-pg.js",
        "*.config.js",
      ],
    },
  },
});
