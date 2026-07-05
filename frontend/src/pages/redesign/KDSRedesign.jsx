import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { readContext } from "../../auth/authStore";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Input, Select } from "../../ui/primitives";
import { ChefHat, Check, Clock, Route as RouteIcon, Trash2, Eye, Settings } from "lucide-react";
import { api } from "../../api";
import KdsStationSettingsModal from "./kds/KdsStationSettingsModal";

function elapsedMinutes(createdAt) {
  if (!createdAt) return 0;
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
}

function timeColor(minutes) {
  if (minutes < 5) return "text-(--ui-success-fg)";
  if (minutes <= 10) return "text-(--ui-warning-fg)";
  return "text-(--ui-danger-fg)";
}

function timeBorder(minutes) {
  if (minutes < 5) return "border-(--ui-success-bg)";
  if (minutes <= 10) return "border-(--ui-warning-bg)";
  return "border-(--ui-danger-bg)";
}

export default function KDSRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [stations, setStations] = useState([]);
  const [activeStation, setActiveStation] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("tickets"); // 'tickets' | 'routes' | 'stations'
  const [printers, setPrinters] = useState([]); // 2-R.7 — list of printer_config rows
  const [routes, setRoutes] = useState([]);
  const [routeForm, setRouteForm] = useState({
    station_id: "",
    rule_type: "match_all", // category | product | modifier_group | match_all
    match_value: "",
    priority: 0,
  });
  const [previewDraftId, setPreviewDraftId] = useState("");
  const [preview, setPreview] = useState(null);
  // 2-R.5: per-station settings modal (balance strategy + target prep + printer).
  const [settingsStation, setSettingsStation] = useState(null);

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

  // Phase 2.1 B1 — routing rules CRUD + preview.
  const loadRoutes = useCallback(async () => {
    const ctx = readContext();
    if (!ctx?.active_outlet_id) return;
    try {
      const data = await api.get(`/api/kds/routes?outlet_id=${ctx.active_outlet_id}`);
      setRoutes(data.routes || []);
    } catch (err) { toast.error(err.message); }
  }, []);

  useEffect(() => { if (tab === "routes") loadRoutes(); }, [tab, loadRoutes]);

  // 2-R.7 — load printers for the Stations tab; restaurant-only but the
  // call is cheap enough to do unconditionally.
  useEffect(() => {
    if (tab !== "stations") return;
    api.get("/api/print/config")
      .then((cfg) => { if (cfg) setPrinters([cfg]); })
      .catch(() => setPrinters([]));
  }, [tab]);

  const saveStationPrinter = async (stationId, printerId) => {
    try {
      await api.put(`/api/kds/stations/${stationId}`, {
        printer_id: printerId ? Number(printerId) : null,
      });
      toast.success("Station printer updated");
      await loadStations();
    } catch (err) { toast.error(err.message); }
  };

  const saveRoute = async () => {
    const ctx = readContext();
    if (!ctx?.active_outlet_id) return;
    if (!routeForm.station_id) { toast.error("Pick a station"); return; }
    const body = {
      outlet_id: ctx.active_outlet_id,
      station_id: Number(routeForm.station_id),
      priority: Number(routeForm.priority) || 0,
    };
    if (routeForm.rule_type === "match_all") body.match_all = true;
    else {
      const v = Number(routeForm.match_value);
      if (!v) { toast.error("Enter an ID for the match value"); return; }
      if (routeForm.rule_type === "category") body.category_id = v;
      else if (routeForm.rule_type === "product") body.product_id = v;
      else if (routeForm.rule_type === "modifier_group") body.modifier_group_id = v;
    }
    try {
      await api.post("/api/kds/routes", body);
      toast.success("Rule added");
      setRouteForm({ station_id: "", rule_type: "match_all", match_value: "", priority: 0 });
      loadRoutes();
    } catch (err) { toast.error(err.message); }
  };

  const deleteRoute = async (id) => {
    try {
      await api.del(`/api/kds/routes/${id}`);
      toast.success("Rule deleted");
      loadRoutes();
    } catch (err) { toast.error(err.message); }
  };

  const runPreview = async () => {
    if (!previewDraftId) { toast.error("Enter a draft order ID"); return; }
    try {
      const data = await api.get(`/api/kds/routes/preview?draft_order_id=${previewDraftId}`);
      setPreview(data.preview || []);
    } catch (err) { toast.error(err.message); }
  };

  function routeLabel(r) {
    if (r.match_all) return "All items";
    if (r.product_name) return `Product: ${r.product_name}`;
    if (r.modifier_group_name) return `Modifier group: ${r.modifier_group_name}`;
    if (r.category_name) return `Category: ${r.category_name}`;
    return "—";
  }

  if (!flagsLoading && !flags.phase4_restaurant_kds) return <Navigate to="/dashboard" replace />;
  if (!readContext()?.active_outlet_id) return <Navigate to="/" replace />;

  return (
    <PageShell title="Kitchen Display" subtitle="KDS ticket queue" right={
      tab === "tickets" ? (
        <div className="flex items-center gap-2 text-sm text-(--ui-text-muted)">
          <Clock className="w-4 h-4" /> Auto-refreshing every 5s
        </div>
      ) : null
    }>
      <div className="flex gap-2 mb-4 border-b border-(--ui-border)">
        <Button
          tone="plain"
          size="sm"
          onClick={() => setTab("tickets")}
          className={tab === "tickets" ? "border-b-2 border-(--ui-primary) text-(--ui-primary)" : "text-(--ui-text-muted)"}>
          <ChefHat className="w-4 h-4 mr-1" /> Tickets
        </Button>
        <Button
          tone="plain"
          size="sm"
          onClick={() => setTab("routes")}
          className={tab === "routes" ? "border-b-2 border-(--ui-primary) text-(--ui-primary)" : "text-(--ui-text-muted)"}>
          <RouteIcon className="w-4 h-4 mr-1" /> Routing Rules
        </Button>
        <Button
          tone="plain"
          size="sm"
          onClick={() => setTab("stations")}
          className={tab === "stations" ? "border-b-2 border-(--ui-primary) text-(--ui-primary)" : "text-(--ui-text-muted)"}>
          <ChefHat className="w-4 h-4 mr-1" /> Stations
        </Button>
      </div>

      {tab === "stations" ? (
        <SectionCard>
          <h3 className="text-sm font-semibold mb-3">Station → printer mapping</h3>
          <p className="text-xs text-(--ui-text-muted) mb-3">
            Fire chits route to each station's printer. If a station's printer is offline, the chit falls back to the default receipt printer with an alert.
          </p>
          {stations.length === 0 ? (
            <p className="text-sm text-(--ui-text-muted)">No stations configured yet.</p>
          ) : (
            <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
                  <th className="py-2">Station</th>
                  <th>Role</th>
                  <th>Strategy</th>
                  <th>Target (s)</th>
                  <th>Printer</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => (
                  <tr key={s.id} className="border-b border-(--ui-border)">
                    <td className="py-2 font-semibold">{s.name}</td>
                    <td>{s.station_role}</td>
                    <td>{s.balance_strategy || "priority"}</td>
                    <td>{s.target_prep_seconds ?? "—"}</td>
                    <td>
                      <Select
                        value={s.printer_id || ""}
                        onChange={(e) => saveStationPrinter(s.id, e.target.value)}
                      >
                        <option value="">— none —</option>
                        {printers.map((p) => (
                          <option key={p.id || 1} value={p.id || 1}>
                            {(p.purpose || "receipt")} @ {p.host}:{p.port}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <Button
                        tone="plain"
                        size="sm"
                        onClick={() => setSettingsStation(s)}
                        aria-label={`Settings for ${s.name}`}
                      >
                        <Settings size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <KdsStationSettingsModal
              open={!!settingsStation}
              onClose={() => setSettingsStation(null)}
              station={settingsStation}
              onSaved={(updated) => setStations((prev) => prev.map((s) => s.id === updated.id ? updated : s))}
            />
            </>
          )}
        </SectionCard>
      ) : null}

      {tab === "routes" ? (
        <div className="space-y-4">
          <SectionCard>
            <h3 className="text-sm font-semibold mb-3">Add rule</h3>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              <Select
                value={routeForm.station_id}
                onChange={e => setRouteForm(f => ({ ...f, station_id: e.target.value }))}>
                <option value="">Station…</option>
                {stations.map(s => <option key={s.id} value={s.id}>{s.name} ({s.station_role})</option>)}
              </Select>
              <Select
                value={routeForm.rule_type}
                onChange={e => setRouteForm(f => ({ ...f, rule_type: e.target.value, match_value: "" }))}>
                <option value="match_all">Catch-all</option>
                <option value="category">Category ID</option>
                <option value="product">Product ID</option>
                <option value="modifier_group">Modifier Group ID</option>
              </Select>
              <Input
                type="number"
                placeholder="Match ID"
                disabled={routeForm.rule_type === "match_all"}
                value={routeForm.match_value}
                onChange={e => setRouteForm(f => ({ ...f, match_value: e.target.value }))} />
              <Input
                type="number"
                placeholder="Priority (0)"
                value={routeForm.priority}
                onChange={e => setRouteForm(f => ({ ...f, priority: e.target.value }))} />
              <Button size="sm" onClick={saveRoute}>Add</Button>
            </div>
            <p className="text-xs text-(--ui-text-muted) mt-2">
              Precedence: product &gt; modifier group &gt; category &gt; catch-all. Higher priority wins inside a tier.
            </p>
          </SectionCard>

          <SectionCard>
            <h3 className="text-sm font-semibold mb-3">Rules</h3>
            {routes.length === 0 ? (
              <p className="text-sm text-(--ui-text-muted)">No rules yet. Add one above.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
                    <th className="py-2">Priority</th>
                    <th>Station</th>
                    <th>Match</th>
                    <th>Role filter</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map(r => (
                    <tr key={r.id} className="border-b border-(--ui-border)">
                      <td className="py-2">{r.priority}</td>
                      <td>{r.station_name}</td>
                      <td>{routeLabel(r)}</td>
                      <td>{r.station_role_filter || "—"}</td>
                      <td className="text-right">
                        <button onClick={() => deleteRoute(r.id)} aria-label="Delete rule" className="text-(--ui-danger-fg) hover:opacity-80">
                          <Trash2 className="w-4 h-4 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>

          <SectionCard>
            <h3 className="text-sm font-semibold mb-3">Preview routing</h3>
            <div className="flex gap-2 items-center mb-3">
              <Input
                type="number"
                placeholder="Draft order ID"
                value={previewDraftId}
                onChange={e => setPreviewDraftId(e.target.value)} />
              <Button size="sm" onClick={runPreview}>
                <Eye className="w-4 h-4 mr-1" /> Preview
              </Button>
            </div>
            {preview && (
              preview.length === 0 ? (
                <p className="text-sm text-(--ui-text-muted)">No pending items on this check.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
                      <th className="py-2">Item</th>
                      <th>Station</th>
                      <th>Matched rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map(p => (
                      <tr key={p.item_id} className="border-b border-(--ui-border)">
                        <td className="py-2">{p.product_name}</td>
                        <td>{p.station_name || <Badge tone="warn">No station</Badge>}</td>
                        <td className="text-(--ui-text-muted)">{p.matched_rule_id ? `#${p.matched_rule_id}` : "fallback"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </SectionCard>
        </div>
      ) : (<>
      {stations.length > 1 && (
        <div className="flex gap-2 mb-4">
          {stations.map(s => (
            <button key={s.id} onClick={() => setActiveStation(s.id)}
              className={`px-3 py-1 rounded text-sm ${activeStation === s.id ? "bg-(--ui-primary) text-(--ui-on-primary)" : "bg-(--ui-bg-hover) text-(--ui-text)"}`}>
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
            // Priority >= 100 means expedited (Phase 2.1 A3). getTickets already
            // orders by priority DESC, so expedited tickets render first.
            const isExpedited = Number(ticket.priority || 0) >= 100;
            return (
              <div key={ticket.id} className={`border-2 ${isExpedited ? "border-(--ui-danger-bg)" : timeBorder(mins)} rounded-lg bg-(--ui-surface) text-(--ui-text) overflow-hidden`}>
                {isExpedited && (
                  <div className="px-3 py-1 bg-(--ui-danger-fg) text-(--ui-on-primary) text-xs font-semibold uppercase tracking-wide">
                    Expedite
                  </div>
                )}
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
                            {item.seat_number != null && (
                              <span className="inline-block bg-(--ui-muted-surface) text-(--ui-link) rounded px-1.5 py-0.5 text-xs font-semibold mr-1">
                                S{item.seat_number}
                              </span>
                            )}
                            {item.product_name}
                          </span>
                          {item.notes && <span className="text-xs text-(--ui-text-muted)">{item.notes}</span>}
                        </div>
                        {modText && <div className="text-xs text-(--ui-text-muted) pl-4">+ {modText}</div>}
                      </div>
                    );
                  })}
                  {ticket.special_instructions && (
                    <p className="text-xs italic text-(--ui-warning-fg) mt-1">{ticket.special_instructions}</p>
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
      </>)}
    </PageShell>
  );
}
