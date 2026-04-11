const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 10000,
    pool: "forks",
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
