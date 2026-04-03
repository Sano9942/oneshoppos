import { describe, it, expect, vi } from "vitest";
import { validate } from "../../middleware/validate.js";
import { LoginSchema } from "../../schemas/auth.js";
import { requirePerm, requireAnyPerm } from "../../middleware/permissions.js";

// Helper: build a mock Express req/res/next triple
function mockHttp(body = {}) {
  const req = { body };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

// ── validate middleware ───────────────────────────────────────────────────────

describe("validate — with LoginSchema", () => {
  it("calls next() for valid input (password)", () => {
    const { req, res, next } = mockHttp({ username: "alice", password: "secret" });
    validate(LoginSchema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when pin is provided instead of password", () => {
    const { req, res, next } = mockHttp({ username: "alice", pin: "1234" });
    validate(LoginSchema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when username is missing", () => {
    const { req, res, next } = mockHttp({ password: "secret" });
    validate(LoginSchema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when both password and pin are missing", () => {
    const { req, res, next } = mockHttp({ username: "alice" });
    validate(LoginSchema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for empty body", () => {
    const { req, res, next } = mockHttp({});
    validate(LoginSchema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("coerces outlet_id from string to number in req.body", () => {
    const { req, res, next } = mockHttp({ username: "alice", password: "pw", outlet_id: "3" });
    validate(LoginSchema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body.outlet_id).toBe(3);
  });
});

// ── permissions middleware ────────────────────────────────────────────────────

describe("requirePerm", () => {
  it("calls next() when employee has the exact permission", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["view_reports", "manage_inventory"];
    requirePerm("manage_inventory")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() when employee has all_access (administrator)", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["all_access"];
    requirePerm("manage_inventory")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when permission is missing", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["view_reports"];
    requirePerm("manage_inventory")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when employeePerms is empty", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = [];
    requirePerm("view_reports")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when employeePerms is undefined", () => {
    const { req, res, next } = mockHttp();
    // req.employeePerms not set — defaults to []
    requirePerm("view_reports")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireAnyPerm", () => {
  it("calls next() when employee has any one of the required permissions", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["view_reports"];
    requireAnyPerm(["manage_inventory", "view_reports"])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() when employee has all_access", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["all_access"];
    requireAnyPerm(["manage_inventory", "view_reports"])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when employee has none of the required permissions", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["pos_discount"];
    requireAnyPerm(["manage_inventory", "view_reports"])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
