import { useState, useEffect, useCallback } from "react";
import { PageShell, SectionCard, Button, Input, Select } from "../../ui/primitives";
import { api } from "../../api";
import { useToast } from "../../contexts/ToastContext";
import { fmtUtcDateTime } from "../../utils/dates";
import { Bell, Plus, Trash2, Send, CheckCircle2, XCircle } from "lucide-react";

const CHANNELS = ["email", "sms", "whatsapp"];

const STATUS_STYLE = {
  sent: "text-(--ui-success-fg)",
  queued: "text-(--ui-text-muted)",
  skipped: "text-amber-500",
  failed: "text-(--ui-danger)",
};

export default function NotificationSettingsRedesign() {
  const { success, error } = useToast();
  const [status, setStatus] = useState(null);
  const [rules, setRules] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ event: "", channel: "email", template_key: "" });

  const loadAll = useCallback(async () => {
    try {
      const [s, r, l] = await Promise.all([
        api.get("/api/notification-settings/status"),
        api.get("/api/notification-settings/rules"),
        api.get("/api/notification-settings/log", { limit: 50 }),
      ]);
      setStatus(s);
      setRules(r.rules || []);
      setLog(l.log || []);
    } catch (err) {
      error(err.message || "Failed to load notification settings");
    }
    setLoading(false);
  }, [error]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const templateOptions = (channel) => {
    if (!status) return [];
    return channel === "email" ? status.available_templates.email : status.available_templates.sms;
  };

  // Toggle + template edits go through the PUT upsert (idempotent on event+channel)
  // since api.js exposes no patch method.
  const toggleRule = async (rule, enabled) => {
    try {
      const updated = await api.put("/api/notification-settings/rules", {
        event: rule.event, channel: rule.channel, template_key: rule.template_key, enabled,
      });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (err) {
      error(err.message || "Failed to update rule");
    }
  };

  const changeTemplate = async (rule, template_key) => {
    try {
      const updated = await api.put("/api/notification-settings/rules", {
        event: rule.event, channel: rule.channel, template_key, enabled: rule.enabled,
      });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (err) {
      error(err.message || "Failed to update template");
    }
  };

  const deleteRule = async (rule) => {
    try {
      await api.del(`/api/notification-settings/rules/${rule.id}`);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (err) {
      error(err.message || "Failed to delete rule");
    }
  };

  const addRule = async () => {
    if (!form.event.trim() || !form.template_key.trim()) {
      error("Event and template are required");
      return;
    }
    setAdding(true);
    try {
      const created = await api.put("/api/notification-settings/rules", {
        event: form.event.trim(),
        channel: form.channel,
        template_key: form.template_key.trim(),
        enabled: true,
      });
      setRules((prev) => {
        const without = prev.filter((r) => r.id !== created.id);
        return [...without, created];
      });
      setForm({ event: "", channel: "email", template_key: "" });
      success("Rule saved");
    } catch (err) {
      error(err.message || "Failed to add rule");
    }
    setAdding(false);
  };

  const runTest = async (channel) => {
    setTesting(channel);
    try {
      const res = await api.post("/api/notification-settings/test", { channel });
      if (res.success) success(`${channel.toUpperCase()} provider OK${res.message ? ` — ${res.message}` : ""}`);
      else error(`${channel.toUpperCase()} test failed: ${res.error || "not configured"}`);
    } catch (err) {
      error(err.message || "Test failed");
    }
    setTesting("");
  };

  if (loading) {
    return (
      <PageShell title="Customer Notifications">
        <div className="flex min-h-[30vh] items-center justify-center text-sm text-(--ui-text-muted)">Loading...</div>
      </PageShell>
    );
  }

  // Group rules by event for readability.
  const grouped = {};
  for (const r of rules) (grouped[r.event] = grouped[r.event] || []).push(r);
  const events = Object.keys(grouped).sort();

  return (
    <PageShell
      title="Customer Notifications"
      subtitle="Status-change messages sent to customers by SMS, email, or WhatsApp"
    >
      {/* Status + provider availability */}
      <SectionCard className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Bell size={18} className="text-(--ui-text-muted)" />
            <span className="text-sm font-medium text-(--ui-text)">
              Notifications are{" "}
              <span className={status?.enabled ? "text-(--ui-success-fg)" : "text-(--ui-warning-fg)"}>
                {status?.enabled ? "enabled" : "disabled"}
              </span>
            </span>
          </div>
          {!status?.enabled && (
            <span className="text-xs text-(--ui-text-muted)">
              Enable the <code>customer_notifications</code> feature to start dispatching. Rules below can be configured now.
            </span>
          )}
          <div className="ml-auto flex items-center gap-3 text-xs">
            {CHANNELS.map((ch) => (
              <span key={ch} className="flex items-center gap-1 text-(--ui-text-muted)">
                {status?.channels?.[ch] ? (
                  <CheckCircle2 size={14} className="text-(--ui-success-fg)" />
                ) : (
                  <XCircle size={14} className="text-(--ui-text-muted)" />
                )}
                {ch}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button tone="plain" size="sm" onClick={() => runTest("sms")} disabled={testing === "sms"}>
            <Send size={14} className="mr-1" /> Test SMS provider
          </Button>
          <Button tone="plain" size="sm" onClick={() => runTest("whatsapp")} disabled={testing === "whatsapp"}>
            <Send size={14} className="mr-1" /> Test WhatsApp
          </Button>
        </div>
      </SectionCard>

      {/* Rules */}
      <SectionCard className="mb-4">
        <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Notification rules</h3>
        {events.length === 0 && (
          <p className="text-sm text-(--ui-text-muted)">No rules configured yet.</p>
        )}
        {events.map((event) => (
          <div key={event} className="mb-4 last:mb-0">
            <div className="mb-1 font-mono text-xs text-(--ui-text-muted)">{event}</div>
            <div className="space-y-2">
              {grouped[event].map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-(--ui-border) p-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => toggleRule(rule, e.target.checked)}
                    />
                    <span className="w-20 font-medium text-(--ui-text)">{rule.channel}</span>
                  </label>
                  <Select
                    value={rule.template_key}
                    onChange={(e) => changeTemplate(rule, e.target.value)}
                    className="min-w-48"
                  >
                    {[...new Set([rule.template_key, ...templateOptions(rule.channel)])].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                  <Button tone="danger" size="sm" iconOnly onClick={() => deleteRule(rule)} className="ml-auto">
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Add rule */}
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-(--ui-border) pt-4">
          <div className="flex-1 min-w-48">
            <label className="mb-1 block text-xs text-(--ui-text-muted)">Event</label>
            <Input
              placeholder="e.g. ticket.status_changed:completed"
              value={form.event}
              onChange={(e) => setForm((f) => ({ ...f, event: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-(--ui-text-muted)">Channel</label>
            <Select
              value={form.channel}
              onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value, template_key: "" }))}
            >
              {CHANNELS.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-(--ui-text-muted)">Template</label>
            <Select
              value={form.template_key}
              onChange={(e) => setForm((f) => ({ ...f, template_key: e.target.value }))}
            >
              <option value="">Select…</option>
              {templateOptions(form.channel).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <Button tone="primary" onClick={addRule} disabled={adding}>
            <Plus size={14} className="mr-1" /> Add rule
          </Button>
        </div>
      </SectionCard>

      {/* Delivery log */}
      <SectionCard>
        <h3 className="mb-3 text-sm font-semibold text-(--ui-text)">Recent deliveries</h3>
        {log.length === 0 ? (
          <p className="text-sm text-(--ui-text-muted)">No notifications sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-(--ui-text-muted)">
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">Event</th>
                  <th className="py-1 pr-3">Channel</th>
                  <th className="py-1 pr-3">Recipient</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {log.map((row) => (
                  <tr key={row.id} className="border-t border-(--ui-border)">
                    <td className="py-1 pr-3 whitespace-nowrap text-(--ui-text-muted)">{fmtUtcDateTime(row.created_at)}</td>
                    <td className="py-1 pr-3 font-mono text-xs">{row.event}</td>
                    <td className="py-1 pr-3">{row.channel}</td>
                    <td className="py-1 pr-3">{row.recipient}</td>
                    <td className={`py-1 pr-3 font-medium ${STATUS_STYLE[row.status] || ""}`}>{row.status}</td>
                    <td className="py-1 pr-3 text-xs text-(--ui-text-muted)">{row.error || row.provider_ref || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}
