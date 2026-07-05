import { useEffect, useMemo, useState } from "react";
import { Download, MapPin, Phone, Plus, Search, Trash2, ArrowUpRight } from "lucide-react";
import { api } from "../../api";
import {
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";
import { downloadCsv } from "../../utils/csvExport";

const EMPTY = { name: "", address: "", phone: "" };

export default function OutletsRedesign() {
  const [outlets, setOutlets] = useState([]);
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // outlet being deleted
  const [reassignTo, setReassignTo] = useState("");
  const [addOutletConfirmOpen, setAddOutletConfirmOpen] = useState(false);
  const [addOutletSubmitting, setAddOutletSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [outletsData, billingData] = await Promise.all([
        api.get("/api/outlets"),
        api.get("/api/billing/status").catch(() => null),
      ]);
      setOutlets(outletsData.outlets || []);
      setBilling(billingData);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load outlets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Post-payment return: poll billing/status until max_outlets bumps, then
  // clean URL params. Mirrors the BillingRedesign post-payment polling.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "success") return;
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const data = await api.get("/api/billing/status");
        const oldMax = billing?.max_outlets || 1;
        if (data.max_outlets > oldMax || attempts >= 15) {
          clearInterval(poll);
          setBilling(data);
          await load();
          window.history.replaceState({}, "", "/outlets");
        }
      } catch {
        if (attempts >= 15) {
          clearInterval(poll);
          window.history.replaceState({}, "", "/outlets");
        }
      }
    }, 2000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    if (!search.trim()) return outlets;
    const q = search.toLowerCase();
    return outlets.filter(
      (o) =>
        String(o.name || "").toLowerCase().includes(q) ||
        String(o.address || "").toLowerCase().includes(q),
    );
  }, [outlets, search]);

  // Add Outlet routing:
  //   Free tenant         → POST /api/outlets returns 403 PLAN_LIMIT_REACHED;
  //                         the global PlanLimitModalInterceptor (mounted in
  //                         AppLayoutRedesign) opens the "Upgrade to Pro"
  //                         modal automatically. Just submit the form.
  //   Pro at cap          → show purchase confirmation → /api/billing/add-outlet
  //   Pro below cap       → standard create modal
  const proAtCap = billing?.plan === "pro" && outlets.length >= (billing?.max_outlets || 1);
  const openCreate = () => {
    if (proAtCap) {
      setAddOutletConfirmOpen(true);
      return;
    }
    setEditing(null);
    setForm(EMPTY);
    setModalOpen(true);
  };

  const handlePurchaseAddOutlet = async () => {
    setAddOutletSubmitting(true);
    setError("");
    try {
      const data = await api.post("/api/billing/add-outlet", {});
      window.location.href = data.checkout_url;
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to start checkout");
      setAddOutletSubmitting(false);
    }
  };
  const openEdit = (o) => {
    setEditing(o);
    setForm({ name: o.name, address: o.address || "", phone: o.phone || "" });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await api.put(`/api/outlets/${editing.id}`, form);
      } else {
        await api.post("/api/outlets", form);
      }
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.body?.error || e2.message || "Failed to save outlet");
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (o) => {
    setDeleteTarget(o);
    setReassignTo("");
    setError("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError("");
    try {
      const path = reassignTo
        ? `/api/outlets/${deleteTarget.id}?reassign_to=${reassignTo}`
        : `/api/outlets/${deleteTarget.id}`;
      await api.del(path);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to delete outlet");
    }
  };

  return (
    <PageShell
      title="Outlets"
      subtitle="Manage store locations and branches."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => downloadCsv(["id","name","address","phone"], visible.map(o => [o.id, o.name||"", o.address||"", o.phone||""]), "outlets")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={14} className="mr-1 inline" /> Add Outlet
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">{error}</SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total Outlets</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{outlets.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Visible</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{visible.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">With Address</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{outlets.filter((o) => o.address).length}</p>
        </SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-60">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
              <Input
                className="pl-8"
                placeholder="Search outlets"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visible.length} outlets</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left text-(--ui-text-muted) w-12">ID</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Address</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visible.map((o) => (
                  <tr key={o.id} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                    <td className="px-3 py-2 font-mono text-xs text-(--ui-text-muted)">{o.id}</td>
                    <td className="px-3 py-2 font-medium text-(--ui-text)">{o.name}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {o.address ? (
                        <span><MapPin size={11} className="mr-1 inline" />{o.address}</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {o.phone ? (
                        <span><Phone size={11} className="mr-1 inline" />{o.phone}</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(o)}>Edit</Button>
                        <Button size="sm" tone="danger" onClick={() => openDelete(o)}>
                          <Trash2 size={12} className="mr-1 inline" />Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading && <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading outlets...</div>}
          {!loading && visible.length === 0 && (
            <EmptyState title="No outlets" body="Add your first outlet location." />
          )}
        </div>
      </SectionCard>

      <Modal
        open={modalOpen}
        onClose={saving ? undefined : () => setModalOpen(false)}
        title={editing ? "Edit Outlet" : "Add Outlet"}
        size="sm"
      >
        <form className="space-y-2" onSubmit={save}>
          <Input
            required
            placeholder="Outlet name"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
          <Input
            placeholder="Address"
            value={form.address}
            onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
          />
          <Input
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
          />
          <ModalFooter>
            <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button tone="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </ModalFooter>
        </form>
      </Modal>
      <Modal
        open={addOutletConfirmOpen}
        onClose={addOutletSubmitting ? undefined : () => setAddOutletConfirmOpen(false)}
        title="Add another outlet"
        size="sm"
      >
        <p className="mb-3 text-sm text-(--ui-text-muted)">
          You're at your current outlet limit ({billing?.max_outlets || 1}).
          Adding another outlet adds <strong>PKR 8,000/month</strong> to your subscription
          (or the equivalent for your billing cycle).
        </p>
        <p className="mb-3 text-xs text-(--ui-text-muted)">
          You'll be redirected to the payment gateway. After payment confirms,
          come back to this page and your new outlet slot will be ready.
        </p>
        {error && <p className="mb-3 text-sm text-(--ui-danger-fg)">{error}</p>}
        <ModalFooter>
          <Button type="button" onClick={() => setAddOutletConfirmOpen(false)} disabled={addOutletSubmitting}>
            Cancel
          </Button>
          <Button tone="primary" onClick={handlePurchaseAddOutlet} disabled={addOutletSubmitting}>
            <span className="inline-flex items-center gap-1.5">
              {addOutletSubmitting ? "Redirecting…" : "Continue to payment"}
              {!addOutletSubmitting && <ArrowUpRight size={14} />}
            </span>
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Outlet"
        size="sm"
      >
        {deleteTarget ? (
          <>
            <p className="mb-4 text-sm text-(--ui-text-muted)">
              You are about to delete <strong>{deleteTarget.name}</strong>. Any records linked to this outlet must be reassigned first.
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold text-(--ui-text-muted)">
                Reassign linked records to
              </label>
              <select
                className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)"
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
              >
                <option value="">— Delete without reassigning —</option>
                {outlets
                  .filter((o) => o.id !== deleteTarget.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
              </select>
            </div>
            {error && <p className="mb-3 text-sm text-(--ui-danger-fg)">{error}</p>}
            <ModalFooter>
              <Button type="button" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button tone="danger" onClick={confirmDelete}>
                {reassignTo ? "Reassign & Delete" : "Delete Anyway"}
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}
