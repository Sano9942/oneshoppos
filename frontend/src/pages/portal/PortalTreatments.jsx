import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

function fmtDateTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function PortalTreatments() {
  const { tenantSlug } = useParams();
  const [plans, setPlans] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [handouts, setHandouts] = useState([]); // V05 — docs shared by the clinic
  const [vaxCard, setVaxCard] = useState(null); // V05 — per-pet vaccination card
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await portalApi.get(tenantSlug, "/api/portal/me/treatment-plans");
      setPlans(res.plans || []);
      // Non-fatal — the handouts endpoint may be feature-gated off.
      try {
        const h = await portalApi.get(tenantSlug, "/api/portal/me/handouts");
        setHandouts(h.handouts || []);
      } catch { /* section simply hidden */ }
    } catch (err) {
      setError(err.message || "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantSlug]);

  async function openDetail(planId) {
    setSelected(planId);
    setDetail(null);
    setVaxCard(null);
    try {
      const d = await portalApi.get(tenantSlug, `/api/portal/me/treatment-plans/${planId}`);
      setDetail(d);
      // V05 — vaccination card for pet subjects (read-only, owner-scoped)
      if (d?.plan?.subject_type === "pet" && d?.plan?.subject_id) {
        try {
          const card = await portalApi.get(tenantSlug, `/api/portal/me/subjects/${d.plan.subject_id}/vaccination-card`);
          if (card?.records?.length) setVaxCard(card);
        } catch { /* section simply hidden */ }
      }
    } catch (err) {
      setError(err.message || "Failed to load plan detail");
    }
  }

  if (loading) return <div className="p-6 text-(--ui-text-muted)">Loading…</div>;
  if (error) return <div className="p-6 text-(--ui-danger-fg)">{error}</div>;

  if (selected && detail) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button onClick={() => { setSelected(null); setDetail(null); }} className="text-sm text-(--ui-link) mb-4">
          ← Back to plans
        </button>
        <h1 className="text-2xl font-bold mb-2">{detail.plan.title}</h1>
        <div className="text-sm text-(--ui-text-muted) mb-6">
          <span className="font-mono">{detail.plan.plan_number}</span>
          {detail.plan.subject_name && <> · {detail.plan.subject_name}</>}
          {detail.plan.provider_name && <> · Dr. {detail.plan.provider_name}</>}
          · Status: <strong>{detail.plan.status}</strong>
          · Progress: {detail.plan.sessions_completed || 0} / {detail.plan.total_sessions_planned}
        </div>

        <Section title="Sessions">
          {detail.sessions.length === 0 ? (
            <Empty>No sessions yet</Empty>
          ) : (
            <ul className="divide-y">
              {detail.sessions.map((s) => (
                <li key={s.id} className="py-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">
                        Session #{s.session_number}
                        <span className="ml-2 text-xs text-(--ui-text-muted)">[{s.status}]</span>
                      </div>
                      <div className="text-sm text-(--ui-text-muted)">{fmtDateTime(s.scheduled_at)}</div>
                      {s.provider_name && <div className="text-xs text-(--ui-text-muted)">Dr. {s.provider_name}</div>}
                      {s.soap_subjective && (
                        <div className="text-sm mt-2 text-(--ui-text) bg-(--ui-muted-surface) rounded p-2">{s.soap_subjective}</div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Prescriptions">
          {detail.prescriptions.length === 0 ? (
            <Empty>No prescriptions</Empty>
          ) : (
            <ul className="divide-y">
              {detail.prescriptions.map((p) => (
                <li key={p.id} className="py-2 text-sm">
                  <div className="font-medium">
                    {p.medication_name} {p.strength && <span className="text-(--ui-text-muted)">{p.strength}</span>}
                  </div>
                  <div className="text-(--ui-text-muted)">
                    {p.dosage && <>Dose: {p.dosage}. </>}
                    {p.frequency && <>Frequency: {p.frequency}. </>}
                    {p.duration && <>Duration: {p.duration}.</>}
                  </div>
                  {p.instructions && <div className="text-xs text-(--ui-text-muted)">{p.instructions}</div>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Chart">
          {detail.chart_entries.length === 0 ? (
            <Empty>No chart entries</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b text-(--ui-text-muted)">
                  <th className="py-2">Area</th>
                  <th>Condition</th>
                  <th>Severity</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {detail.chart_entries.map((c, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2 font-mono">{c.area_code}</td>
                    <td>{c.condition_code}</td>
                    <td>{c.severity || "—"}</td>
                    <td className="text-(--ui-text-muted)">{c.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Lab Results">
          {detail.lab_orders.length === 0 ? (
            <Empty>No lab results shared</Empty>
          ) : (
            <ul className="divide-y">
              {detail.lab_orders.map((l) => (
                <li key={l.id} className="py-2 text-sm">
                  <div className="font-medium">{l.test_name}</div>
                  <div className="text-xs text-(--ui-text-muted)">
                    {l.lab_vendor || "—"} · {l.status}
                    {l.result_received_at && <> · Received {fmtDateTime(l.result_received_at)}</>}
                  </div>
                  {l.result_summary && <div className="text-sm mt-1 bg-(--ui-muted-surface) rounded p-2">{l.result_summary}</div>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Consent Documents">
          {detail.consents.length === 0 ? (
            <Empty>No consents on file</Empty>
          ) : (
            <ul className="divide-y">
              {detail.consents.map((c) => (
                <li key={c.id} className="py-2 text-sm">
                  <div className="font-medium">{c.title}</div>
                  <div className="text-xs text-(--ui-text-muted)">
                    Signed by {c.signed_by_name} ({c.signed_by_relation}) on {fmtDateTime(c.signed_at)}
                  </div>
                  {c.document_pdf_url && (
                    <a href={c.document_pdf_url} target="_blank" rel="noreferrer" className="text-(--ui-link) text-xs">
                      Download PDF
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {detail.documents.length > 0 && (
          <Section title="Shared Documents">
            <ul className="divide-y">
              {detail.documents.map((d) => (
                <li key={d.id} className="py-2 text-sm">
                  <a href={d.file_url} target="_blank" rel="noreferrer" className="text-(--ui-link) font-medium">
                    {d.title}
                  </a>
                  <span className="text-xs text-(--ui-text-muted) ml-2">[{d.document_type}]</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {vaxCard && (
          <Section title={`Vaccination card — ${vaxCard.subject?.name || ""}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-(--ui-text-muted) border-b">
                  <th className="py-1.5">Date</th>
                  <th>Vaccine</th>
                  <th>Batch</th>
                  <th>Next due</th>
                </tr>
              </thead>
              <tbody>
                {vaxCard.records.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5 text-xs">{r.administered_at}</td>
                    <td className="font-medium">{r.vaccine_name}</td>
                    <td className="text-xs text-(--ui-text-muted)">{r.batch_number || "—"}</td>
                    <td className="text-xs">{r.next_due || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {detail.plan.invoice_number && (
          <Section title="Invoice">
            <div className="text-sm">
              <div>Invoice <span className="font-mono">{detail.plan.invoice_number}</span></div>
              {detail.plan.balance_due > 0 && (
                <div className="text-(--ui-danger-fg)">Balance due: {detail.plan.balance_due}</div>
              )}
            </div>
          </Section>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">My Treatment Plans</h1>
      {handouts.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Documents from your clinic</h2>
          <ul className="bg-(--ui-surface) rounded-lg border border-(--ui-border) divide-y divide-(--ui-border)">
            {handouts.map((h) => (
              <li key={h.id} className="p-3 text-sm flex justify-between items-center gap-3">
                <div>
                  <a href={h.file_url} target="_blank" rel="noreferrer" className="text-(--ui-link) font-medium">
                    {h.title}
                  </a>
                  {h.subject_name && <span className="text-xs text-(--ui-text-muted) ml-2">for {h.subject_name}</span>}
                </div>
                <span className="text-xs text-(--ui-text-muted)">{fmtDateTime(h.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plans.length === 0 ? (
        <div className="text-sm text-(--ui-text-muted)">No treatment plans on file.</div>
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.id} className="p-4 border rounded-lg hover:bg-(--ui-muted-surface) cursor-pointer" onClick={() => openDetail(p.id)}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold">{p.title}</div>
                  <div className="text-xs text-(--ui-text-muted)">
                    <span className="font-mono">{p.plan_number}</span>
                    {p.subject_name && <> · {p.subject_name}</>}
                    {p.provider_name && <> · Dr. {p.provider_name}</>}
                  </div>
                </div>
                <div className="text-sm text-right">
                  <div className="text-(--ui-text-muted)">{p.sessions_completed || 0} / {p.total_sessions_planned} sessions</div>
                  <div className="text-xs text-(--ui-text-muted) uppercase">{p.status}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="bg-(--ui-surface) rounded-lg border border-(--ui-border) p-4">{children}</div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="text-sm text-(--ui-text-muted) italic">{children}</div>;
}
