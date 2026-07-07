/**
 * Service project lifecycle — CRUD, milestones, activity logging.
 */

async function createProject(db, data, employeeId) {
  const { rows: [project] } = await db.query(
    `INSERT INTO service_projects (name, description, customer_id, outlet_id, start_date, target_end_date, budget, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [data.name, data.description || null, data.customer_id || null, data.outlet_id || null,
     data.start_date || null, data.target_end_date || null, data.budget || null, employeeId]
  );

  await logActivity(db, project.id, employeeId, "status_change", "Project created");

  // V08 — F03 questionnaires: auto-attach any active templates whose trigger is
  // "project_created" (photography seeds Event Timeline + Shot List). Scoped to
  // the project's customer so the client can fill them on the portal. Non-fatal:
  // a form-attach failure must never roll back the project create.
  if (project.customer_id) {
    try {
      const { autoAttachForms } = require("./forms");
      await autoAttachForms(db, "project_created", {
        customerId: project.customer_id,
        entityType: "project",
        entityId: project.id,
      });
    } catch { /* non-fatal */ }
  }

  return project;
}

async function updateProject(db, id, data, employeeId) {
  const sets = []; const params = []; let idx = 0;
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) { idx++; sets.push(`${key} = $${idx}`); params.push(val); }
  }
  if (!sets.length) return null;
  idx++; params.push(id);
  sets.push("updated_at = NOW()");
  const { rows: [project] } = await db.query(
    `UPDATE service_projects SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
  );
  if (project && data.status) {
    await logActivity(db, id, employeeId, "status_change", `Status changed to ${data.status}`);
  }
  return project;
}

async function getProject(db, id) {
  const { rows: [project] } = await db.query(
    `SELECT sp.*, c.name AS customer_name
     FROM service_projects sp
     LEFT JOIN customers c ON c.id = sp.customer_id
     WHERE sp.id = $1`,
    [id]
  );
  if (!project) return null;

  const { rows: milestones } = await db.query(
    "SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY sort_order, id",
    [id]
  );
  const { rows: activities } = await db.query(
    `SELECT pa.*, e.name AS actor_name
     FROM project_activities pa
     LEFT JOIN employees e ON e.id = pa.actor_id
     WHERE pa.project_id = $1
     ORDER BY pa.created_at DESC LIMIT 50`,
    [id]
  );
  const { rows: files } = await db.query(
    "SELECT * FROM project_files WHERE project_id = $1 ORDER BY created_at DESC",
    [id]
  );

  // V08 — attached questionnaires (F03 form responses scoped to this project),
  // so the project page shows pending vs submitted status per form. Tolerant of
  // schemas where form_responses doesn't exist yet (pre-F03 tenants).
  let questionnaires = [];
  try {
    const { rows } = await db.query(
      `SELECT fr.id, fr.status, fr.submitted_at, fr.submitted_via, fr.created_at,
              ft.name AS form_name
         FROM form_responses fr
         JOIN form_templates ft ON ft.id = fr.form_template_id
        WHERE fr.entity_type = 'project' AND fr.entity_id = $1 AND fr.status <> 'void'
        ORDER BY fr.created_at DESC`,
      [id]
    );
    questionnaires = rows;
  } catch { /* form_responses absent on pre-F03 schemas */ }

  return { ...project, milestones, activities, files, questionnaires };
}

async function listProjects(db, filters = {}) {
  const params = []; let idx = 0;
  let where = "1=1";
  if (filters.status) { idx++; where += ` AND sp.status = $${idx}`; params.push(filters.status); }
  if (filters.customer_id) { idx++; where += ` AND sp.customer_id = $${idx}`; params.push(Number(filters.customer_id)); }

  const { rows } = await db.query(
    `SELECT sp.*, c.name AS customer_name,
       (SELECT COUNT(*)::int FROM project_milestones pm WHERE pm.project_id = sp.id) AS milestone_count,
       (SELECT COUNT(*)::int FROM project_milestones pm WHERE pm.project_id = sp.id AND pm.status = 'completed') AS completed_milestones
     FROM service_projects sp
     LEFT JOIN customers c ON c.id = sp.customer_id
     WHERE ${where}
     ORDER BY sp.updated_at DESC`,
    params
  );
  return rows;
}

async function createMilestone(db, projectId, data, employeeId) {
  const { rows: [milestone] } = await db.query(
    `INSERT INTO project_milestones (project_id, name, description, due_date, amount, invoice_on_completion, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [projectId, data.name, data.description || null, data.due_date || null,
     data.amount || null, data.invoice_on_completion, data.sort_order || 0]
  );
  await logActivity(db, projectId, employeeId, "milestone_update", `Milestone "${data.name}" created`);
  return milestone;
}

async function updateMilestone(db, milestoneId, data, employeeId) {
  const sets = []; const params = []; let idx = 0;
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) { idx++; sets.push(`${key} = $${idx}`); params.push(val); }
  }
  if (data.status === "completed") sets.push("completed_at = NOW()");
  if (!sets.length) return null;
  idx++; params.push(milestoneId);
  sets.push("updated_at = NOW()");
  const { rows: [milestone] } = await db.query(
    `UPDATE project_milestones SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
  );
  if (milestone) {
    await logActivity(db, milestone.project_id, employeeId, "milestone_update", `Milestone "${milestone.name}" updated`);
  }
  return milestone;
}

async function approveQuotation(db, quotationId, employeeId) {
  const { rows: [quotation] } = await db.query(
    `UPDATE quotations SET estimate_status = 'approved', approved_at = NOW(), approved_by = $2, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [quotationId, employeeId]
  );
  return quotation;
}

async function convertQuotationToProject(db, quotationId, employeeId) {
  const { rows: [quotation] } = await db.query(
    "SELECT * FROM quotations WHERE id = $1",
    [quotationId]
  );
  if (!quotation) throw Object.assign(new Error("Quotation not found"), { statusCode: 404 });
  if (quotation.estimate_status !== "approved") throw Object.assign(new Error("Quotation must be approved first"), { statusCode: 400 });

  const project = await createProject(db, {
    // `quotations` has no `title` column; fall back to a generated name.
    // Budget carries the accepted quote total — the column is `total_amount`
    // (reading `quotation.total` silently dropped the budget to NULL).
    name: quotation.title || `Project from Quotation #${quotation.id}`,
    customer_id: quotation.customer_id,
    budget: quotation.total_amount,
  }, employeeId);

  // Link quotation to project
  await db.query("UPDATE quotations SET project_id = $1 WHERE id = $2", [project.id, quotationId]);

  return project;
}

async function logActivity(db, projectId, actorId, activityType, description, metadata = {}) {
  await db.query(
    `INSERT INTO project_activities (project_id, actor_id, activity_type, description, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [projectId, actorId, activityType, description, JSON.stringify(metadata)]
  );
}

module.exports = {
  createProject, updateProject, getProject, listProjects,
  createMilestone, updateMilestone,
  approveQuotation, convertQuotationToProject,
  logActivity,
};
