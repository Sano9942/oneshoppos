import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, Link, Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input, Select, EmptyState } from "../../ui/primitives";
import { Plus, X, Calendar as CalendarIcon, BedDouble, FileSignature, ChevronLeft, ChevronRight, Receipt, CalendarDays } from "lucide-react";
import { api } from "../../api";

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
    "rooms";

  return (
    <PageShell
      title="Rooms"
      subtitle="Rooms, rates, bookings, and folios"
      right={<TabNav tab={tab} />}
    >
      {tab === "rooms" && <RoomsTab />}
      {tab === "rates" && <RatesTab />}
      {tab === "bookings" && <BookingsTab />}
      {tab === "calendar" && <CalendarTab />}
      {tab === "arrivals" && <ArrivalsTab />}
    </PageShell>
  );
}

function TabNav({ tab }) {
  const tabs = [
    { key: "rooms", label: "Rooms", path: "/rooms", icon: BedDouble },
    { key: "rates", label: "Rates", path: "/rooms/rates", icon: Receipt },
    { key: "bookings", label: "Bookings", path: "/rooms/bookings", icon: FileSignature },
    { key: "calendar", label: "Calendar", path: "/rooms/calendar", icon: CalendarIcon },
    { key: "arrivals", label: "Arrivals / Departures", path: "/rooms/arrivals-departures", icon: CalendarDays },
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
              {rooms.map((r) => (
                <tr key={r.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                  <td className="py-2 font-medium">{r.room_number}</td>
                  <td>{r.room_type_name || "—"}</td>
                  <td>{r.floor || "—"}</td>
                  <td><Badge tone="default">{r.occupancy_status}</Badge></td>
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
              ))}
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
          onClose={() => setRoomFormOpen(false)}
          onSaved={() => { setRoomFormOpen(false); load(); }}
        />
      )}
    </div>
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

function RoomForm({ initial, roomTypes, onClose, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    room_type_id: initial?.room_type_id || roomTypes[0]?.id || "",
    room_number: initial?.room_number || "",
    floor: initial?.floor || "",
    notes: initial?.notes || "",
  });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.room_type_id) { toast.error("Select a room type"); return; }
    if (!form.room_number.trim()) { toast.error("Room number required"); return; }
    setSaving(true);
    try {
      const payload = {
        room_type_id: Number(form.room_type_id),
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
            <option value="">Select a type…</option>
            {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
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

function BookingsTab() {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [bookings, setBookings] = useState([]);
  const [filters, setFilters] = useState({ status: "", from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [folioBookingId, setFolioBookingId] = useState(null);

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
    </div>
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
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const DAYS = 14;

  const load = useCallback(async () => {
    setLoading(true);
    const to = new Date(startDate);
    to.setDate(to.getDate() + DAYS);
    const toStr = to.toISOString().slice(0, 10);
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
      list.push(new Date(d).toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    return list;
  }, [startDate]);

  const shiftDays = (days) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + days);
    setStartDate(d.toISOString().slice(0, 10));
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
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const data = await api.get(`/api/room-bookings?from=${today}&to=${tomorrow}`);
      setBookings(data?.bookings || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
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
