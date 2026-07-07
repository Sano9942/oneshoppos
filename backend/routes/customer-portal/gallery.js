"use strict";

/**
 * V08 — Customer portal photo gallery (proofing).
 *
 * Mounted BEFORE tenant middleware; auth via loadCustomerAuth (scope
 * "customer"), tenant DB is req.db. The client sees ONLY client_visible shots
 * of projects they own and toggles their selection ("pick your 20").
 *
 * IDOR discipline (the plan's first-class harden): EVERY query joins
 * service_projects and filters sp.customer_id = req.customerId. A client
 * iterating project ids can never read another client's gallery — an
 * unowned/unknown project id resolves to 404, never another client's photos.
 * Images are served as R2-direct URLs (file_url), never proxied through Express.
 */

const express = require("express");
const { loadCustomerAuth } = require("../../middleware/customer-auth");

module.exports = function registerCustomerPortalGallery(app, deps) {
  const router = express.Router();
  const authMw = loadCustomerAuth(deps);

  // List the customer's own projects that have a client-visible gallery.
  router.get("/me/projects", authMw, async (req, res) => {
    try {
      const { rows } = await req.db.query(
        `SELECT sp.id, sp.name, sp.status,
                (SELECT COUNT(*)::int FROM project_files pf
                   WHERE pf.project_id = sp.id AND pf.client_visible = TRUE) AS gallery_count,
                (SELECT COUNT(*)::int FROM project_files pf
                   WHERE pf.project_id = sp.id AND pf.client_visible = TRUE AND pf.client_selected = TRUE) AS selected_count
           FROM service_projects sp
          WHERE sp.customer_id = $1
          ORDER BY sp.updated_at DESC`,
        [req.customerId]
      );
      res.json({ projects: rows });
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) return res.json({ projects: [] });
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Ownership resolver — returns the project row only if the authed customer
  // owns it, else null (→ 404). The single IDOR gate every gallery route uses.
  async function ownedProject(db, projectId, customerId) {
    const { rows: [proj] } = await db.query(
      "SELECT id, name FROM service_projects WHERE id = $1 AND customer_id = $2",
      [projectId, customerId]
    );
    return proj || null;
  }

  // Gallery grid for one owned project — client-visible shots only.
  router.get("/me/projects/:id/gallery", authMw, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const proj = await ownedProject(req.db, projectId, req.customerId);
      if (!proj) return res.status(404).json({ error: "Gallery not found" });

      const { rows: files } = await req.db.query(
        `SELECT id, file_name, file_url, client_selected, created_at
           FROM project_files
          WHERE project_id = $1 AND client_visible = TRUE
          ORDER BY created_at ASC, id ASC`,
        [projectId]
      );
      res.json({ project: { id: proj.id, name: proj.name }, files });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Toggle a single shot's selection. Scoped: the file must belong to an owned,
  // client-visible project file — the UPDATE's join guarantees it.
  router.put("/me/projects/:id/gallery/:fileId", authMw, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const fileId = Number(req.params.fileId);
      const { selected } = req.body || {};
      if (typeof selected !== "boolean") return res.status(400).json({ error: "selected (boolean) required" });
      const proj = await ownedProject(req.db, projectId, req.customerId);
      if (!proj) return res.status(404).json({ error: "Gallery not found" });

      const { rows: [row] } = await req.db.query(
        `UPDATE project_files SET client_selected = $1
          WHERE id = $2 AND project_id = $3 AND client_visible = TRUE
          RETURNING id, client_selected`,
        [selected, fileId, projectId]
      );
      if (!row) return res.status(404).json({ error: "Photo not found" });
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Client finishes their selection → log a project activity + notify staff.
  router.post("/me/projects/:id/gallery/submit", authMw, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const proj = await ownedProject(req.db, projectId, req.customerId);
      if (!proj) return res.status(404).json({ error: "Gallery not found" });

      const { rows: [{ count }] } = await req.db.query(
        `SELECT COUNT(*)::int AS count FROM project_files
          WHERE project_id = $1 AND client_visible = TRUE AND client_selected = TRUE`,
        [projectId]
      );

      // Activity log (portal actor → actor_id NULL) + staff notification.
      await req.db.query(
        `INSERT INTO project_activities (project_id, actor_id, activity_type, description, metadata)
         VALUES ($1, NULL, 'note', $2, $3)`,
        [projectId, `Client selected ${count} photo(s)`, JSON.stringify({ selected_count: count, via: "portal" })]
      );
      req.db.query(
        `INSERT INTO notifications (type, title, message, link)
         VALUES ('gallery_selection', 'Photo selection complete', $1, $2)`,
        [`Client selected ${count} photo(s) for "${proj.name}"`, `/projects`]
      ).catch(() => {});

      res.json({ ok: true, selected_count: count });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.use("/api/portal", router);
};
