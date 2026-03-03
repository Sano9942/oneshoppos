const express = require("express");
const app = express();
const deps = {
  db: {},
  requirePerm: () => (req, res, next) => next(),
  requireAnyPerm: () => (req, res, next) => next(),
  requireFeature: () => (req, res, next) => next(),
  createNotification: () => {},
  path: require("path"),
  fs: require("fs"),
  UPLOADS_DIR: "",
};

const reports = require("./routes/reports");
reports(app, deps);

const routes = app._router.stack
  .filter((r) => r.route)
  .map(
    (r) =>
      Object.keys(r.route.methods).join(",").toUpperCase() + " " + r.route.path,
  );
console.log(routes.join("\n"));
