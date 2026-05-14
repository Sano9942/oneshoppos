import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../../contexts/ToastContext";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import {
  Button,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
} from "../../ui/primitives";
import { fmtUtcDate } from "../../utils/dates";

// Tier 1.4 Day 8 — Distributor admin page for manufacturer-partner CRUD.
// Lives at /settings/manufacturer-partners inside the tenant app.
// Gated by wholesale_secondary_sales feature flag + manage_inventory perm.

const STATUS_TONES = {
  invited: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  suspended: "bg-rose-50 text-rose-700 border-rose-200",
};

function StatusBadge({ status }) {
  const cls = STATUS_TONES[status] || "bg-slate-50 text-slate-600 border-slate-200";
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium border rounded ${cls}`}>
      {status}
    </span>
  );
}

const EMPTY_FORM = {
  name: "",
  contact_name: "",
  email: "",
  brand_ids: [],
};

export default function ManufacturerPartnersRedesign() {
  const { authHeaders } = useAuth();
  const authHeadersMemo = useMemo(() => authHeaders, [authHeaders]);
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeadersMemo);
  const { success, error: toastError } = useToast();

  const [partners, setPartners] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);

  const [editing, setEditing] = useState(null); // partner detail object
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editStatus, setEditStatus] = useState("invited");
  const [editBusy, setEditBusy] = useState(false);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/manufacturer-partners");
      setPartners(data.partners || []);
    } catch (e) {
      setPartners([]);
      toastError(e.message || "Failed to load manufacturer partners");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  const loadBrands = useCallback(async () => {
    try {
      const data = await api.get("/api/brands");
      setBrands(data.brands || data || []);
    } catch (e) {
      setBrands([]);
    }
  }, []);

  useEffect(() => {
    loadPartners();
    loadBrands();
  }, [loadPartners, loadBrands]);

  const visibleRows = useMemo(() => {
    if (!search.trim()) return partners;
    const q = search.toLowerCase();
    return partners.filter(
      (p) =>
        String(p.name || "").toLowerCase().includes(q) ||
        String(p.email || "").toLowerCase().includes(q) ||
        String(p.contact_name || "").toLowerCase().includes(q),
    );
  }, [partners, search]);

  function openCreate() {
    setCreateForm(EMPTY_FORM);
    setCreateOpen(true);
  }

  async function submitCreate() {
    if (!createForm.name.trim() || !createForm.email.trim()) {
      toastError("Name and email are required");
      return;
    }
    if (createForm.brand_ids.length === 0) {
      toastError("Pick at least one brand for the partner to monitor");
      return;
    }
    setCreateBusy(true);
    try {
      await api.post("/api/manufacturer-partners", {
        name: createForm.name.trim(),
        contact_name: createForm.contact_name.trim() || null,
        email: createForm.email.trim(),
        brand_ids: createForm.brand_ids,
      });
      success("Partner invited — setup email queued");
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      loadPartners();
    } catch (e) {
      toastError(e.message || "Failed to create partner");
    } finally {
      setCreateBusy(false);
    }
  }

  async function openEdit(row) {
    try {
      const detail = await api.get(`/api/manufacturer-partners/${row.id}`);
      const p = detail.partner;
      setEditing(p);
      setEditForm({
        name: p.name || "",
        contact_name: p.contact_name || "",
        email: p.email || "",
        brand_ids: (p.brands || []).map((b) => b.id),
      });
      setEditStatus(p.status || "invited");
    } catch (e) {
      toastError(e.message || "Failed to load partner");
    }
  }

  function closeEdit() {
    setEditing(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const patch = {};
    if (editForm.name !== (editing.name || "")) patch.name = editForm.name.trim();
    if (editForm.contact_name !== (editing.contact_name || ""))
      patch.contact_name = editForm.contact_name.trim() || null;
    if (editForm.email !== (editing.email || "")) patch.email = editForm.email.trim();
    if (editStatus !== editing.status) patch.status = editStatus;

    const originalIds = (editing.brands || []).map((b) => b.id).sort().join(",");
    const newIds = [...editForm.brand_ids].sort().join(",");
    if (originalIds !== newIds) patch.brand_ids = editForm.brand_ids;

    if (Object.keys(patch).length === 0) {
      closeEdit();
      return;
    }
    setEditBusy(true);
    try {
      await api.put(`/api/manufacturer-partners/${editing.id}`, patch);
      success("Partner updated");
      closeEdit();
      loadPartners();
    } catch (e) {
      toastError(e.message || "Failed to update partner");
    } finally {
      setEditBusy(false);
    }
  }

  async function resendInvite(row) {
    if (!confirm(`Resend the setup invite to ${row.email}?`)) return;
    try {
      await api.post(`/api/manufacturer-partners/${row.id}/resend`, {});
      success("Invite resent");
      loadPartners();
    } catch (e) {
      toastError(e.message || "Failed to resend invite");
    }
  }

  async function suspendPartner(row) {
    if (
      !confirm(
        `Suspend ${row.name}? They lose portal access immediately. You can reactivate later.`,
      )
    )
      return;
    try {
      await api.del(`/api/manufacturer-partners/${row.id}`);
      success(`Suspended ${row.name}`);
      loadPartners();
    } catch (e) {
      toastError(e.message || "Failed to suspend partner");
    }
  }

  function toggleBrand(form, setForm, brandId) {
    setForm((f) => {
      const next = new Set(f.brand_ids);
      if (next.has(brandId)) next.delete(brandId);
      else next.add(brandId);
      return { ...f, brand_ids: [...next] };
    });
  }

  if (flagsLoading) return null;
  if (!flags?.wholesale_secondary_sales) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Manufacturer Partners"
      subtitle="Invite brand owners to monitor secondary sales of their SKUs through your distribution."
      right={
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <Button tone="primary" onClick={openCreate}>
            + Invite Partner
          </Button>
        </div>
      }
    >
      <SectionCard className="p-0">
        {loading ? (
          <div className="p-8 text-center text-sm text-(--ui-text-muted)">
            Loading partners…
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-(--ui-text-muted)">
            {partners.length === 0
              ? "No manufacturer partners yet. Click Invite Partner to get started."
              : "No partners match your search."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase border-b border-(--ui-border) bg-(--ui-surface-muted)">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Partner</th>
                  <th className="text-left px-4 py-2 font-medium">Email</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Brands</th>
                  <th className="text-left px-4 py-2 font-medium">Last login</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((p) => (
                  <tr key={p.id} className="border-b border-(--ui-border)">
                    <td className="px-4 py-2">
                      <div className="font-medium">{p.name}</div>
                      {p.contact_name && (
                        <div className="text-xs text-(--ui-text-muted)">
                          {p.contact_name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-(--ui-text-muted)">{p.email}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-2">{p.brand_count}</td>
                    <td className="px-4 py-2 text-(--ui-text-muted) text-xs">
                      {p.last_login_at ? fmtUtcDate(p.last_login_at) : "Never"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" tone="plain" onClick={() => openEdit(p)}>
                          Edit
                        </Button>
                        {p.status === "invited" && (
                          <Button
                            size="sm"
                            tone="plain"
                            onClick={() => resendInvite(p)}
                          >
                            Resend
                          </Button>
                        )}
                        {p.status !== "suspended" && (
                          <Button
                            size="sm"
                            tone="danger"
                            onClick={() => suspendPartner(p)}
                          >
                            Suspend
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Invite Manufacturer Partner"
      >
        <div className="space-y-3 p-4">
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">
              Partner name
            </label>
            <Input
              autoFocus
              value={createForm.name}
              onChange={(e) =>
                setCreateForm({ ...createForm, name: e.target.value })
              }
              placeholder="Tapal Tea, Coca-Cola, etc."
            />
          </div>
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">
              Contact name (optional)
            </label>
            <Input
              value={createForm.contact_name}
              onChange={(e) =>
                setCreateForm({ ...createForm, contact_name: e.target.value })
              }
              placeholder="Who at the brand will use this login?"
            />
          </div>
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">Email</label>
            <Input
              type="email"
              value={createForm.email}
              onChange={(e) =>
                setCreateForm({ ...createForm, email: e.target.value })
              }
              placeholder="contact@brand.com"
            />
            <p className="text-xs text-(--ui-text-muted) mt-1">
              The setup link will be emailed here.
            </p>
          </div>
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">
              Brands they can see ({createForm.brand_ids.length} selected)
            </label>
            {brands.length === 0 ? (
              <p className="text-sm text-(--ui-text-muted)">
                No brands configured yet. Add brands from the Brands page first.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-(--ui-border) rounded p-2 space-y-1">
                {brands.map((b) => (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-(--ui-surface-muted) rounded px-1 py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={createForm.brand_ids.includes(b.id)}
                      onChange={() => toggleBrand(createForm, setCreateForm, b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <ModalFooter>
          <Button tone="plain" onClick={() => setCreateOpen(false)} disabled={createBusy}>
            Cancel
          </Button>
          <Button tone="primary" onClick={submitCreate} disabled={createBusy}>
            {createBusy ? "Sending…" : "Send Invite"}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editing}
        onClose={closeEdit}
        title={editing ? `Edit ${editing.name}` : ""}
      >
        {editing && (
          <>
            <div className="space-y-3 p-4">
              <div>
                <label className="block text-xs text-(--ui-text-muted) mb-1">
                  Partner name
                </label>
                <Input
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-(--ui-text-muted) mb-1">
                  Contact name
                </label>
                <Input
                  value={editForm.contact_name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, contact_name: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-(--ui-text-muted) mb-1">
                  Email
                </label>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) =>
                    setEditForm({ ...editForm, email: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-(--ui-text-muted) mb-1">
                  Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-(--ui-border) rounded text-sm bg-(--ui-surface)"
                >
                  <option value="invited">invited</option>
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                </select>
                <p className="text-xs text-(--ui-text-muted) mt-1">
                  Switching to suspended or invited revokes all active sessions.
                </p>
              </div>
              <div>
                <label className="block text-xs text-(--ui-text-muted) mb-1">
                  Brands ({editForm.brand_ids.length} selected)
                </label>
                {brands.length === 0 ? (
                  <p className="text-sm text-(--ui-text-muted)">No brands available</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto border border-(--ui-border) rounded p-2 space-y-1">
                    {brands.map((b) => (
                      <label
                        key={b.id}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-(--ui-surface-muted) rounded px-1 py-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={editForm.brand_ids.includes(b.id)}
                          onChange={() => toggleBrand(editForm, setEditForm, b.id)}
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <ModalFooter>
              <Button tone="plain" onClick={closeEdit} disabled={editBusy}>
                Cancel
              </Button>
              <Button tone="primary" onClick={saveEdit} disabled={editBusy}>
                {editBusy ? "Saving…" : "Save changes"}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </PageShell>
  );
}
