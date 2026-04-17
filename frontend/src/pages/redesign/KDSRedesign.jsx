import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { readContext } from "../../auth/authStore";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { ChefHat, Check, Clock } from "lucide-react";
import { api } from "../../api";

function elapsedMinutes(createdAt) {
  if (!createdAt) return 0;
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
}

function timeColor(minutes) {
  if (minutes < 5) return "text-green-600";
  if (minutes <= 10) return "text-yellow-600";
  return "text-red-600";
}

function timeBorder(minutes) {
  if (minutes < 5) return "border-green-400";
  if (minutes <= 10) return "border-yellow-400";
  return "border-red-500";
}

export default function KDSRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [stations, setStations] = useState([]);
  const [activeStation, setActiveStation] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  if (!flagsLoading && !flags.phase4_restaurant_kds) return <Navigate to="/dashboard" replace />;
  if (!readContext()?.active_outlet_id) return <Navigate to="/" replace />;

  const loadStations = useCallback(async () => {
    try {
      const data = await api.get("/api/kds/stations");
      setStations(data.stations || []);
      if (data.stations?.length && !activeStation) {
        setActiveStation(data.stations[0].id);
      }
    } catch (err) { toast.error(err.message); }
  }, []);

  const loadTickets = useCallback(async () => {
    if (!activeStation) return;
    setLoading(true);
    try {
      const data = await api.get(`/api/kds/tickets?station_id=${activeStation}`);
      setTickets(data.tickets || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [activeStation]);

  useEffect(() => { loadStations(); }, [loadStations]);
  useEffect(() => { loadTickets(); }, [loadTickets]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!activeStation) return;
    const interval = setInterval(loadTickets, 5000);
    return () => clearInterval(interval);
  }, [activeStation, loadTickets]);

  // Force re-render every 30s to update elapsed times
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const bumpTicket = async (ticketId) => {
    try {
      await api.post(`/api/kds/tickets/${ticketId}/bump`);
      toast.success("Ticket bumped");
      loadTickets();
    } catch (err) { toast.error(err.message); }
  };

  const recallTicket = async (ticketId) => {
    try {
      await api.post(`/api/kds/tickets/${ticketId}/recall`);
      toast.success("Ticket recalled");
      loadTickets();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <PageShell title="Kitchen Display" subtitle="KDS ticket queue" right={
      <div className="flex items-center gap-2 text-sm text-(--ui-text-muted)">
        <Clock className="w-4 h-4" /> Auto-refreshing every 5s
      </div>
    }>
      {stations.length > 1 && (
        <div className="flex gap-2 mb-4">
          {stations.map(s => (
            <button key={s.id} onClick={() => setActiveStation(s.id)}
              className={`px-3 py-1 rounded text-sm ${activeStation === s.id ? "bg-(--ui-primary) text-white" : "bg-(--ui-bg-hover) text-(--ui-text)"}`}>
              <ChefHat className="w-3 h-3 inline mr-1" />{s.name}
            </button>
          ))}
        </div>
      )}

      {loading ? <p className="text-(--ui-text-muted) text-center py-8">Loading...</p> :
        tickets.length === 0 ? (
          <div className="text-center py-16">
            <ChefHat className="w-12 h-12 mx-auto text-(--ui-text-muted) mb-4" />
            <p className="text-(--ui-text-muted)">No active tickets</p>
          </div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {tickets.map(ticket => {
            const mins = elapsedMinutes(ticket.created_at);
            return (
              <div key={ticket.id} className={`border-2 ${timeBorder(mins)} rounded-lg bg-(--ui-bg) overflow-hidden`}>
                {/* Header */}
                <div className="flex justify-between items-center px-3 py-2 bg-(--ui-bg-hover)">
                  <div>
                    <span className="font-bold text-sm">{ticket.table_label || `#${ticket.id}`}</span>
                    {ticket.server_name && <span className="text-xs text-(--ui-text-muted) ml-2">{ticket.server_name}</span>}
                  </div>
                  <div className={`text-sm font-mono font-bold ${timeColor(mins)}`}>
                    {mins}m
                  </div>
                </div>

                {/* Items */}
                <div className="px-3 py-2 space-y-1">
                  {(ticket.items || []).map((item, i) => {
                    // modifiers arrives as an array of option_name_snapshot strings
                    // from the new draft_order_item_modifiers JOIN (Phase 2.1 A2).
                    // Legacy string values still render for backward compat.
                    const modText = Array.isArray(item.modifiers)
                      ? item.modifiers.join(", ")
                      : item.modifiers;
                    return (
                      <div key={i} className="text-sm">
                        <div className="flex justify-between">
                          <span>
                            <span className="font-medium">{item.quantity}x</span>{" "}
                            {item.product_name}
                          </span>
                          {item.notes && <span className="text-xs text-(--ui-text-muted)">{item.notes}</span>}
                        </div>
                        {modText && <div className="text-xs text-(--ui-text-muted) pl-4">+ {modText}</div>}
                      </div>
                    );
                  })}
                  {ticket.special_instructions && (
                    <p className="text-xs italic text-orange-600 mt-1">{ticket.special_instructions}</p>
                  )}
                </div>

                {/* Course info */}
                {ticket.course_number && (
                  <div className="px-3 pb-1">
                    <Badge tone="default">Course {ticket.course_number}</Badge>
                  </div>
                )}

                {/* Actions */}
                <div className="px-3 py-2 border-t border-(--ui-border) flex gap-2">
                  <Button size="sm" className="grow" onClick={() => bumpTicket(ticket.id)}>
                    <Check className="w-4 h-4 mr-1" /> Bump
                  </Button>
                  <Button size="sm" tone="plain" onClick={() => recallTicket(ticket.id)}>
                    Recall
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
