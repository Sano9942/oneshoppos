/**
 * Admin authentication routes — POST /api/admin/auth/login
 */
module.exports = function registerAuthRoutes(app, deps) {
  const { db, masterDb, jwt, jwtDefaults, requireAllowedIp, authLimiter, bcrypt, logSecurityEvent } = deps;

  app.post("/api/admin/auth/login", requireAllowedIp, authLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    try {
      await masterDb.init(db);
      const { rows } = await db.query(
        "SELECT id, email, password_hash, name FROM super_admins WHERE email = $1",
        [email.toLowerCase().trim()]
      );
      const admin = rows[0] || null;
      if (!admin) {
        logSecurityEvent("login_failed", email, req.ip, req.headers["user-agent"], { reason: "invalid_credentials" });
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const valid = await bcrypt.compare(String(password), admin.password_hash);
      if (!valid) {
        logSecurityEvent("login_failed", email, req.ip, req.headers["user-agent"], { reason: "invalid_credentials" });
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const token = jwt.sign(
        { tid: 0, eid: 0, rid: 0, oid: null, aid: admin.id, email: admin.email, role: "super_admin", scope: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: jwtDefaults.accessExpiresIn }
      );
      logSecurityEvent("login_success", email, req.ip, req.headers["user-agent"], null);
      return res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
