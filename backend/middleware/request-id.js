/**
 * middleware/request-id.js — Request ID + Pino structured logging.
 *
 * - Generates a UUID per request (or honours incoming X-Request-Id)
 * - Sets X-Request-Id response header
 * - Creates a Pino child logger on req.log with reqId, tenantSlug, employeeId
 * - Auto-logs request completion with method, url, status, duration
 * - Warns on requests slower than 2 s
 */

const crypto = require("crypto");
const pinoHttp = require("pino-http");
const logger = require("../services/logger");

const SLOW_REQUEST_MS = 2000;

const requestIdMiddleware = pinoHttp({
  logger,

  // Use incoming header or generate a new UUID
  genReqId: (req) =>
    req.headers["x-request-id"] || crypto.randomUUID(),

  // Attach request ID to the response header
  customSuccessMessage: (req, res) => {
    const duration = Date.now() - (req._startTime || Date.now());
    return `${req.method} ${req.url} ${res.statusCode} ${duration}ms`;
  },
  customErrorMessage: (req, res) => {
    const duration = Date.now() - (req._startTime || Date.now());
    return `${req.method} ${req.url} ${res.statusCode} ${duration}ms`;
  },

  // Adjust log level based on status code and duration
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  // Keep serializers minimal — no full bodies
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },

  // Enrich child logger with tenant and employee context
  customProps: (req) => {
    const props = {};
    if (req.tenantSlug) props.tenantSlug = req.tenantSlug;
    if (req.employee?.id) props.employeeId = req.employee.id;
    return props;
  },

  // Add response header and track start time
  customReceivedMessage: (_req) => undefined,
});

/**
 * Wrapper that adds X-Request-Id response header and slow-request warnings.
 */
function requestId(req, res, next) {
  req._startTime = Date.now();

  requestIdMiddleware(req, res, () => {
    // Set the response header from the generated/forwarded ID
    if (req.id) {
      res.setHeader("X-Request-Id", req.id);
    }

    // After response finishes, check for slow requests
    res.on("finish", () => {
      const duration = Date.now() - req._startTime;
      if (duration > SLOW_REQUEST_MS && req.log) {
        req.log.warn(
          { duration, method: req.method, url: req.url, statusCode: res.statusCode },
          "slow request"
        );
      }
    });

    next();
  });
}

module.exports = requestId;
