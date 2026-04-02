const { ZodError } = require("zod");

/**
 * Express middleware factory — validates req.body against a Zod schema.
 * Usage: app.post("/api/foo", validate(FooSchema), handler)
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body || {});
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: err.errors[0]?.message || "Validation failed",
          details: err.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}

module.exports = { validate };
