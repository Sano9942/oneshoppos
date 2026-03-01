const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 10000,
    pool: "forks",
    isolate: true,
    globals: true,
  },
});
