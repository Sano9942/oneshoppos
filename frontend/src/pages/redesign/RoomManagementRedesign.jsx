import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, Link, Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input, Select, EmptyState } from "../../ui/primitives";
import { Plus, X, Calendar as CalendarIcon, BedDouble, FileSignature, ChevronLeft, ChevronRight, Receipt, CalendarDays, RefreshCw, Link2, Moon, Users } from "lucide-react";
import { api } from "../../api";
import { localDateStr, todayLocalStr, daysAgoLocalStr } from "../../utils/dates";
import { readTenantSlug } from "../../auth/authStore";
import { API_BASE, IS_MULTI_TENANT } from "../../config";

// ── Shared constants ──────────────────────────────────────────────

const STATUS_TONES = {
  reserved: "default",
  confirmed: "warning",
  checked_in: "warning",
  checked_out: "success",
  completed: "success",
  invoiced: "success",
  cancelled: "danger",
  no_show: "danger",
};

const STATUS_LABELS = {
  reserved: "Reserved",
  confirmed: "Confirmed",
  checked_in: "Checked In",
  checked_out: "Checked Out",
  completed: "Completed",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
  no_show: "No Show",
};

const HOUSEKEEPING_TONES = {
  clean: "success",
  dirty: "warning",
  inspected: "success",
  out_of_order: "danger",
};

const STATUS_COLORS = {
  reserved: "#94a3b8",
  confirmed: "#3b82f6",
  checked_in: "#f59e0b",
  checked_out: "#8b5cf6",
  completed: "#10b981",
  invoiced: "#0d9488",
  cancelled: "#ef4444",
  no_show: "#ef4444",
};

// ── Root page — tab router ────────────────────────────────────────

export default function RoomManagementRedesign() {
  const { isAuthenticated, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags();
  const location = useLocation();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasPerm("manage_rooms")) return <Navigate to="/access-denied" replace />;
  if (flagsLoading) return null;
  if (!flags.phase4_room_management) return <Navigate to="/dashboard" replace />;

  const tab =
    location.pathname.endsWith("/rates") ? "rates" :
    location.pathname.endsWith("/bookings") ? "bookings" :
    location.pathname.endsWith("/calendar") ? "calendar" :
    location.pathname.endsWith("/arrivals-departures") ? "arrivals" :
    location.pathname.endsWith("/channels") ? "channels" :
    location.pathname.endsWith("/night-audit") ? "audit" :
    "rooms";

  return (
    <PageShell
      title="Rooms"
      subtitle="Rooms, rates, bookings, and folios"
      right={<TabNav tab={tab} showChannels={!!flags.room_channel_sync} />}
    >
      {tab === "rooms" && <RoomsTab />}
      {tab === "rates" && <RatesTab />}
      {tab === "bookings" && <BookingsTab requireRegistration={!!flags.room_guest_registration} />}
      {tab === "calendar" && <CalendarTab />}
      {tab === "arrivals" && <ArrivalsTab />}
      {tab === "channels" && (flags.room_channel_sync ? <ChannelsTab /> : <Navigate to="/rooms" replace />)}
      {tab === "audit" && <NightAuditTab />}
    </PageShell>
  );
}

function TabNav({ tab, showChannels }) {
  const tabs = [
    { key: "rooms", label: "Rooms", path: "/rooms", icon: BedDouble },
    { key: "rates", label: "Rates", path: "/rooms/rates", icon: Receipt },
    { key: "bookings", label: "Bookings", path: "/rooms/bookings", icon: FileSignature },
    { key: "calendar", label: "Calendar", path: "/rooms/calendar", icon: CalendarIcon },
    { key: "arrivals", label: "Arrivals / Departures", path: "/rooms/arrivals-departures", icon: CalendarDays },
    ...(showChannels ? [{ key: "channels", label: "Channels", path: "/rooms/channels", icon: Link2 }] : []),
    { key: "audit", label: "Night Audit", path: "/rooms/night-audit", icon: Moon },
  ];
  return (
    <div className="flex gap-2 flex-wrap">
      {tabs.map(t => {
        const Icon = t.icon;
        const active = tab === t.key;
        return (
          <Link
            key={t.key}
            to={t.path}
            className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition ${
              active
                ? "bg-(--ui-primary) text-white"
                : "bg-(--ui-surface) border border-(--ui-border) text-(--ui-text) hover:bg-(--ui-muted-surface)"
            }`}
          >
            <Icon size={14} />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

// ── Rooms tab ─────────────────────────────────────────────────────

function RoomsTab() {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [roomTypes, setRoomTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFormOpen, setTypeFormOpen] = useState(false);
  const [roomFormOpen, setRoomFormOpen] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [editingRoom, setEditingRoom] = useState(null);
  const [dormMapId, setDormMapId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, r] = await Promise.all([
        api.get("/api/room-types"),
        api.get("/api/rooms"),
      ]);
      setRoomTypes(t?.room_types || []);
      setRooms(r?.rooms || []);
    } catch (err) {
      toast.error(err.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const setHousekeeping = async (room, status) => {
    try {
      await api.put(`/api/rooms/${room.id}/housekeeping`, { housekeeping_status: status });
      toast.success("Status updated");
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="space-y-6">
      {/* Room types */}
      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-(--ui-text)">Room Types</h3>
            <p className="text-xs text-(--ui-text-muted)">Catalog — Deluxe, Standard Twin, etc.</p>
          </div>
          <Button tone="primary" size="sm" onClick={() => { setEditingType(null); setTypeFormOpen(true); }}>
            <Plus size={14} /> New Type
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-(--ui-text-muted)">Loading…</p>
        ) : roomTypes.length === 0 ? (
          <EmptyState title="No room types yet" body="Add a room type to start building your catalog." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-(--ui-text-muted) border-b border-(--ui-border)">
                <th className="py-2">Name</th>
                <th>Capacity</th>
                <th>Base rate</th>
                <th>Deposit</th>
                <th>Rooms</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roomTypes.map((rt) => (
                <tr key={rt.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                  <td className="py-2 font-medium">{rt.name}</td>
                  <td>{rt.capacity}</td>
                  <td>{fmt(rt.base_rate)}</td>
                  <td>{fmt(rt.deposit_required)}</td>
                  <td>{rt.room_count}</td>
                  <td className="text-right">
                    <Button size="sm" tone="plain" onClick={() => { setEditingType(rt); setTypeFormOpen(true); }}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Rooms */}
      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-(--ui-text)">Rooms</h3>
            <p className="text-xs text-(--ui-text-muted)">Individual units with housekeeping status</p>
          </div>
          <Button tone="primary" size="sm" onClick={() => { setEditingRoom(null); setRoomFormOpen(true); }}>
            <Plus size={14} /> New Room
          </Button>
        </div>
        {rooms.length === 0 ? (
          <EmptyState title="No rooms yet" body="Add your first room once you have at least one room type." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-(--ui-text-muted) border-b border-(--ui-border)">
                <th className="py-2">Room</th>
                <th>Type</th>
                <th>Floor</th>
                <th>Occupancy</th>
                <th>Housekeeping</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => {
                const bedCount = rooms.filter((c) => c.parent_room_id === r.id).length;
                return (
                <tr key={r.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                  <td className="py-2 font-medium">
                    {r.parent_room_id ? <span className="text-(--ui-text-muted)">↳ </span> : null}
                    {r.room_number}
                    {bedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setDormMapId(r.id)}
                        className="ml-2 text-xs underline text-(--ui-text-muted) hover:text-(--ui-text)"
                      >
                        <Users size={12} className="inline mr-0.5" />
                        {bedCount} beds
                      </button>
                    )}
                  </td>
                  <td>{r.room_type_name || "—"}</td>
                  <td>{r.floor || "—"}</td>
                  <td><Badge tone="default">{bedCount > 0 ? "dorm" : r.occupancy_status}</Badge></td>
                  <td>
                    <Select
                      value={r.housekeeping_status}
                      onChange={(e) => setHousekeeping(r, e.target.value)}
                      className="py-1 text-xs"
                    >
                      <option value="clean">Clean</option>
                      <option value="dirty">Dirty</option>
                      <option value="inspected">Inspected</option>
                      <option value="out_of_order">Out of Order</option>
                    </Select>
                  </td>
                  <td className="text-right">
                    <Button size="sm" tone="plain" onClick={() => { setEditingRoom(r); setRoomFormOpen(true); }}>
                      Edit
                    </Button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SectionCard>

      {typeFormOpen && (
        <RoomTypeForm
          initial={editingType}
          onClose={() => setTypeFormOpen(false)}
          onSaved={() => { setTypeFormOpen(false); load(); }}
        />
      )}
      {roomFormOpen && (
        <RoomForm
          initial={editingRoom}
          roomTypes={roomTypes}
          rooms={rooms}
          onClose={() => setRoomFormOpen(false)}
          onSaved={() => { setRoomFormOpen(false); load(); }}
        />
      )}
      {dormMapId && <DormMapModal roomId={dormMapId} onClose={() => setDormMapId(null)} />}
    </div>
  );
}

// V10 hostel — live dorm map: "7/10 beds" + per-bed occupancy.
function DormMapModal({ roomId, onClose }) {
  const toast = useToast();
  const [map, setMap] = useState(null);

  useEffect(() => {
    api.get(`/api/rooms/${roomId}/dorm-map`)
      .then(setMap)
      .catch((err) => toast.error(err.message));
  }, [roomId, toast]);

  return (
    <Modal title={map ? `${map.dorm.room_number} — ${map.beds_occupied}/${map.beds_total} beds tonight` : "Dorm map"} onClose={onClose}>
      {!map ? (
        <p className="text-sm text-(--ui-text-muted)">Loading…</p>
      ) : map.beds.length === 0 ? (
        <EmptyState title="No beds yet" body="Add beds by creating rooms with this dorm as parent." />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {map.beds.map((bed) => (
            <div key={bed.id} className={`rounded-md border p-3 text-sm ${
              bed.current_booking_id
                ? "border-(--ui-border) bg-(--ui-muted-surface)"
                : "border-(--ui-border) bg-(--ui-surface)"
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{bed.room_number}</span>
                <Badge tone={bed.current_booking_id ? "warning" : "success"}>
                  {bed.current_booking_id ? "Occupied" : "Free"}
                </Badge>
              </div>
              {bed.current_booking_id && (
                <p className="text-xs text-(--ui-text-muted) mt-1">
                  {bed.guest_name || "Guest"} · {bed.booking_number}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end pt-4">
        <Button tone="plain" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

function RoomTypeForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: initial?.name || "",
    capacity: initial?.capacity || 2,
    base_rate: initial?.base_rate || 0,
    deposit_required: initial?.deposit_required || 0,
    description: initial?.description || "",
  });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        capacity: Number(form.capacity) || 1,
        base_rate: Number(form.base_rate) || 0,
        deposit_required: Number(form.deposit_required) || 0,
        description: form.description || null,
      };
      if (initial) {
        await api.put(`/api/room-types/${initial.id}`, payload);
      } else {
        await api.post("/api/room-types", payload);
      }
      toast.success(initial ? "Updated" : "Created");
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? "Edit Room Type" : "New Room Type"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Capacity">
            <Input type="number" min={1} value={form.capacity} onChange={(e) => update("capacity", e.target.value)} />
          </Field>
          <Field label="Base rate">
            <Input type="number" step="0.01" value={form.base_rate} onChange={(e) => update("base_rate", e.target.value)} />
          </Field>
          <Field label="Deposit">
            <Input type="number" step="0.01" value={form.deposit_required} onChange={(e) => update("deposit_required", e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => update("description", e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="plain" onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

function RoomForm({ initial, roomTypes, rooms = [], onClose, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    room_type_id: initial?.room_type_id || roomTypes[0]?.id || "",
    room_number: initial?.room_number || "",
    floor: initial?.floor || "",
    notes: initial?.notes || "",
    parent_room_id: initial?.parent_room_id || "",
  });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // A dorm parent is any non-bed room; a bed inherits its dorm's type.
  const dormCandidates = rooms.filter((r) => !r.parent_room_id && r.id !== initial?.id);

  const save = async () => {
    if (!form.parent_room_id && !form.room_type_id) { toast.error("Select a room type"); return; }
    if (!form.room_number.trim()) { toast.error("Room number required"); return; }
    setSaving(true);
    try {
      const payload = {
        ...(form.room_type_id ? { room_type_id: Number(form.room_type_id) } : {}),
        parent_room_id: form.parent_room_id ? Number(form.parent_room_id) : null,
        room_number: form.room_number.trim(),
        floor: form.floor || null,
        notes: form.notes || null,
      };
      if (initial) {
        await api.put(`/api/rooms/${initial.id}`, payload);
      } else {
        await api.post("/api/rooms", payload);
      }
      toast.success(initial ? "Updated" : "Created");
      onSaved();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={initial ? "Edit Room" : "New Room"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Room Type">
          <Select value={form.room_type_id} onChange={(e) => update("room_type_id", e.target.value)}>
            <option value="">{form.parent_room_id ? "Inherit from dorm" : "Select a type…"}</option>
            {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
          </Select>
        </Field>
        <Field label="Bed in dorm (hostels)">
          <Select value={form.parent_room_id} onChange={(e) => update("parent_room_id", e.target.value)}>
            <option value="">Not a bed — standalone room</option>
            {dormCandidates.map((r) => <option key={r.id} value={r.id}>{r.room_number}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Room number">
            <Input value={form.room_number} onChange={(e) => update("room_number", e.target.value)} />
          </Field>
          <Field label="Floor">
            <Input value={form.floor} onChange={(e) => update("floor", e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <Input value={form.notes} onChange={(e) => update("notes", e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="plain" onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

// ── Rates tab ─────────────────────────────────────────────────────

function RatesTab() {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [roomTypes, setRoomTypes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const loadTypes = useCallback(async () => {
    try {
      const data = await api.get("/api/room-types");
      setRoomTypes(data?.room_types || []);
      if (!selected && data?.room_types?.[0]) setSelected(data.room_types[0].id);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [selected, toast]);

  const loadOverrides = useCallback(async () => {
    if (!selected) return;
    try {
      const data = await api.get(`/api/room-types/${selected}/rate-overrides`);
      setOverrides(data?.overrides || []);
    } catch (err) { toast.error(err.message); }
  }, [selected, toast]);

  useEffect(() => { loadTypes(); }, [loadTypes]);
  useEffect(() => { loadOverrides(); }, [loadOverrides]);

  const currentType = roomTypes.find((rt) => String(rt.id) === String(selected));

  const removeOverride = async (id) => {
    if (!confirm("Delete this override?")) return;
    try {
      await api.del(`/api/room-types/${selected}/rate-overrides/${id}`);
      toast.success("Removed");
      loadOverrides();
    } catch (err) { toast.error(err.message); }
  };

  if (loading) return <p className="text-sm text-(--ui-text-muted)">Loading…</p>;
  if (roomTypes.length === 0) {
    return <EmptyState title="No room types" body="Create a room type on the Rooms tab first." />;
  }

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-center gap-3 mb-3">
          <Select value={selected || ""} onChange={(e) => setSelected(e.target.value)} className="max-w-xs">
            {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
          </Select>
          {currentType && (
            <span className="text-sm text-(--ui-text-muted)">
              Base rate: <strong className="text-(--ui-text)">{fmt(currentType.base_rate)}</strong> per night
            </span>
          )}
        </div>
      </SectionCard>

      <SectionCard>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold">Rate Overrides</h3>
            <p className="text-xs text-(--ui-text-muted)">Weekend, seasonal, or holiday pricing. Per-date overrides beat the base rate.</p>
          </div>
          <Button tone="primary" size="sm" onClick={() => setFormOpen(true)}>
            <Plus size={14} /> New Override
          </Button>
        </div>
        {overrides.length === 0 ? (
          <EmptyState title="No overrides" body="Base rate applies to all dates." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-(--ui-text-muted) border-b border-(--ui-border)">
                <th className="py-2">Dates</th>
                <th>Rate</th>
                <th>Label</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.id} className="border-b border-(--ui-border)">
                  <td className="py-2 font-medium">{o.from_date} → {o.to_date}</td>
                  <td>{fmt(o.rate)}</td>
                  <td>{o.label || "—"}</td>
                  <td className="text-right">
                    <Button size="sm" tone="plain" onClick={() => removeOverride(o.id)}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {formOpen && (
        <RateOverrideForm
          roomTypeId={selected}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); loadOverrides(); }}
        />
      )}
    </div>
  );
}

function RateOverrideForm({ roomTypeId, onClose, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ from_date: "", to_date: "", rate: "", label: "" });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.from_date || !form.to_date || form.rate === "") {
      toast.error("From, to, and rate are required");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/api/room-types/${roomTypeId}/rate-overrides`, {
        from_date: form.from_date,
        to_date: form.to_date,
        rate: Number(form.rate),
        label: form.label || null,
      });
      toast.success("Override added");
      onSaved();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="New Rate Override" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From date">
            <Input type="date" value={form.from_date} onChange={(e) => update("from_date", e.target.value)} />
          </Field>
          <Field label="To date">
            <Input type="date" value={form.to_date} onChange={(e) => update("to_date", e.target.value)} />
          </Field>
        </div>
        <Field label="Rate per night">
          <Input type="number" step="0.01" value={form.rate} onChange={(e) => update("rate", e.target.value)} />
        </Field>
        <Field label="Label (e.g. Christmas week)">
          <Input value={form.label} onChange={(e) => update("label", e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="plain" onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

// ── Bookings tab ──────────────────────────────────────────────────

function BookingsTab({ requireRegistration }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [bookings, setBookings] = useState([]);
  const [filters, setFilters] = useState({ status: "", from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [folioBookingId, setFolioBookingId] = useState(null);
  const [checkInBookingId, setCheckInBookingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filters.status) qs.set("status", filters.status);
      if (filters.from) qs.set("from", filters.from);
      if (filters.to) qs.set("to", filters.to);
      const data = await api.get(`/api/room-bookings${qs.toString() ? `?${qs}` : ""}`);
      setBookings(data?.bookings || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [filters, toast]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id, action) => {
    // Check-in goes through the guest-registration modal (PK guest register).
    if (action === "checkin") { setCheckInBookingId(id); return; }
    try {
      await api.post(`/api/room-bookings/${id}/${action}`, {});
      toast.success(`Booking ${action}`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="max-w-xs">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          <span className="text-(--ui-text-muted)">→</span>
          <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
          <Button tone="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> New Booking
          </Button>
        </div>
      </SectionCard>

      <SectionCard>
        {loading ? (
          <p className="text-sm text-(--ui-text-muted)">Loading…</p>
        ) : bookings.length === 0 ? (
          <EmptyState title="No bookings" body="Create your first booking to get started." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-(--ui-text-muted) border-b border-(--ui-border)">
                <th className="py-2">Booking</th>
                <th>Guest</th>
                <th>Room</th>
                <th>Dates</th>
                <th>Status</th>
                <th>Folio</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                  <td className="py-2 font-medium">{b.booking_number}</td>
                  <td>{b.customer_name || "—"}</td>
                  <td>{b.room_number || b.room_type_name || "—"}</td>
                  <td className="text-xs">{b.check_in_date} → {b.check_out_date} ({b.nights} nights)</td>
                  <td><Badge tone={STATUS_TONES[b.status]}>{STATUS_LABELS[b.status] || b.status}</Badge></td>
                  <td>{b.folio_grand_total ? fmt(b.folio_grand_total) : "—"}</td>
                  <td className="text-right">
                    <BookingActions booking={b} onAction={doAction} onOpenFolio={() => setFolioBookingId(b.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {createOpen && (
        <CreateBookingModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); load(); }}
        />
      )}
      {folioBookingId && (
        <FolioDrawer
          bookingId={folioBookingId}
          onClose={() => setFolioBookingId(null)}
          onSettled={() => { setFolioBookingId(null); load(); }}
        />
      )}
      {checkInBookingId && (
        <CheckInModal
          bookingId={checkInBookingId}
          requireRegistration={requireRegistration}
          onClose={() => setCheckInBookingId(null)}
          onDone={() => { setCheckInBookingId(null); load(); }}
        />
      )}
    </div>
  );
}

// V10 — check-in with guest registration (PK guest register: primary guest
// CNIC/passport; skip is the audited front-desk escape hatch).
function CheckInModal({ bookingId, requireRegistration, onClose, onDone }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [guest, setGuest] = useState({ name: "", cnic_passport: "", nationality: "", phone: "" });
  const update = (k, v) => setGuest((g) => ({ ...g, [k]: v }));

  const submit = async (skip) => {
    if (!skip && requireRegistration && (!guest.name.trim() || !guest.cnic_passport.trim())) {
      toast.error("Primary guest name + CNIC/passport required (or skip registration)");
      return;
    }
    setSaving(true);
    try {
      const body = skip
        ? { skip_registration: true }
        : guest.name.trim()
          ? { guests: [{ ...guest, name: guest.name.trim(), is_primary: true }] }
          : {};
      await api.post(`/api/room-bookings/${bookingId}/checkin`, body);
      toast.success("Checked in");
      onDone();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Check In — Guest Registration" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-(--ui-text-muted)">
          {requireRegistration
            ? "Capture the primary guest's ID for the guest register (required)."
            : "Optionally record the primary guest's details."}
        </p>
        <Field label="Guest name">
          <Input value={guest.name} onChange={(e) => update("name", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CNIC / Passport">
            <Input value={guest.cnic_passport} onChange={(e) => update("cnic_passport", e.target.value)} />
          </Field>
          <Field label="Nationality">
            <Input value={guest.nationality} onChange={(e) => update("nationality", e.target.value)} />
          </Field>
        </div>
        <Field label="Phone">
          <Input value={guest.phone} onChange={(e) => update("phone", e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-between gap-2 pt-4">
        <Button tone="plain" onClick={() => submit(true)} disabled={saving}>
          Skip registration
        </Button>
        <div className="flex gap-2">
          <Button tone="plain" onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={() => submit(false)} disabled={saving}>
            {saving ? "Checking in…" : "Check In"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BookingActions({ booking, onAction, onOpenFolio }) {
  const { status } = booking;
  const buttons = [];
  if (status === "reserved") buttons.push({ label: "Confirm", action: "confirm" });
  if (status === "confirmed") buttons.push({ label: "Check In", action: "checkin" });
  if (status === "checked_in") buttons.push({ label: "Check Out", action: "checkout" });
  if (["reserved", "confirmed"].includes(status)) {
    buttons.push({ label: "Cancel", action: "cancel", tone: "danger" });
  }
  return (
    <div className="flex gap-1 justify-end">
      {buttons.map((b) => (
        <Button key={b.action} size="sm" tone={b.tone || "primary"} onClick={() => onAction(booking.id, b.action)}>
          {b.label}
        </Button>
      ))}
      {["checked_in", "checked_out"].includes(status) && (
        <Button size="sm" tone="default" onClick={onOpenFolio}>Folio</Button>
      )}
    </div>
  );
}

function CreateBookingModal({ onClose, onSaved }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [roomTypes, setRoomTypes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [quote, setQuote] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_id: "",
    room_type_id: "",
    check_in_date: "",
    check_out_date: "",
    deposit_collected: 0,
    deposit_method: "",
    notes: "",
  });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get("/api/room-types").then((d) => setRoomTypes(d?.room_types || [])).catch(() => {});
    api.get("/api/customers").then((d) => setCustomers(d?.customers || d || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.room_type_id && form.check_in_date && form.check_out_date &&
        form.check_out_date > form.check_in_date) {
      api.get(`/api/room-types/${form.room_type_id}/quote?from=${form.check_in_date}&to=${form.check_out_date}`)
        .then(setQuote)
        .catch(() => setQuote(null));
    } else {
      setQuote(null);
    }
  }, [form.room_type_id, form.check_in_date, form.check_out_date]);

  const save = async () => {
    if (!form.room_type_id || !form.check_in_date || !form.check_out_date) {
      toast.error("Room type and dates are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        room_type_id: Number(form.room_type_id),
        check_in_date: form.check_in_date,
        check_out_date: form.check_out_date,
        deposit_collected: Number(form.deposit_collected) || 0,
        deposit_method: form.deposit_method || null,
        notes: form.notes || null,
      };
      await api.post("/api/room-bookings", payload);
      toast.success("Booking created");
      onSaved();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="New Booking" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Guest">
          <Select value={form.customer_id} onChange={(e) => update("customer_id", e.target.value)}>
            <option value="">Walk-in (no customer)</option>
            {customers.slice(0, 100).map((c) => (
              <option key={c.id} value={c.id}>{c.name} {c.mobile ? `· ${c.mobile}` : ""}</option>
            ))}
          </Select>
        </Field>
        <Field label="Room type">
          <Select value={form.room_type_id} onChange={(e) => update("room_type_id", e.target.value)}>
            <option value="">Select a type…</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>{rt.name} — base {fmt(rt.base_rate)}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check in">
            <Input type="date" value={form.check_in_date} onChange={(e) => update("check_in_date", e.target.value)} />
          </Field>
          <Field label="Check out">
            <Input type="date" value={form.check_out_date} onChange={(e) => update("check_out_date", e.target.value)} />
          </Field>
        </div>

        {quote && quote.nights > 0 && (
          <div className="bg-(--ui-muted-surface) border border-(--ui-border) rounded-lg p-3 space-y-1 text-xs">
            <div className="font-medium text-(--ui-text)">Rate breakdown ({quote.nights} nights)</div>
            {quote.rate_breakdown?.map((b) => (
              <div key={b.date} className="flex justify-between">
                <span>{b.date}</span>
                <span>{fmt(b.rate)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1 border-t border-(--ui-border) font-semibold text-sm">
              <span>Subtotal</span>
              <span>{fmt(quote.subtotal)}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Deposit collected">
            <Input type="number" step="0.01" value={form.deposit_collected} onChange={(e) => update("deposit_collected", e.target.value)} />
          </Field>
          <Field label="Deposit method">
            <Input value={form.deposit_method} placeholder="cash / card / online" onChange={(e) => update("deposit_method", e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <Input value={form.notes} onChange={(e) => update("notes", e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="plain" onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Create"}</Button>
      </div>
    </Modal>
  );
}

function FolioDrawer({ bookingId, onClose, onSettled }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [folio, setFolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addLineOpen, setAddLineOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/room-bookings/${bookingId}/folio`);
      setFolio(data);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [bookingId, toast]);

  useEffect(() => { load(); }, [load]);

  const settle = async (captureDeposit) => {
    if (!confirm("Settle this folio? An invoice will be generated.")) return;
    try {
      await api.post(`/api/room-bookings/${bookingId}/folio/settle`, {
        capture_deposit: !!captureDeposit,
      });
      toast.success("Folio settled");
      onSettled();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <Modal title="Guest Folio" onClose={onClose} wide>
      {loading || !folio ? (
        <p className="text-sm text-(--ui-text-muted)">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3 text-xs">
            <FolioStat label="Status" value={folio.status} />
            <FolioStat label="Room charges" value={fmt(folio.room_charge_total)} />
            <FolioStat label="POS charges" value={fmt(folio.pos_charge_total)} />
            <FolioStat label="Grand total" value={fmt(folio.grand_total)} bold />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">Line items</h4>
              {folio.status === "open" && (
                <Button size="sm" tone="primary" onClick={() => setAddLineOpen(true)}>
                  <Plus size={12} /> Add charge
                </Button>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-(--ui-text-muted) border-b border-(--ui-border)">
                  <th className="py-2">Type</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {folio.lines?.map((l) => (
                  <tr key={l.id} className="border-b border-(--ui-border)">
                    <td className="py-2"><Badge tone="default">{l.line_type}</Badge></td>
                    <td>{l.description}</td>
                    <td>{l.quantity}</td>
                    <td>{fmt(l.unit_price)}</td>
                    <td className="font-medium">{fmt(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {folio.status === "open" && (
            <div className="flex justify-end gap-2 pt-3 border-t border-(--ui-border)">
              <Button tone="plain" onClick={() => settle(false)}>Settle & release deposit</Button>
              <Button tone="primary" onClick={() => settle(true)}>Settle & capture deposit</Button>
            </div>
          )}
        </div>
      )}

      {addLineOpen && (
        <AddFolioLineModal
          bookingId={bookingId}
          onClose={() => setAddLineOpen(false)}
          onSaved={() => { setAddLineOpen(false); load(); }}
        />
      )}
    </Modal>
  );
}

function FolioStat({ label, value, bold }) {
  return (
    <div className="bg-(--ui-muted-surface) border border-(--ui-border) rounded-lg p-2">
      <div className="text-[10px] uppercase tracking-wide text-(--ui-text-muted)">{label}</div>
      <div className={bold ? "font-bold text-(--ui-text)" : "text-(--ui-text)"}>{value}</div>
    </div>
  );
}

function AddFolioLineModal({ bookingId, onClose, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ line_type: "manual_charge", description: "", quantity: 1, unit_price: 0 });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.description.trim()) { toast.error("Description required"); return; }
    setSaving(true);
    try {
      await api.post(`/api/room-bookings/${bookingId}/folio/lines`, {
        line_type: form.line_type,
        description: form.description.trim(),
        quantity: Number(form.quantity) || 1,
        unit_price: Number(form.unit_price) || 0,
      });
      toast.success("Line added");
      onSaved();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Add Folio Line" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Type">
          <Select value={form.line_type} onChange={(e) => update("line_type", e.target.value)}>
            <option value="manual_charge">Manual charge</option>
            <option value="discount">Discount</option>
          </Select>
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => update("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            <Input type="number" step="0.001" value={form.quantity} onChange={(e) => update("quantity", e.target.value)} />
          </Field>
          <Field label="Unit price">
            <Input type="number" step="0.01" value={form.unit_price} onChange={(e) => update("unit_price", e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="plain" onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Add"}</Button>
      </div>
    </Modal>
  );
}

// ── Calendar / Gantt tab ──────────────────────────────────────────

function CalendarTab() {
  const toast = useToast();
  const [data, setData] = useState({ rooms: [], bookings: [] });
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => todayLocalStr());
  const DAYS = 14;

  const load = useCallback(async () => {
    setLoading(true);
    const to = new Date(startDate);
    to.setDate(to.getDate() + DAYS);
    const toStr = localDateStr(to);
    try {
      const d = await api.get(`/api/room-bookings/timeline?from=${startDate}&to=${toStr}`);
      setData(d);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [startDate, toast]);

  useEffect(() => { load(); }, [load]);

  const dates = useMemo(() => {
    const list = [];
    const d = new Date(startDate);
    for (let i = 0; i < DAYS; i++) {
      list.push(localDateStr(d));
      d.setDate(d.getDate() + 1);
    }
    return list;
  }, [startDate]);

  const shiftDays = (days) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + days);
    setStartDate(localDateStr(d));
  };

  return (
    <div className="space-y-3">
      <SectionCard>
        <div className="flex items-center gap-2">
          <Button size="sm" tone="default" onClick={() => shiftDays(-7)}><ChevronLeft size={14} /> Prev week</Button>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Button size="sm" tone="default" onClick={() => shiftDays(7)}>Next week <ChevronRight size={14} /></Button>
          <span className="text-xs text-(--ui-text-muted) ml-2">Showing {DAYS} days</span>
        </div>
      </SectionCard>

      <SectionCard>
        {loading ? (
          <p className="text-sm text-(--ui-text-muted)">Loading…</p>
        ) : data.rooms.length === 0 ? (
          <EmptyState title="No rooms" body="Add rooms first to see the timeline." />
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid gap-px bg-(--ui-border) rounded-lg overflow-hidden min-w-max"
              style={{ gridTemplateColumns: `120px repeat(${DAYS}, minmax(60px, 1fr))` }}
            >
              <div className="bg-(--ui-surface) px-2 py-1.5 text-xs font-semibold sticky left-0 z-10">Room</div>
              {dates.map((d) => (
                <div key={d} className="bg-(--ui-surface) px-1 py-1.5 text-center text-[10px]">
                  <div className="font-medium">{d.slice(5)}</div>
                </div>
              ))}
              {data.rooms.map((room) => {
                const roomBookings = data.bookings.filter((b) => b.room_id === room.id);
                return (
                  <>
                    <div key={`r-${room.id}`} className="bg-(--ui-surface) px-2 py-1.5 text-xs font-medium sticky left-0 z-10">
                      {room.room_number}
                      <div className="text-[10px] text-(--ui-text-muted)">{room.room_type_name || ""}</div>
                    </div>
                    {dates.map((d) => {
                      const booking = roomBookings.find((b) =>
                        b.check_in_date <= d && b.check_out_date > d
                      );
                      return (
                        <div
                          key={`${room.id}-${d}`}
                          className="bg-(--ui-surface) h-8 relative text-[10px]"
                          style={booking ? { backgroundColor: STATUS_COLORS[booking.status] + "33" } : {}}
                          title={booking ? `${booking.booking_number} — ${booking.customer_name || "Guest"}` : ""}
                        >
                          {booking && booking.check_in_date === d && (
                            <div className="absolute inset-0 px-1 py-0.5 truncate font-medium" style={{ color: STATUS_COLORS[booking.status] }}>
                              {booking.customer_name || booking.booking_number}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Arrivals / Departures ─────────────────────────────────────────

function ArrivalsTab() {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = todayLocalStr();
      const tomorrow = localDateStr(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const data = await api.get(`/api/room-bookings?from=${today}&to=${tomorrow}`);
      setBookings(data?.bookings || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const today = todayLocalStr();
  const arriving = bookings.filter((b) => b.check_in_date === today && ["reserved", "confirmed"].includes(b.status));
  const inHouse = bookings.filter((b) => b.status === "checked_in");
  const departing = bookings.filter((b) => b.check_out_date === today && b.status === "checked_in");

  if (loading) return <p className="text-sm text-(--ui-text-muted)">Loading…</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <BookingColumn title="Arriving today" bookings={arriving} fmt={fmt} />
      <BookingColumn title="In-house" bookings={inHouse} fmt={fmt} />
      <BookingColumn title="Departing today" bookings={departing} fmt={fmt} />
    </div>
  );
}

function BookingColumn({ title, bookings, fmt }) {
  return (
    <SectionCard>
      <h3 className="font-semibold mb-3">{title} <span className="text-(--ui-text-muted) text-sm">({bookings.length})</span></h3>
      {bookings.length === 0 ? (
        <p className="text-sm text-(--ui-text-muted)">Nothing to show.</p>
      ) : (
        <div className="space-y-2">
          {bookings.map((b) => (
            <div key={b.id} className="border border-(--ui-border) rounded-lg p-2">
              <div className="font-medium text-sm">{b.customer_name || "Walk-in guest"}</div>
              <div className="text-xs text-(--ui-text-muted)">
                {b.booking_number} · Room {b.room_number || "—"} · {b.nights} nights
              </div>
              <Badge tone={STATUS_TONES[b.status]}>{STATUS_LABELS[b.status]}</Badge>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── V10 Channels tab (iCal sync — honest copy: NOT a Booking.com API) ──

function ChannelsTab() {
  const toast = useToast();
  const [feeds, setFeeds] = useState([]);
  const [deadLetters, setDeadLetters] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [syncing, setSyncing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, dl, r] = await Promise.all([
        api.get("/api/room-channel-feeds"),
        api.get("/api/room-channel-dead-letters"),
        api.get("/api/rooms"),
      ]);
      setFeeds(f?.feeds || []);
      setDeadLetters(dl?.dead_letters || []);
      setRooms(r?.rooms || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const exportUrl = (feed) => {
    const base = `${API_BASE}/api/public/rooms/ical/${feed.secret}`;
    const slug = IS_MULTI_TENANT ? readTenantSlug() : null;
    return slug ? `${base}?tenant=${encodeURIComponent(slug)}` : base;
  };

  const syncNow = async (feed) => {
    setSyncing(feed.id);
    try {
      const res = await api.post(`/api/room-channel-feeds/${feed.id}/sync`, {});
      if (res.error) toast.error(`Sync failed: ${res.error}`);
      else toast.success(`Synced — ${res.events} events, ${res.conflicts} conflicts`);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setSyncing(null); }
  };

  const rotateSecret = async (feed) => {
    if (!confirm("Rotate this feed's secret? The old URL stops working immediately — update it on the OTA.")) return;
    try {
      await api.post(`/api/room-channel-feeds/${feed.id}/rotate-secret`, {});
      toast.success("Secret rotated");
      load();
    } catch (err) { toast.error(err.message); }
  };

  const removeFeed = async (feed) => {
    if (!confirm(`Delete feed "${feed.name}"? Its imported blocks are removed too.`)) return;
    try {
      await api.del(`/api/room-channel-feeds/${feed.id}`);
      toast.success("Feed deleted");
      load();
    } catch (err) { toast.error(err.message); }
  };

  const resolveDl = async (dl, action) => {
    try {
      await api.post(`/api/room-channel-dead-letters/${dl.id}/${action}`, {});
      toast.success(action === "resolve" ? "Resolved" : "Dismissed");
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="space-y-4">
      {deadLetters.length > 0 && (
        <SectionCard className="border-(--ui-danger)">
          <h3 className="font-semibold text-(--ui-danger) mb-1">
            ⚠ Sync conflicts — possible double bookings
          </h3>
          <p className="text-xs text-(--ui-text-muted) mb-3">
            An OTA calendar event overlaps a local booking. Relocate or cancel one side, then resolve.
          </p>
          <table className="w-full text-sm">
            <tbody>
              {deadLetters.map((dl) => (
                <tr key={dl.id} className="border-b border-(--ui-border)">
                  <td className="py-2">{dl.feed_name || dl.channel_name || "Feed"}</td>
                  <td className="text-xs">{String(dl.start_date).slice(0, 10)} → {String(dl.end_date).slice(0, 10)}</td>
                  <td>vs booking <span className="font-medium">{dl.booking_number}</span></td>
                  <td className="text-right">
                    <Button size="sm" tone="primary" onClick={() => resolveDl(dl, "resolve")}>Resolved</Button>{" "}
                    <Button size="sm" tone="plain" onClick={() => resolveDl(dl, "dismiss")}>Dismiss</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}

      <SectionCard>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="font-semibold text-(--ui-text)">iCal Channel Sync</h3>
            <p className="text-xs text-(--ui-text-muted)">
              Calendar-level sync with OTAs via iCal feeds. Export feeds give Booking.com / Airbnb your
              availability; import feeds pull their bookings in as blocks (polled every 10 minutes).
              This is iCal sync — not a certified Booking.com API connection.
            </p>
          </div>
          <Button tone="primary" size="sm" onClick={() => setFormOpen(true)}>
            <Plus size={14} /> Add Feed
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-(--ui-text-muted)">Loading…</p>
        ) : feeds.length === 0 ? (
          <EmptyState
            title="No channel feeds yet"
            body="Add an export feed to share your calendar with an OTA, or an import feed to pull an OTA calendar into availability."
          />
        ) : (
          <table className="w-full text-sm mt-3">
            <thead>
              <tr className="text-left text-xs text-(--ui-text-muted) border-b border-(--ui-border)">
                <th className="py-2">Feed</th>
                <th>Direction</th>
                <th>Scope</th>
                <th>Last sync</th>
                <th>Blocks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.id} className="border-b border-(--ui-border)">
                  <td className="py-2">
                    <span className="font-medium">{f.name}</span>
                    {f.channel_name && <span className="text-xs text-(--ui-text-muted)"> · {f.channel_name}</span>}
                  </td>
                  <td><Badge tone={f.direction === "export" ? "default" : "warning"}>{f.direction}</Badge></td>
                  <td className="text-xs">{f.room_number || f.room_type_name || "All rooms"}</td>
                  <td className="text-xs">
                    {f.direction === "import" ? (
                      f.last_synced_at ? (
                        <span className={f.last_status === "error" || f.is_stale ? "text-(--ui-danger)" : ""}>
                          {new Date(f.last_synced_at).toLocaleString()}
                          {f.last_status === "error" ? " — error" : f.is_stale ? " — stale" : ""}
                        </span>
                      ) : <span className="text-(--ui-text-muted)">never</span>
                    ) : "live"}
                  </td>
                  <td>{f.direction === "import" ? f.block_count : "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    {f.direction === "export" ? (
                      <>
                        <Button size="sm" tone="plain" onClick={() => {
                          navigator.clipboard?.writeText(exportUrl(f));
                          toast.success("Feed URL copied — paste it into the OTA's iCal import");
                        }}>Copy URL</Button>{" "}
                        <Button size="sm" tone="plain" onClick={() => rotateSecret(f)}>Rotate</Button>
                      </>
                    ) : (
                      <Button size="sm" tone="plain" disabled={syncing === f.id} onClick={() => syncNow(f)}>
                        <RefreshCw size={12} className={syncing === f.id ? "animate-spin" : ""} /> Sync now
                      </Button>
                    )}{" "}
                    <Button size="sm" tone="plain" onClick={() => removeFeed(f)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {formOpen && (
        <ChannelFeedForm
          rooms={rooms}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function ChannelFeedForm({ rooms, onClose, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ direction: "export", name: "", channel_name: "", room_id: "", url: "" });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    if (form.direction === "import" && (!form.url.trim() || !form.room_id)) {
      toast.error("Import feeds need the OTA calendar URL and a room");
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/room-channel-feeds", {
        direction: form.direction,
        name: form.name.trim(),
        channel_name: form.channel_name.trim() || null,
        room_id: form.room_id ? Number(form.room_id) : null,
        ...(form.direction === "import" ? { url: form.url.trim() } : {}),
      });
      toast.success("Feed created");
      onSaved();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Add Channel Feed" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Direction">
          <Select value={form.direction} onChange={(e) => update("direction", e.target.value)}>
            <option value="export">Export — give the OTA our calendar</option>
            <option value="import">Import — pull the OTA's calendar in</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Booking.com — Room 201" />
          </Field>
          <Field label="Channel">
            <Input value={form.channel_name} onChange={(e) => update("channel_name", e.target.value)} placeholder="Booking.com / Airbnb…" />
          </Field>
        </div>
        <Field label={form.direction === "import" ? "Room (required)" : "Room (optional — blank = all rooms)"}>
          <Select value={form.room_id} onChange={(e) => update("room_id", e.target.value)}>
            <option value="">{form.direction === "import" ? "Select a room…" : "All rooms"}</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.room_number}</option>
            ))}
          </Select>
        </Field>
        {form.direction === "import" && (
          <Field label="OTA iCal URL">
            <Input value={form.url} onChange={(e) => update("url", e.target.value)} placeholder="https://…/calendar.ics" />
          </Field>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="plain" onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Create Feed"}</Button>
      </div>
    </Modal>
  );
}

// ── V10 Night Audit tab ───────────────────────────────────────────

function NightAuditTab() {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [snapshots, setSnapshots] = useState([]);
  const [summary, setSummary] = useState(null);
  const [running, setRunning] = useState(false);
  const [runDate, setRunDate] = useState("");
  const [lastRun, setLastRun] = useState(null);

  const load = useCallback(async () => {
    try {
      const [hist, rep] = await Promise.all([
        api.get("/api/rooms/night-audit/history"),
        api.get(`/api/reports/occupancy?from=${daysAgoLocalStr(29)}&to=${todayLocalStr()}`),
      ]);
      setSnapshots(hist?.snapshots || []);
      setSummary(rep?.summary || null);
    } catch (err) { toast.error(err.message); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const runAudit = async () => {
    setRunning(true);
    try {
      const snap = await api.post("/api/rooms/night-audit/run", runDate ? { date: runDate } : {});
      setLastRun(snap);
      toast.success(`Audit run for ${String(snap.audit_date).slice(0, 10)}`);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setRunning(false); }
  };

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Occupancy (30d)", `${summary.occupancy_pct}%`],
            ["ADR (30d)", fmt(summary.adr)],
            ["RevPAR (30d)", fmt(summary.revpar)],
            ["Room revenue (30d)", fmt(summary.room_revenue)],
          ].map(([label, value]) => (
            <SectionCard key={label}>
              <p className="text-xs text-(--ui-text-muted)">{label}</p>
              <p className="text-xl font-semibold text-(--ui-text)">{value}</p>
            </SectionCard>
          ))}
        </div>
      )}

      <SectionCard>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <h3 className="font-semibold text-(--ui-text)">Night Audit</h3>
            <p className="text-xs text-(--ui-text-muted)">
              Snapshots each hotel night — occupancy, ADR, RevPAR, arrivals/departures, and unsettled
              folios of departed guests. Runs automatically overnight; re-run any date safely.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
            <Button tone="primary" size="sm" disabled={running} onClick={runAudit}>
              <Moon size={14} /> {running ? "Running…" : "Run audit now"}
            </Button>
          </div>
        </div>

        {lastRun?.unsettled_folios?.length > 0 && (
          <div className="mb-3 rounded-md border border-(--ui-border) bg-(--ui-muted-surface) p-3">
            <p className="text-sm font-medium text-(--ui-text) mb-1">
              ⚠ {lastRun.unsettled_folios.length} departed guest(s) with unsettled folios
            </p>
            {lastRun.unsettled_folios.map((f) => (
              <p key={f.folio_id} className="text-xs text-(--ui-text-muted)">
                {f.booking_number} · {f.customer_name || "Guest"} · {fmt(f.grand_total)}
              </p>
            ))}
          </div>
        )}

        {snapshots.length === 0 ? (
          <EmptyState title="No audits yet" body="Run your first night audit — with zero bookings it simply records an empty house." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-(--ui-text-muted) border-b border-(--ui-border)">
                <th className="py-2">Night</th>
                <th>Occupied</th>
                <th>Occ %</th>
                <th>ADR</th>
                <th>RevPAR</th>
                <th>Arrivals</th>
                <th>Departures</th>
                <th>No-shows</th>
                <th>Revenue</th>
                <th>Unsettled</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id} className="border-b border-(--ui-border)">
                  <td className="py-2 font-medium">{String(s.audit_date).slice(0, 10)}</td>
                  <td>{s.rooms_occupied}/{s.rooms_total}{Number(s.rooms_blocked) > 0 ? ` (+${s.rooms_blocked} OTA)` : ""}</td>
                  <td>{s.occupancy_pct}%</td>
                  <td>{fmt(s.adr)}</td>
                  <td>{fmt(s.revpar)}</td>
                  <td>{s.arrivals}</td>
                  <td>{s.departures}</td>
                  <td>{s.no_shows}</td>
                  <td>{fmt(s.room_revenue)}</td>
                  <td>{Number(s.unsettled_folio_total) > 0
                    ? <Badge tone="danger">{fmt(s.unsettled_folio_total)}</Badge>
                    : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-100 flex items-center justify-center p-4">
      <div className={`bg-(--ui-surface) rounded-xl shadow-2xl border border-(--ui-border) ${wide ? "max-w-3xl" : "max-w-lg"} w-full max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-(--ui-border)">
          <h2 className="font-semibold text-(--ui-text)">{title}</h2>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-(--ui-text-muted) mb-1">{label}</label>
      {children}
    </div>
  );
}
