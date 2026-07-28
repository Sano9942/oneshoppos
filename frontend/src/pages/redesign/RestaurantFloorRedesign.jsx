import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { readContext } from "../../auth/authStore";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Modal, ModalBody, ModalFooter, Input, Select, EmptyState } from "../../ui/primitives";
import { LayoutGrid, Plus, Users, Clock, X } from "lucide-react";
import { api } from "../../api";

const STATUS_TONES = { seated: "warning", ordering: "warning", served: "success", check_requested: "danger", closed: "default" };

export default function RestaurantFloorRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [plans, setPlans] = useState([]);
  const [activePlan, setActivePlan] = useState(null);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSeatModal, setShowSeatModal] = useState(null);
  const [seatForm, setSeatForm] = useState({ guest_count: 1, server_id: "" });
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planForm, setPlanForm] = useState({ name: "" });
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [showTableModal, setShowTableModal] = useState(false);
  const [tableForm, setTableForm] = useState({ label: "", capacity: 4, shape: "square" });
  const [tableSubmitting, setTableSubmitting] = useState(false);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/restaurant/floor-plans");
      setPlans(data.floor_plans || []);
      if (data.floor_plans?.length && !activePlan) {
        setActivePlan(data.floor_plans[0].id);
      }
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  const loadFloorDetail = useCallback(async () => {
    if (!activePlan) return;
    try {
      const data = await api.get(`/api/restaurant/floor-plans/${activePlan}`);
      setTables(data.tables || []);
    } catch (err) { toast.error(err.message); }
  }, [activePlan]);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => { loadFloorDetail(); }, [loadFloorDetail]);

  useEffect(() => {
    if (!activePlan) return;
    const interval = setInterval(loadFloorDetail, 10000);
    return () => clearInterval(interval);
  }, [activePlan, loadFloorDetail]);

  if (!flagsLoading && !flags.phase4_restaurant) return <Navigate to="/dashboard" replace />;
  if (!readContext()?.active_outlet_id) return <Navigate to="/" replace />;

  const openSession = async (tableId) => {
    try {
      await api.post("/api/restaurant/table-sessions", { table_id: tableId, guest_count: seatForm.guest_count, server_id: seatForm.server_id || undefined });
      toast.success("Table seated");
      setShowSeatModal(null);
      loadFloorDetail();
    } catch (err) { toast.error(err.message); }
  };

  const closeSession = async (sessionId) => {
    try {
      await api.put(`/api/restaurant/table-sessions/${sessionId}`, { status: "closed" });
      toast.success("Session closed");
      loadFloorDetail();
    } catch (err) { toast.error(err.message); }
  };

  const createPlan = async () => {
    const name = planForm.name.trim();
    if (!name) { toast.error("Plan name is required"); return; }
    const outletId = readContext()?.active_outlet_id;
    if (!outletId) { toast.error("No active outlet"); return; }
    setPlanSubmitting(true);
    try {
      const plan = await api.post("/api/restaurant/floor-plans", { name, outlet_id: Number(outletId) });
      toast.success("Floor plan created");
      setShowPlanModal(false);
      setPlanForm({ name: "" });
      await loadPlans();
      if (plan?.id) setActivePlan(plan.id);
    } catch (err) { toast.error(err.message); }
    finally { setPlanSubmitting(false); }
  };

  const createTable = async () => {
    const label = tableForm.label.trim();
    if (!label) { toast.error("Table label is required"); return; }
    if (!activePlan) { toast.error("Pick a floor plan first"); return; }
    setTableSubmitting(true);
    try {
      const offset = tables.length;
      await api.post("/api/restaurant/tables", {
        floor_plan_id: activePlan,
        label,
        capacity: Number(tableForm.capacity) || 4,
        shape: tableForm.shape,
        pos_x: (offset % 6) * 100,
        pos_y: Math.floor(offset / 6) * 100,
      });
      toast.success("Table added");
      setShowTableModal(false);
      setTableForm({ label: "", capacity: 4, shape: "square" });
      await loadFloorDetail();
      await loadPlans();
    } catch (err) { toast.error(err.message); }
    finally { setTableSubmitting(false); }
  };

  return (
    <PageShell title="Floor Plan" subtitle="Restaurant table management" right={
      <Button size="sm" onClick={() => { setPlanForm({ name: "" }); setShowPlanModal(true); }}>
        <Plus className="w-4 h-4 mr-1" /> New Plan
      </Button>
    }>
      {plans.length > 1 && (
        <div className="flex gap-2 mb-4">
          {plans.map(p => (
            <button key={p.id} onClick={() => setActivePlan(p.id)}
              className={`px-3 py-1 rounded text-sm ${activePlan === p.id ? "bg-(--ui-primary) text-(--ui-on-primary)" : "bg-(--ui-muted-surface) text-(--ui-text-muted)"}`}>
              {p.name} ({p.table_count} tables)
            </button>
          ))}
        </div>
      )}

      {!loading && plans.length === 0 && (
        <EmptyState
          title="No floor plans yet"
          body="Create a floor plan to start seating guests. Each plan can hold its own set of tables."
        />
      )}

      {activePlan && (
        <div className="flex justify-end mb-3">
          <Button size="sm" tone="default" onClick={() => { setTableForm({ label: "", capacity: 4, shape: "square" }); setShowTableModal(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Add Table
          </Button>
        </div>
      )}

      {activePlan && tables.length === 0 && (
        <EmptyState
          title="No tables in this plan"
          body="Click Add Table to place your first table."
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {tables.map(t => (
          <SectionCard key={t.id}>
            <div className="text-center">
              <div className="font-bold text-lg">{t.label}</div>
              <div className="text-xs text-(--ui-text-muted)">Cap: {t.capacity}</div>
              {t.session_id ? (
                <>
                  <Badge tone={STATUS_TONES[t.session_status]}>{t.session_status}</Badge>
                  <div className="text-xs mt-1"><Users className="w-3 h-3 inline" /> {t.guest_count} guests</div>
                  {t.server_name && <div className="text-xs">{t.server_name}</div>}
                  <Button size="xs" variant="ghost" className="mt-2" onClick={() => closeSession(t.session_id)}>Close</Button>
                </>
              ) : (
                <Button size="xs" className="mt-2" onClick={() => { setShowSeatModal(t.id); setSeatForm({ guest_count: 1, server_id: "" }); }}>
                  Seat
                </Button>
              )}
            </div>
          </SectionCard>
        ))}
      </div>

      <Modal open={showPlanModal} onClose={() => setShowPlanModal(false)} title="New Floor Plan" size="sm">
        <ModalBody>
          <label className="block text-sm font-medium mb-1">Plan name</label>
          <Input
            autoFocus
            value={planForm.name}
            onChange={e => setPlanForm({ name: e.target.value })}
            placeholder="e.g. Main Floor, Patio, Bar"
          />
        </ModalBody>
        <ModalFooter>
          <Button tone="plain" onClick={() => setShowPlanModal(false)} disabled={planSubmitting}>Cancel</Button>
          <Button tone="primary" onClick={createPlan} disabled={planSubmitting || !planForm.name.trim()}>
            {planSubmitting ? "Creating…" : "Create plan"}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={showTableModal} onClose={() => setShowTableModal(false)} title="Add Table" size="sm">
        <ModalBody>
          <label className="block text-sm font-medium mb-1">Label</label>
          <Input
            autoFocus
            value={tableForm.label}
            onChange={e => setTableForm(f => ({ ...f, label: e.target.value }))}
            placeholder="e.g. T1, A2, Bar-3"
          />
          <label className="block text-sm font-medium mb-1 mt-3">Capacity</label>
          <Input
            type="number"
            min="1"
            value={tableForm.capacity}
            onChange={e => setTableForm(f => ({ ...f, capacity: e.target.value }))}
          />
          <label className="block text-sm font-medium mb-1 mt-3">Shape</label>
          <Select
            value={tableForm.shape}
            onChange={e => setTableForm(f => ({ ...f, shape: e.target.value }))}
          >
            <option value="square">Square</option>
            <option value="round">Round</option>
            <option value="rectangle">Rectangle</option>
          </Select>
        </ModalBody>
        <ModalFooter>
          <Button tone="plain" onClick={() => setShowTableModal(false)} disabled={tableSubmitting}>Cancel</Button>
          <Button tone="primary" onClick={createTable} disabled={tableSubmitting || !tableForm.label.trim()}>
            {tableSubmitting ? "Adding…" : "Add table"}
          </Button>
        </ModalFooter>
      </Modal>

      {showSeatModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowSeatModal(null)}>
          <div className="bg-(--ui-surface) rounded-lg p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-4">Seat Table</h3>
            <label className="block text-sm mb-1">Guests</label>
            <input type="number" min="1" value={seatForm.guest_count} onChange={e => setSeatForm(f => ({ ...f, guest_count: Number(e.target.value) }))} className="w-full border rounded px-2 py-1 mb-3" />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowSeatModal(null)}>Cancel</Button>
              <Button onClick={() => openSession(showSeatModal)}>Seat</Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
