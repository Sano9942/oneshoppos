import { useEffect, useState, useCallback } from "react";
import { Award, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import {
  Button,
  Input,
  PageShell,
  SectionCard,
} from "../../ui/primitives";

// ── Tier Form Modal ──────────────────────────────────────────────────────────

const EMPTY = {
  name: "",
  min_spend: "",
  points_multiplier: "1.0",
  discount_percent: "0",
  benefits: "",
  color: "#8066FF",
  sort_order: "",
};

function TierModal({ open, editing, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const { error: toastError, success } = useToast();

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? {
              name: editing.name || "",
              min_spend: String(editing.min_spend ?? ""),
              points_multiplier: String(editing.points_multiplier ?? "1.0"),
              discount_percent: String(editing.discount_percent ?? "0"),
              benefits: editing.benefits || "",
              color: editing.color || "#8066FF",
              sort_order: String(editing.sort_order ?? ""),
            }
          : EMPTY,
      );
    }
  }, [open, editing]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!form.name.trim()) return toastError("Tier name is required");
    const spend = parseFloat(form.min_spend);
    if (isNaN(spend) || spend < 0) return toastError("Min spend must be non-negative");

    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        min_spend: spend,
        points_multiplier: parseFloat(form.points_multiplier) || 1.0,
        discount_percent: parseFloat(form.discount_percent) || 0,
        benefits: form.benefits.trim() || null,
        color: form.color || null,
        sort_order: parseInt(form.sort_order) || 0,
      };
      if (editing) {
        await api.put(`/loyalty/tiers/${editing.id}`, body);
        success("Tier updated");
      } else {
        await api.post("/api/loyalty/tiers", body);
        success("Tier created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toastError(err.message || "Failed to save tier");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-md rounded-2xl bg-(--ui-bg) border border-(--ui-border) p-6 shadow-xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-(--ui-text-muted) hover:text-(--ui-text)">
          <X size={18} />
        </button>
        <h2 className="text-lg font-semibold text-(--ui-text) mb-4">
          {editing ? "Edit Tier" : "New Tier"}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted)">Name *</label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Gold" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted)">Min Spend *</label>
              <Input type="number" min="0" value={form.min_spend} onChange={(e) => set("min_spend", e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted)">Points Multiplier</label>
              <Input type="number" min="0.1" step="0.1" value={form.points_multiplier} onChange={(e) => set("points_multiplier", e.target.value)} placeholder="1.0" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted)">Discount %</label>
              <Input type="number" min="0" max="100" value={form.discount_percent} onChange={(e) => set("discount_percent", e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted)">Sort Order</label>
              <Input type="number" value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} placeholder="0" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-(--ui-text-muted)">Color</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
                className="h-9 w-12 rounded border border-(--ui-border) cursor-pointer"
              />
              <Input value={form.color} onChange={(e) => set("color", e.target.value)} className="grow" placeholder="#FFD700" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-(--ui-text-muted)">Benefits (optional)</label>
            <textarea
              value={form.benefits}
              onChange={(e) => set("benefits", e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text) focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="e.g. Free delivery, priority support"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : editing ? "Update" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Tier Card ────────────────────────────────────────────────────────────────

function TierCard({ tier, money, onEdit, onDelete }) {
  return (
    <SectionCard className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: tier.color || "#8066FF", opacity: 0.85 }}
          >
            <Award size={20} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-(--ui-text)">{tier.name}</h3>
            <p className="text-xs text-(--ui-text-muted)">
              Min spend: {money(tier.min_spend)}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onEdit(tier)} className="p-1.5 rounded-lg hover:bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text)">
            <Pencil size={14} />
          </button>
          <button onClick={() => onDelete(tier)} className="p-1.5 rounded-lg hover:bg-red-50 text-(--ui-text-muted) hover:text-red-600">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-(--ui-bg-elevated) p-2">
          <p className="text-[10px] uppercase tracking-wider text-(--ui-text-muted)">Multiplier</p>
          <p className="text-sm font-bold text-(--ui-text)">{tier.points_multiplier}x</p>
        </div>
        <div className="rounded-lg bg-(--ui-bg-elevated) p-2">
          <p className="text-[10px] uppercase tracking-wider text-(--ui-text-muted)">Discount</p>
          <p className="text-sm font-bold text-(--ui-text)">{tier.discount_percent}%</p>
        </div>
        <div className="rounded-lg bg-(--ui-bg-elevated) p-2">
          <p className="text-[10px] uppercase tracking-wider text-(--ui-text-muted)">Customers</p>
          <p className="text-sm font-bold text-(--ui-text)">
            <Users size={12} className="inline mr-0.5 -mt-0.5" />
            {tier.customer_count || 0}
          </p>
        </div>
      </div>

      {tier.benefits && (
        <p className="mt-2 text-xs text-(--ui-text-muted) italic">{tier.benefits}</p>
      )}
    </SectionCard>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function LoyaltyTiersRedesign() {
  const { fmt: money } = useCurrency();
  const { error: toastError, success } = useToast();
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get("/api/loyalty/tiers");
      setTiers(data.tiers || []);
    } catch (err) {
      toastError(err.message || "Failed to load tiers");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(tier) {
    setEditing(tier);
    setModalOpen(true);
  }

  async function deleteTier(tier) {
    if (!confirm(`Delete "${tier.name}" tier?`)) return;
    try {
      await api.del(`/loyalty/tiers/${tier.id}`);
      success("Tier deleted");
      load();
    } catch (err) {
      toastError(err.message || "Failed to delete tier");
    }
  }

  // Tier distribution bar
  const totalCustomers = tiers.reduce((s, t) => s + (t.customer_count || 0), 0);

  return (
    <PageShell
      title="Loyalty Tiers"
      subtitle="Manage tier thresholds, multipliers, and rewards"
      right={
        <Button onClick={openCreate}>
          <Plus size={14} className="mr-1" /> New Tier
        </Button>
      }
    >
      {/* Distribution overview */}
      {totalCustomers > 0 && (
        <SectionCard className="p-4 mb-4">
          <p className="text-xs font-medium text-(--ui-text-muted) mb-2">
            Tier Distribution — {totalCustomers} customer{totalCustomers !== 1 ? "s" : ""}
          </p>
          <div className="flex h-3 rounded-full overflow-hidden bg-(--ui-bg-elevated)">
            {tiers.map((t) => {
              const pct = totalCustomers ? ((t.customer_count || 0) / totalCustomers) * 100 : 0;
              if (!pct) return null;
              return (
                <div
                  key={t.id}
                  className="h-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: t.color || "#8066FF" }}
                  title={`${t.name}: ${t.customer_count}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {tiers.map((t) => (
              <span key={t.id} className="flex items-center gap-1 text-xs text-(--ui-text-muted)">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: t.color || "#8066FF" }} />
                {t.name} ({t.customer_count || 0})
              </span>
            ))}
          </div>
        </SectionCard>
      )}

      {loading ? (
        <p className="text-center text-sm text-(--ui-text-muted) py-8">Loading…</p>
      ) : tiers.length === 0 ? (
        <SectionCard className="p-8 text-center">
          <Award size={32} className="mx-auto mb-2 text-(--ui-text-muted)" />
          <p className="text-sm font-medium text-(--ui-text)">No tiers configured</p>
          <p className="text-xs text-(--ui-text-muted) mt-1">Create your first loyalty tier to reward repeat customers.</p>
          <Button className="mt-3" onClick={openCreate}>
            <Plus size={14} className="mr-1" /> Create Tier
          </Button>
        </SectionCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiers.map((t) => (
            <TierCard key={t.id} tier={t} money={money} onEdit={openEdit} onDelete={deleteTier} />
          ))}
        </div>
      )}

      <TierModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </PageShell>
  );
}
