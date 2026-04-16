import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Modal, ModalFooter } from "../../ui/primitives";
import { Plus, Send, Clock, Eye, Pencil, Trash2, X } from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";
import { api } from "../../api";

const STATUS_TONES = { draft: "default", scheduled: "warning", sending: "warning", sent: "success", partial: "warning", failed: "danger" };
const FILTER_TYPES = [
  { value: "group", label: "Customer Group" },
  { value: "tag", label: "Tag" },
  { value: "loyalty_tier", label: "Loyalty Tier" },
  { value: "city", label: "City" },
  { value: "birth_month", label: "Birth Month" },
  { value: "last_purchase_days", label: "Last Purchase (days)" },
  { value: "min_spend", label: "Min Total Spend" },
  { value: "max_spend", label: "Max Total Spend" },
  { value: "has_email", label: "Has Email + Consent" },
  { value: "has_mobile", label: "Has Mobile + Consent" },
];

export default function MarketingCampaignsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [tab, setTab] = useState("campaigns");
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  // Campaign composer
  const [showComposer, setShowComposer] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [form, setForm] = useState({ name: "", subject: "", body_html: "", template_id: "", audience_filters: [] });
  const [audiencePreview, setAudiencePreview] = useState(null);
  const [saving, setSaving] = useState(false);

  // Template modal
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: "", subject: "", body_html: "" });
  const [editingTemplate, setEditingTemplate] = useState(null);

  // Schedule modal
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleCampaignId, setScheduleCampaignId] = useState(null);
  const [scheduleDate, setScheduleDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [c, t] = await Promise.all([
      api.get("/api/marketing/campaigns").catch(() => ({ campaigns: [] })),
      api.get("/api/marketing/templates").catch(() => ({ templates: [] })),
    ]);
    setCampaigns(c.campaigns || []);
    setTemplates(t.templates || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!flagsLoading && !flags.marketing_campaigns) return <Navigate to="/dashboard" replace />;

  const previewAudience = async (filters) => {
    try {
      const result = await api.get(`/api/marketing/audiences/preview?filters=${encodeURIComponent(JSON.stringify(filters))}`);
      setAudiencePreview(result);
    } catch { setAudiencePreview(null); }
  };

  const addFilter = () => {
    const updated = [...form.audience_filters, { filter_type: "has_email", filter_value: "true" }];
    setForm({ ...form, audience_filters: updated });
    previewAudience(updated);
  };

  const updateFilter = (idx, field, value) => {
    const updated = form.audience_filters.map((f, i) => i === idx ? { ...f, [field]: value } : f);
    setForm({ ...form, audience_filters: updated });
    previewAudience(updated);
  };

  const removeFilter = (idx) => {
    const updated = form.audience_filters.filter((_, i) => i !== idx);
    setForm({ ...form, audience_filters: updated });
    previewAudience(updated);
  };

  const saveCampaign = async () => {
    setSaving(true);
    try {
      const body = { ...form, template_id: form.template_id ? Number(form.template_id) : undefined };
      if (editingCampaign) {
        await api.put(`/api/marketing/campaigns/${editingCampaign.id}`, body);
        toast.success("Campaign updated");
      } else {
        await api.post("/api/marketing/campaigns", body);
        toast.success("Campaign created");
      }
      setShowComposer(false);
      load();
    } catch (err) {
      toast.error(err.message || "Failed to save campaign");
    }
    setSaving(false);
  };

  const sendCampaign = async (id) => {
    try {
      const result = await api.post(`/api/marketing/campaigns/${id}/send`);
      toast.success(`Campaign sending to ${result.recipientCount} recipients`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const sendTestEmail = async (id) => {
    try {
      const result = await api.post(`/api/marketing/campaigns/${id}/send-test`);
      toast.success(`Test email sent to ${result.sent_to}`);
    } catch (err) { toast.error(err.message); }
  };

  const scheduleCampaign = async () => {
    if (!scheduleDate) return;
    try {
      await api.post(`/api/marketing/campaigns/${scheduleCampaignId}/schedule`, { scheduled_at: new Date(scheduleDate).toISOString() });
      toast.success("Campaign scheduled");
      setShowScheduleModal(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const saveTemplate = async () => {
    try {
      if (editingTemplate) {
        await api.put(`/api/marketing/templates/${editingTemplate.id}`, templateForm);
        toast.success("Template updated");
      } else {
        await api.post("/api/marketing/templates", templateForm);
        toast.success("Template created");
      }
      setShowTemplateModal(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const deleteTemplate = async (id) => {
    try {
      await api.del(`/api/marketing/templates/${id}`);
      toast.success("Template deleted");
      load();
    } catch (err) { toast.error(err.message); }
  };

  const openComposer = (campaign = null) => {
    setEditingCampaign(campaign);
    setForm(campaign ? {
      name: campaign.name, subject: campaign.subject || "", body_html: campaign.body_html || "",
      template_id: campaign.template_id || "", audience_filters: [],
    } : { name: "", subject: "", body_html: "", template_id: "", audience_filters: [] });
    setAudiencePreview(null);
    setShowComposer(true);
  };

  return (
    <PageShell title="Marketing Campaigns" right={
      <div className="flex gap-2">
        <Button onClick={() => setTab(tab === "campaigns" ? "templates" : "campaigns")} tone="plain">
          {tab === "campaigns" ? "Templates" : "Campaigns"}
        </Button>
        {tab === "campaigns" && <Button onClick={() => openComposer()}><Plus className="w-4 h-4 mr-1" />New Campaign</Button>}
        {tab === "templates" && <Button onClick={() => { setEditingTemplate(null); setTemplateForm({ name: "", subject: "", body_html: "" }); setShowTemplateModal(true); }}><Plus className="w-4 h-4 mr-1" />New Template</Button>}
      </div>
    }>
      {loading ? <SectionCard><p className="text-(--ui-text-muted)">Loading...</p></SectionCard> : tab === "campaigns" ? (
        <SectionCard>
          {campaigns.length === 0 ? <p className="text-(--ui-text-muted) text-center py-8">No campaigns yet. Create your first campaign to start reaching customers.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-(--ui-border)">
                  <th className="text-left py-2 px-3 font-medium">Name</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                  <th className="text-right py-2 px-3 font-medium">Sent</th>
                  <th className="text-right py-2 px-3 font-medium">Failed</th>
                  <th className="text-left py-2 px-3 font-medium">Created</th>
                  <th className="text-right py-2 px-3 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-(--ui-border) hover:bg-(--ui-bg-hover)">
                      <td className="py-2 px-3 font-medium">{c.name}</td>
                      <td className="py-2 px-3"><Badge tone={STATUS_TONES[c.status] || "default"}>{c.status}</Badge></td>
                      <td className="py-2 px-3 text-right">{c.sent_count || 0}</td>
                      <td className="py-2 px-3 text-right">{c.failed_count || 0}</td>
                      <td className="py-2 px-3 text-(--ui-text-muted)">{fmtUtcDateTime(c.created_at)}</td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex gap-1 justify-end">
                          {c.status === "draft" && <>
                            <Button tone="plain" size="sm" iconOnly onClick={() => openComposer(c)} title="Edit" aria-label="Edit"><Pencil className="w-4 h-4" /></Button>
                            <Button tone="plain" size="sm" iconOnly onClick={() => sendTestEmail(c.id)} title="Send test" aria-label="Send test"><Eye className="w-4 h-4" /></Button>
                            {/* Intentional green tint — "Send now" is the primary CTA on a draft row. */}
                            <Button tone="plain" size="sm" iconOnly onClick={() => sendCampaign(c.id)} title="Send now" aria-label="Send now" className="text-green-600"><Send className="w-4 h-4" /></Button>
                            <Button tone="plain" size="sm" iconOnly onClick={() => { setScheduleCampaignId(c.id); setScheduleDate(""); setShowScheduleModal(true); }} title="Schedule" aria-label="Schedule"><Clock className="w-4 h-4" /></Button>
                          </>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard>
          {templates.length === 0 ? <p className="text-(--ui-text-muted) text-center py-8">No templates yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-(--ui-border)">
                  <th className="text-left py-2 px-3 font-medium">Name</th>
                  <th className="text-left py-2 px-3 font-medium">Channel</th>
                  <th className="text-left py-2 px-3 font-medium">Subject</th>
                  <th className="text-right py-2 px-3 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} className="border-b border-(--ui-border) hover:bg-(--ui-bg-hover)">
                      <td className="py-2 px-3 font-medium">{t.name}</td>
                      <td className="py-2 px-3"><Badge>{t.channel}</Badge></td>
                      <td className="py-2 px-3 text-(--ui-text-muted)">{t.subject || "—"}</td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <Button tone="plain" size="sm" iconOnly onClick={() => { setEditingTemplate(t); setTemplateForm({ name: t.name, subject: t.subject || "", body_html: t.body_html || "" }); setShowTemplateModal(true); }} title="Edit" aria-label="Edit"><Pencil className="w-4 h-4" /></Button>
                          <Button tone="plain" size="sm" iconOnly onClick={() => deleteTemplate(t.id)} title="Delete" aria-label="Delete" className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Campaign Composer Modal */}
      <Modal
        open={showComposer}
        onClose={saving ? undefined : () => setShowComposer(false)}
        title={editingCampaign ? "Edit Campaign" : "New Campaign"}
        size="xl"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Campaign Name</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Subject Line</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Template (optional)</label>
            <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
              <option value="">— None —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Body HTML</label>
            <textarea className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) min-h-[120px] font-mono text-sm" value={form.body_html} onChange={(e) => setForm({ ...form, body_html: e.target.value })} />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Audience Filters</label>
              <Button size="sm" tone="plain" onClick={addFilter}><Plus className="w-3 h-3 mr-1" />Add Filter</Button>
            </div>
            {form.audience_filters.map((f, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select className="border border-(--ui-border) rounded px-2 py-1 bg-(--ui-bg) text-sm" value={f.filter_type} onChange={(e) => updateFilter(i, "filter_type", e.target.value)}>
                  {FILTER_TYPES.map((ft) => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
                </select>
                {!["has_email", "has_mobile"].includes(f.filter_type) && (
                  <input className="border border-(--ui-border) rounded px-2 py-1 bg-(--ui-bg) text-sm grow" value={f.filter_value} onChange={(e) => updateFilter(i, "filter_value", e.target.value)} placeholder="Value" />
                )}
                <Button tone="plain" size="sm" iconOnly onClick={() => removeFilter(i)} aria-label="Remove filter" className="text-red-500"><X className="w-4 h-4" /></Button>
              </div>
            ))}
            {audiencePreview && (
              <p className="text-sm text-(--ui-text-muted) mt-1">
                <strong>{audiencePreview.count}</strong> customer{audiencePreview.count !== 1 ? "s" : ""} match
              </p>
            )}
          </div>
        </div>
        <ModalFooter>
          <Button onClick={() => setShowComposer(false)} disabled={saving}>Cancel</Button>
          <Button tone="primary" onClick={saveCampaign} disabled={saving || !form.name}>
            {saving ? "Saving..." : "Save Campaign"}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Template Modal */}
      <Modal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        title={editingTemplate ? "Edit Template" : "New Template"}
        size="lg"
      >
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Name</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} /></div>
          <div><label className="block text-sm font-medium mb-1">Subject</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={templateForm.subject} onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })} /></div>
          <div><label className="block text-sm font-medium mb-1">Body HTML</label>
            <textarea className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) min-h-[100px] font-mono text-sm" value={templateForm.body_html} onChange={(e) => setTemplateForm({ ...templateForm, body_html: e.target.value })} /></div>
        </div>
        <ModalFooter>
          <Button onClick={() => setShowTemplateModal(false)}>Cancel</Button>
          <Button tone="primary" onClick={saveTemplate} disabled={!templateForm.name}>Save</Button>
        </ModalFooter>
      </Modal>

      {/* Schedule Modal */}
      <Modal
        open={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        title="Schedule Campaign"
        size="sm"
      >
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Send at</label>
          <input type="datetime-local" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
        </div>
        <ModalFooter>
          <Button onClick={() => setShowScheduleModal(false)}>Cancel</Button>
          <Button tone="primary" onClick={scheduleCampaign} disabled={!scheduleDate}>Schedule</Button>
        </ModalFooter>
      </Modal>
    </PageShell>
  );
}
