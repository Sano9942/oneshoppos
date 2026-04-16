import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Modal, ModalFooter, TabBar } from "../../ui/primitives";
import { Plus, Shield, Tag } from "lucide-react";
import { api } from "../../api";

export default function ReturnPoliciesRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [policies, setPolicies] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("policies");
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [editPolicy, setEditPolicy] = useState(null);
  const [editReason, setEditReason] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get("/api/return-policies").catch(() => ({ policies: [] })),
      api.get("/api/return-reasons").catch(() => ({ reasons: [] })),
    ]).then(([p, r]) => {
      setPolicies(p.policies || []);
      setReasons(r.reasons || []);
      setLoading(false);
    });
  }, []);

  const handleSavePolicy = async (data) => {
    try {
      if (editPolicy) {
        const res = await api.put(`/api/return-policies/${editPolicy.id}`, data);
        setPolicies(prev => prev.map(p => p.id === editPolicy.id ? res.policy : p));
        toast.success("Policy updated");
      } else {
        const res = await api.post("/api/return-policies", data);
        setPolicies(prev => [...prev, res.policy]);
        toast.success("Policy created");
      }
      setShowPolicyModal(false);
      setEditPolicy(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSaveReason = async (data) => {
    try {
      if (editReason) {
        const res = await api.put(`/api/return-reasons/${editReason.id}`, data);
        setReasons(prev => prev.map(r => r.id === editReason.id ? res.reason : r));
        toast.success("Reason updated");
      } else {
        const res = await api.post("/api/return-reasons", data);
        setReasons(prev => [...prev, res.reason]);
        toast.success("Reason created");
      }
      setShowReasonModal(false);
      setEditReason(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (flagsLoading) return null;
  if (!flags.phase2_returns_policy) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Return Policies"
      subtitle="Configure return windows, restocking fees, and structured return reasons"
      right={
        <Button size="sm" onClick={() => {
          if (tab === "policies") { setEditPolicy(null); setShowPolicyModal(true); }
          else { setEditReason(null); setShowReasonModal(true); }
        }}>
          <Plus className="h-4 w-4 mr-1" /> {tab === "policies" ? "New Policy" : "New Reason"}
        </Button>
      }
    >
      <div className="mb-4">
        <TabBar
          value={tab}
          onChange={setTab}
          tabs={[{ value: "policies", label: "Policies" }, { value: "reasons", label: "Return Reasons" }]}
        />
      </div>

      <SectionCard>
        {loading ? (
          <div className="py-12 text-center text-sm text-(--ui-text-muted)">Loading…</div>
        ) : tab === "policies" ? (
          policies.length === 0 ? (
            <div className="py-12 text-center text-sm text-(--ui-text-muted)">No return policies configured</div>
          ) : (
            <div className="divide-y divide-(--ui-border)">
              {policies.map(p => (
                <div key={p.id} className="px-4 py-3 flex items-center justify-between hover:bg-(--ui-bg-hover) cursor-pointer"
                  onClick={() => { setEditPolicy(p); setShowPolicyModal(true); }}>
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      <Shield className="h-4 w-4 text-(--ui-text-muted)" />
                      {p.name}
                      {p.is_default && <Badge tone="success">Default</Badge>}
                    </div>
                    <div className="text-xs text-(--ui-text-muted) mt-0.5">
                      {p.return_window_days ? `${p.return_window_days}-day window` : "No time limit"}
                      {p.receipt_required && " · Receipt required"}
                      {Number(p.restocking_fee_percent) > 0 && ` · ${p.restocking_fee_percent}% restocking fee`}
                    </div>
                  </div>
                  <div className="text-xs text-(--ui-text-muted)">
                    {(p.allowed_refund_methods || []).join(", ")}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          reasons.length === 0 ? (
            <div className="py-12 text-center text-sm text-(--ui-text-muted)">No return reasons configured</div>
          ) : (
            <div className="divide-y divide-(--ui-border)">
              {reasons.map(r => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between hover:bg-(--ui-bg-hover) cursor-pointer"
                  onClick={() => { setEditReason(r); setShowReasonModal(true); }}>
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      <Tag className="h-4 w-4 text-(--ui-text-muted)" />
                      {r.label}
                      <span className="text-xs text-(--ui-text-muted)">({r.code})</span>
                    </div>
                    {r.requires_note && <div className="text-xs text-amber-600">Requires note</div>}
                  </div>
                  <div className="text-xs text-(--ui-text-muted)">Order: {r.sort_order}</div>
                </div>
              ))}
            </div>
          )
        )}
      </SectionCard>

      <PolicyModal
        open={showPolicyModal}
        policy={editPolicy}
        onSave={handleSavePolicy}
        onClose={() => { setShowPolicyModal(false); setEditPolicy(null); }}
      />
      <ReasonModal
        open={showReasonModal}
        reason={editReason}
        onSave={handleSaveReason}
        onClose={() => { setShowReasonModal(false); setEditReason(null); }}
      />
    </PageShell>
  );
}

function PolicyModal({ open, policy, onSave, onClose }) {
  const [form, setForm] = useState({
    name: policy?.name || "",
    return_window_days: policy?.return_window_days ?? "",
    receipt_required: policy?.receipt_required !== false,
    restocking_fee_percent: policy?.restocking_fee_percent || 0,
    is_default: policy?.is_default || false,
  });
  useEffect(() => {
    setForm({
      name: policy?.name || "",
      return_window_days: policy?.return_window_days ?? "",
      receipt_required: policy?.receipt_required !== false,
      restocking_fee_percent: policy?.restocking_fee_percent || 0,
      is_default: policy?.is_default || false,
    });
  }, [policy]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} title={policy ? "Edit Policy" : "New Return Policy"} size="md">
      <div className="space-y-3">
        <label className="block text-sm font-medium">Name
          <input value={form.name} onChange={e => set("name", e.target.value)}
            className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm font-medium">Return Window (days, blank=unlimited)
          <input type="number" value={form.return_window_days} onChange={e => set("return_window_days", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm font-medium">Restocking Fee (%)
          <input type="number" step="0.01" value={form.restocking_fee_percent} onChange={e => set("restocking_fee_percent", Number(e.target.value))}
            className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.receipt_required} onChange={e => set("receipt_required", e.target.checked)} />
          Receipt required
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_default} onChange={e => set("is_default", e.target.checked)} />
          Set as default policy
        </label>
      </div>
      <ModalFooter>
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button tone="primary" size="sm" onClick={() => onSave(form)}>Save</Button>
      </ModalFooter>
    </Modal>
  );
}

function ReasonModal({ open, reason, onSave, onClose }) {
  const [form, setForm] = useState({
    code: reason?.code || "",
    label: reason?.label || "",
    requires_note: reason?.requires_note || false,
    sort_order: reason?.sort_order || 0,
  });
  useEffect(() => {
    setForm({
      code: reason?.code || "",
      label: reason?.label || "",
      requires_note: reason?.requires_note || false,
      sort_order: reason?.sort_order || 0,
    });
  }, [reason]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} title={reason ? "Edit Reason" : "New Return Reason"} size="md">
      <div className="space-y-3">
        <label className="block text-sm font-medium">Code
          <input value={form.code} onChange={e => set("code", e.target.value)} placeholder="e.g. defective"
            className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm font-medium">Label
          <input value={form.label} onChange={e => set("label", e.target.value)} placeholder="e.g. Defective Product"
            className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm font-medium">Sort Order
          <input type="number" value={form.sort_order} onChange={e => set("sort_order", Number(e.target.value))}
            className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.requires_note} onChange={e => set("requires_note", e.target.checked)} />
          Requires note from staff
        </label>
      </div>
      <ModalFooter>
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button tone="primary" size="sm" onClick={() => onSave(form)}>Save</Button>
      </ModalFooter>
    </Modal>
  );
}
