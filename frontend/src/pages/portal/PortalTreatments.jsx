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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await portalApi.get(tenantSlug, "/api/portal/me/treatment-plans");
      setPlans(res.plans || []);
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
    try {
      const d = await portalApi.get(tenantSlug, `/api/portal/me/treatment-plans/${planId}`);
      setDetail(d);
    } catch (err) {
      setError(err.message || "Failed to load plan detail");
    }
  }

  if (loading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  if (selected && detail) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button onClick={() => { setSelected(null); setDetail(null); }} className="text-sm text-blue-600 mb-4">
          ← Back to plans
        </button>
        <h1 className="text-2xl font-bold mb-2">{detail.plan.title}</h1>
        <div className="text-sm text-slate-600 mb-6">
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
                        <span className="ml-2 text-xs text-slate-500">[{s.status}]</span>
                      </div>
                      <div className="text-sm text-slate-600">{fmtDateTime(s.scheduled_at)}</div>
                      {s.provider_name && <div className="text-xs text-slate-500">Dr. {s.provider_name}</div>}
                      {s.soap_subjective && (
                        <div className="text-sm mt-2 text-slate-700 bg-slate-50 rounded p-2">{s.soap_subjective}</div>
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
                    {p.medication_name} {p.strength && <span className="text-slate-600">{p.strength}</span>}
                  </div>
                  <div className="text-slate-600">
                    {p.dosage && <>Dose: {p.dosage}. </>}
                    {p.frequency && <>Frequency: {p.frequency}. </>}
                    {p.duration && <>Duration: {p.duration}.</>}
                  </div>
                  {p.instructions && <div className="text-xs text-slate-500">{p.instructions}</div>}
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
                <tr className="text-left border-b text-slate-600">
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
                    <td className="text-slate-600">{c.notes || "—"}</td>
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
                  <div className="text-xs text-slate-500">
                    {l.lab_vendor || "—"} · {l.status}
                    {l.result_received_at && <> · Received {fmtDateTime(l.result_received_at)}</>}
                  </div>
                  {l.result_summary && <div className="text-sm mt-1 bg-slate-50 rounded p-2">{l.result_summary}</div>}
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
                  <div className="text-xs text-slate-500">
                    Signed by {c.signed_by_name} ({c.signed_by_relation}) on {fmtDateTime(c.signed_at)}
                  </div>
                  {c.document_pdf_url && (
                    <a href={c.document_pdf_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs">
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
                  <a href={d.file_url} target="_blank" rel="noreferrer" className="text-blue-600 font-medium">
                    {d.title}
                  </a>
                  <span className="text-xs text-slate-500 ml-2">[{d.document_type}]</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {detail.plan.invoice_number && (
          <Section title="Invoice">
            <div className="text-sm">
              <div>Invoice <span className="font-mono">{detail.plan.invoice_number}</span></div>
              {detail.plan.balance_due > 0 && (
                <div className="text-red-600">Balance due: {detail.plan.balance_due}</div>
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
      {plans.length === 0 ? (
        <div className="text-sm text-slate-500">No treatment plans on file.</div>
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.id} className="p-4 border rounded-lg hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(p.id)}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold">{p.title}</div>
                  <div className="text-xs text-slate-500">
                    <span className="font-mono">{p.plan_number}</span>
                    {p.subject_name && <> · {p.subject_name}</>}
                    {p.provider_name && <> · Dr. {p.provider_name}</>}
                  </div>
                </div>
                <div className="text-sm text-right">
                  <div className="text-slate-600">{p.sessions_completed || 0} / {p.total_sessions_planned} sessions</div>
                  <div className="text-xs text-slate-500 uppercase">{p.status}</div>
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
      <div className="bg-white rounded-lg border border-slate-200 p-4">{children}</div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="text-sm text-slate-400 italic">{children}</div>;
}
