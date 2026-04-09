/**
 * Contract lifecycle — templates, generation, signature, audit.
 */

async function createContract(db, data, employeeId) {
  let bodyHtml = data.body_html || "";

  // If template specified, use it
  if (data.template_id) {
    const { rows: [template] } = await db.query(
      "SELECT * FROM contract_templates WHERE id = $1",
      [data.template_id]
    );
    if (template) bodyHtml = template.body_html;
  }

  const { rows: [contract] } = await db.query(
    `INSERT INTO contracts (project_id, customer_id, template_id, title, body_html, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [data.project_id || null, data.customer_id || null, data.template_id || null,
     data.title, bodyHtml, data.expires_at || null, employeeId]
  );

  // Add signers
  if (data.signers?.length) {
    for (const signer of data.signers) {
      await db.query(
        "INSERT INTO contract_signers (contract_id, name, email, role) VALUES ($1, $2, $3, $4)",
        [contract.id, signer.name, signer.email || null, signer.role || "signer"]
      );
    }
  }

  await logContractEvent(db, contract.id, "created", `Employee #${employeeId}`);
  return contract;
}

async function updateContract(db, id, data) {
  const sets = []; const params = []; let idx = 0;
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && ["title", "body_html", "status", "expires_at"].includes(key)) {
      idx++; sets.push(`${key} = $${idx}`); params.push(val);
    }
  }
  if (!sets.length) return null;
  idx++; params.push(id);
  sets.push("updated_at = NOW()");
  const { rows: [contract] } = await db.query(
    `UPDATE contracts SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
  );
  return contract;
}

async function sendContract(db, contractId) {
  const { rows: [contract] } = await db.query(
    "UPDATE contracts SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'draft' RETURNING *",
    [contractId]
  );
  if (!contract) throw Object.assign(new Error("Contract not found or already sent"), { statusCode: 400 });
  await logContractEvent(db, contractId, "sent", "system");
  return contract;
}

async function signContract(db, contractId, signerId, signatureData, ipAddress) {
  // Update signer
  const { rows: [signer] } = await db.query(
    `UPDATE contract_signers SET status = 'signed', signed_at = NOW(), signature_data = $3, ip_address = $4
     WHERE id = $2 AND contract_id = $1 AND status = 'pending' RETURNING *`,
    [contractId, signerId, signatureData, ipAddress || null]
  );
  if (!signer) throw Object.assign(new Error("Signer not found or already signed"), { statusCode: 400 });

  await logContractEvent(db, contractId, "signed", signer.name, { signer_id: signerId });

  // Check if all signers signed
  const { rows: pending } = await db.query(
    "SELECT id FROM contract_signers WHERE contract_id = $1 AND status = 'pending'",
    [contractId]
  );
  if (!pending.length) {
    await db.query(
      "UPDATE contracts SET status = 'signed', signed_at = NOW(), updated_at = NOW() WHERE id = $1",
      [contractId]
    );
  }

  return signer;
}

async function getContract(db, id) {
  const { rows: [contract] } = await db.query(
    `SELECT c.*, ct.name AS template_name, cust.name AS customer_name
     FROM contracts c
     LEFT JOIN contract_templates ct ON ct.id = c.template_id
     LEFT JOIN customers cust ON cust.id = c.customer_id
     WHERE c.id = $1`,
    [id]
  );
  if (!contract) return null;

  const { rows: signers } = await db.query(
    "SELECT * FROM contract_signers WHERE contract_id = $1 ORDER BY id",
    [id]
  );
  const { rows: events } = await db.query(
    "SELECT * FROM contract_events WHERE contract_id = $1 ORDER BY created_at DESC",
    [id]
  );

  return { ...contract, signers, events };
}

async function logContractEvent(db, contractId, eventType, actor, metadata = {}) {
  await db.query(
    "INSERT INTO contract_events (contract_id, event_type, actor, metadata) VALUES ($1, $2, $3, $4)",
    [contractId, eventType, actor, JSON.stringify(metadata)]
  );
}

module.exports = {
  createContract, updateContract, sendContract, signContract, getContract,
  logContractEvent,
};
