import { useState, useEffect, useCallback, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Input, EmptyState } from "../../ui/primitives";
import { Plus, ArrowLeft, X, Send, FileText, Pen } from "lucide-react";
import { api } from "../../api";

const STATUS_TONES = { draft: "default", sent: "warning", viewed: "warning", signed: "success", expired: "danger", cancelled: "danger" };
const STATUSES = ["draft", "sent", "viewed", "signed", "expired", "cancelled"];

function fmtDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Renders admin-authored contract HTML in a sandboxed iframe.
 * Using srcdoc isolates the content from the parent DOM.
 */
function HtmlPreview({ html }) {
  if (!html) return <p className="text-sm text-(--ui-text-muted)">No contract body.</p>;
  const wrappedHtml = `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;margin:16px;}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      srcDoc={wrappedHtml}
      sandbox="allow-same-origin"
      title="Contract preview"
      className="w-full min-h-[300px] border border-(--ui-border) rounded-lg bg-(--ui-surface)"
      style={{ border: "none" }}
    />
  );
}

/* ---- Signature Pad ---- */
function SignaturePad({ onSave, onCancel }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e) => {
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDrawing(true);
  };

  const draw = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    setHasContent(true);
  };

  const endDraw = () => setDrawing(false);

  const clear = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasContent(false);
  };

  const save = () => {
    if (!hasContent) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onSave(dataUrl);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-(--ui-text-muted)">Draw your signature below:</p>
      <canvas
        ref={canvasRef}
        width={400}
        height={150}
        className="w-full border border-(--ui-border) rounded-lg bg-(--ui-surface) cursor-crosshair touch-none"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={clear}>Clear</Button>
        <Button size="sm" tone="primary" onClick={save} disabled={!hasContent}>Save Signature</Button>
        <Button size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/* ---- Create Contract Modal ---- */
function CreateContractModal({ customers, templates, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: "", customer_id: "", template_id: "", body: "", signers: "" });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // Apply template body when template selected
  const selectTemplate = (tid) => {
    set("template_id", tid);
    const tpl = templates.find(t => String(t.id) === String(tid));
    if (tpl && tpl.body) set("body", tpl.body);
  };

  const submit = async () => {
    if (!form.title.trim()) { toast.error("Contract title is required"); return; }
    setSaving(true);
    try {
      const signerList = form.signers.split(",").map(s => s.trim()).filter(Boolean).map(s => {
        // Accept "Name <email>" or just "email"
        const match = s.match(/^(.+?)\s*<(.+?)>$/);
        if (match) return { name: match[1].trim(), email: match[2].trim() };
        return { email: s };
      });
      await api.post("/api/contracts", {
        title: form.title,
        customer_id: form.customer_id ? Number(form.customer_id) : undefined,
        template_id: form.template_id ? Number(form.template_id) : undefined,
        body: form.body || undefined,
        signers: signerList.length > 0 ? signerList : undefined,
      });
      toast.success("Contract created");
      onCreated();
      onClose();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-(--ui-bg) border border-(--ui-border) rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-(--ui-text)">New Contract</h2>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Title *</label>
            <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Contract title" />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Customer</label>
            <select className="w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)" value={form.customer_id} onChange={e => set("customer_id", e.target.value)}>
              <option value="">-- Select --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Template</label>
            <select className="w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)" value={form.template_id} onChange={e => selectTemplate(e.target.value)}>
              <option value="">-- None --</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name || t.title}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Body (HTML)</label>
            <textarea className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text) font-mono" rows={6} value={form.body} onChange={e => set("body", e.target.value)} placeholder="<p>Contract terms...</p>" />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Signers (comma-separated emails or "Name &lt;email&gt;")</label>
            <Input value={form.signers} onChange={e => set("signers", e.target.value)} placeholder="john@example.com, Jane Doe <jane@example.com>" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={submit} disabled={saving}>{saving ? "Saving..." : "Create Contract"}</Button>
        </div>
      </div>
    </div>
  );
}

/* ---- Create Template Modal ---- */
function CreateTemplateModal({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", body: "" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Template name is required"); return; }
    setSaving(true);
    try {
      await api.post("/api/contract-templates", { name: form.name, body: form.body || undefined });
      toast.success("Template created");
      onCreated();
      onClose();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-(--ui-bg) border border-(--ui-border) rounded-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-(--ui-text)">New Template</h2>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Name *</label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Template name" />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Body (HTML)</label>
            <textarea className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text) font-mono" rows={8} value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} placeholder="<p>Standard contract terms...</p>" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={submit} disabled={saving}>{saving ? "Saving..." : "Create Template"}</Button>
        </div>
      </div>
    </div>
  );
}

/* ---- Contract Detail View ---- */
function ContractDetail({ contractId, onBack }) {
  const toast = useToast();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSign, setShowSign] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/contracts/${contractId}`);
      setContract(data.contract || data);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [contractId]);

  useEffect(() => { load(); }, [load]);

  const sendContract = async () => {
    try {
      await api.post(`/api/contracts/${contractId}/send`);
      toast.success("Contract sent");
      load();
    } catch (err) { toast.error(err.message); }
  };

  const signContract = async (signatureDataUrl) => {
    try {
      await api.post(`/api/contracts/${contractId}/sign`, {
        signature: signatureDataUrl,
        signer_name: signerName || undefined,
        signer_email: signerEmail || undefined,
      });
      toast.success("Contract signed");
      setShowSign(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  if (loading) return <div className="text-center py-12 text-(--ui-text-muted)">Loading...</div>;
  if (!contract) return <div className="text-center py-12 text-(--ui-text-muted)">Contract not found</div>;

  const signers = contract.signers || [];
  const events = contract.events || [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="text-(--ui-text-muted) hover:text-(--ui-text)"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-(--ui-text)">{contract.title}</h2>
          {contract.customer_name && <p className="text-sm text-(--ui-text-muted)">{contract.customer_name}</p>}
        </div>
        <Badge tone={STATUS_TONES[contract.status] || "default"}>{contract.status?.replace(/_/g, " ")}</Badge>
        <div className="flex gap-2">
          {contract.status === "draft" && (
            <Button size="sm" tone="primary" onClick={sendContract}><Send className="w-4 h-4 mr-1" /> Send</Button>
          )}
          {["draft", "sent", "viewed"].includes(contract.status) && (
            <Button size="sm" onClick={() => setShowSign(true)}><Pen className="w-4 h-4 mr-1" /> Sign</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Contract Body */}
        <div className="lg:col-span-2 space-y-4">
          <SectionCard className="p-4">
            <h3 className="text-sm font-semibold text-(--ui-text) mb-3">Contract Preview</h3>
            <HtmlPreview html={contract.body} />
          </SectionCard>

          {/* Sign section */}
          {showSign && (
            <SectionCard className="p-4">
              <h3 className="text-sm font-semibold text-(--ui-text) mb-3">Sign Contract</h3>
              <div className="space-y-3 mb-3">
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Your Name</label>
                  <Input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Full name" />
                </div>
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Your Email</label>
                  <Input type="email" value={signerEmail} onChange={e => setSignerEmail(e.target.value)} placeholder="email@example.com" />
                </div>
              </div>
              <SignaturePad onSave={signContract} onCancel={() => setShowSign(false)} />
            </SectionCard>
          )}
        </div>

        {/* Right: Signers + Events */}
        <div className="space-y-4">
          {/* Signers */}
          <SectionCard className="p-4">
            <h3 className="text-sm font-semibold text-(--ui-text) mb-3">Signers</h3>
            {signers.length === 0 ? (
              <p className="text-sm text-(--ui-text-muted)">No signers defined.</p>
            ) : (
              <div className="space-y-2">
                {signers.map((s, i) => (
                  <div key={s.id || i} className="flex items-center gap-2 p-2 rounded-lg border border-(--ui-border)">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-(--ui-text)">{s.name || s.signer_name || "Unnamed"}</p>
                      <p className="text-xs text-(--ui-text-muted)">{s.email || s.signer_email}</p>
                    </div>
                    <Badge tone={s.signed_at ? "success" : "default"}>{s.signed_at ? "Signed" : "Pending"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Audit Events */}
          <SectionCard className="p-4">
            <h3 className="text-sm font-semibold text-(--ui-text) mb-3">Audit Trail</h3>
            {events.length === 0 ? (
              <p className="text-sm text-(--ui-text-muted)">No events yet.</p>
            ) : (
              <div className="space-y-3">
                {events.map((ev, i) => (
                  <div key={ev.id || i} className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-(--ui-primary) mt-2 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="text-(--ui-text)">{ev.description || ev.event_type || ev.type}</p>
                      {ev.actor_name && <p className="text-xs text-(--ui-text-muted)">by {ev.actor_name}</p>}
                      <p className="text-xs text-(--ui-text-muted)">{fmtDateTime(ev.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/* ---- Main Component ---- */
export default function ContractsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [contracts, setContracts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("");

  const loadContracts = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/contracts";
      if (statusFilter) url += `?status=${statusFilter}`;
      const data = await api.get(url);
      setContracts(data.contracts || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [statusFilter]);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await api.get("/api/contract-templates");
      setTemplates(data.templates || []);
    } catch {}
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await api.get("/api/customers");
      setCustomers(data.customers || data || []);
    } catch {}
  }, []);

  useEffect(() => { loadContracts(); }, [loadContracts]);
  useEffect(() => { loadTemplates(); loadCustomers(); }, [loadTemplates, loadCustomers]);

  if (flagsLoading) return null;
  if (!flags.phase4_service_contracts) return <Navigate to="/dashboard" replace />;

  if (selectedId) {
    return (
      <PageShell title="Contracts" subtitle="Contract management">
        <ContractDetail contractId={selectedId} onBack={() => { setSelectedId(null); loadContracts(); }} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Contracts" subtitle="Contract management" right={
      <div className="flex gap-2">
        <Button onClick={() => setShowCreateTemplate(true)}><FileText className="w-4 h-4 mr-1" /> New Template</Button>
        <Button tone="primary" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" /> New Contract</Button>
      </div>
    }>
      {/* Filters */}
      <SectionCard className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Status</label>
            <select className="rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <Button size="sm" onClick={loadContracts}>Filter</Button>
        </div>
      </SectionCard>

      {/* Templates sidebar indicator */}
      {templates.length > 0 && (
        <SectionCard className="p-4 mb-4">
          <h3 className="text-sm font-semibold text-(--ui-text) mb-2">Templates ({templates.length})</h3>
          <div className="flex flex-wrap gap-2">
            {templates.map(t => (
              <span key={t.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-(--ui-border) text-xs text-(--ui-text-muted)">
                <FileText className="w-3 h-3" /> {t.name || t.title}
              </span>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Contract List */}
      <SectionCard>
        {loading ? (
          <div className="text-center py-12 text-(--ui-text-muted)">Loading...</div>
        ) : contracts.length === 0 ? (
          <EmptyState title="No contracts found" body="Create a new contract to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                  <th className="pb-2 pr-4 pl-4 font-medium">Title</th>
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Created</th>
                  <th className="pb-2 pr-4 font-medium">Signers</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => {
                  const signerCount = c.signers?.length || c.signer_count || 0;
                  const signedCount = c.signers?.filter(s => s.signed_at).length || c.signed_count || 0;
                  return (
                    <tr key={c.id} className="border-b border-(--ui-border) hover:bg-(--ui-bg-hover) cursor-pointer" onClick={() => setSelectedId(c.id)}>
                      <td className="py-2.5 pr-4 pl-4 font-medium text-(--ui-text)">{c.title}</td>
                      <td className="py-2.5 pr-4 text-(--ui-text)">{c.customer_name || "-"}</td>
                      <td className="py-2.5 pr-4"><Badge tone={STATUS_TONES[c.status] || "default"}>{c.status}</Badge></td>
                      <td className="py-2.5 pr-4 text-xs text-(--ui-text-muted) whitespace-nowrap">{fmtDate(c.created_at)}</td>
                      <td className="py-2.5 pr-4 text-xs text-(--ui-text-muted)">{signerCount > 0 ? `${signedCount}/${signerCount} signed` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {showCreate && <CreateContractModal customers={customers} templates={templates} onClose={() => setShowCreate(false)} onCreated={loadContracts} />}
      {showCreateTemplate && <CreateTemplateModal onClose={() => setShowCreateTemplate(false)} onCreated={loadTemplates} />}
    </PageShell>
  );
}
