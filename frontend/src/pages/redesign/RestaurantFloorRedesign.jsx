import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
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

  if (!flagsLoading && !flags.phase4_restaurant) return <Navigate to="/dashboard" replace />;

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/restaurant/floor-plans?outlet_id=1");
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
      const data = await api.get(`/restaurant/floor-plans/${activePlan}`);
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
      await api.put(`/restaurant/table-sessions/${sessionId}`, { status: "closed" });
      toast.success("Session closed");
      loadFloorDetail();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <PageShell title="Floor Plan" subtitle="Restaurant table management" right={
      <Button size="sm" onClick={() => {}}>
        <Plus className="w-4 h-4 mr-1" /> New Plan
      </Button>
    }>
      {plans.length > 1 && (
        <div className="flex gap-2 mb-4">
          {plans.map(p => (
            <button key={p.id} onClick={() => setActivePlan(p.id)}
              className={`px-3 py-1 rounded text-sm ${activePlan === p.id ? "bg-(--color-primary) text-white" : "bg-(--color-surface) text-(--color-text-secondary)"}`}>
              {p.name} ({p.table_count} tables)
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {tables.map(t => (
          <SectionCard key={t.id}>
            <div className="text-center">
              <div className="font-bold text-lg">{t.label}</div>
              <div className="text-xs text-(--color-text-secondary)">Cap: {t.capacity}</div>
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

      {showSeatModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowSeatModal(null)}>
          <div className="bg-(--color-surface) rounded-lg p-6 w-80" onClick={e => e.stopPropagation()}>
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
