import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { Play, Save, Download, Trash2, FolderOpen, X } from "lucide-react";
import { downloadCsv } from "../../utils/csvExport";
import { api } from "../../api";

export default function ReportBuilderRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [datasets, setDatasets] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Builder state
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [selectedDims, setSelectedDims] = useState([]);
  const [selectedMeasures, setSelectedMeasures] = useState([]);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");

  // Results
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);

  // Save
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [saveShared, setSaveShared] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/api/reports/builder/datasets").catch(() => ({ datasets: [] })),
      api.get("/api/reports/builder/definitions").catch(() => ({ definitions: [] })),
    ]).then(([d, defs]) => {
      setDatasets(d.datasets || []);
      setDefinitions(defs.definitions || []);
      setLoading(false);
    });
  }, []);

  const handleRun = async () => {
    if (!selectedDataset || !selectedDims.length || !selectedMeasures.length) {
      return toast.error("Select a dataset, at least one dimension, and one measure");
    }
    setRunning(true);
    try {
      const filters = {};
      if (filterFrom) filters.from = filterFrom;
      if (filterTo) filters.to = filterTo;
      const res = await api.post("/api/reports/builder/run", {
        dataset: selectedDataset, dimensions: selectedDims, measures: selectedMeasures,
        filters, sort_by: sortBy || undefined, sort_order: sortOrder,
      });
      setResults(res);
    } catch (err) { toast.error(err.message); }
    setRunning(false);
  };

  const handleSave = async () => {
    if (!saveName.trim()) return toast.error("Name is required");
    try {
      const filters = {};
      if (filterFrom) filters.from = filterFrom;
      if (filterTo) filters.to = filterTo;
      const res = await api.post("/api/reports/builder/definitions", {
        name: saveName, description: saveDesc, dataset: selectedDataset,
        dimensions: selectedDims, measures: selectedMeasures,
        filters_json: filters, sort_by: sortBy || null, sort_order: sortOrder,
        is_shared: saveShared,
      });
      setDefinitions(prev => [res.definition, ...prev]);
      toast.success("Report saved");
      setShowSaveModal(false);
    } catch (err) { toast.error(err.message); }
  };

  const handleLoad = (def) => {
    setSelectedDataset(def.dataset);
    setSelectedDims(def.dimensions || []);
    setSelectedMeasures(def.measures || []);
    const f = typeof def.filters_json === "string" ? JSON.parse(def.filters_json || "{}") : (def.filters_json || {});
    setFilterFrom(f.from || "");
    setFilterTo(f.to || "");
    setSortBy(def.sort_by || "");
    setSortOrder(def.sort_order || "desc");
    setResults(null);
    toast.success(`Loaded: ${def.name}`);
  };

  const handleDeleteDef = async (id) => {
    try {
      await api.del(`/reports/builder/definitions/${id}`);
      setDefinitions(prev => prev.filter(d => d.id !== id));
      toast.success("Definition deleted");
    } catch (err) { toast.error(err.message); }
  };

  const handleExport = () => {
    if (!results?.rows?.length) return;
    const cols = [...selectedDims, ...selectedMeasures];
    const headers = cols;
    const rows = results.rows.map(r => cols.map(c => r[c] ?? ""));
    downloadCsv(headers, rows, "custom-report.csv");
  };

  const toggleDim = (d) => setSelectedDims(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  const toggleMeasure = (m) => setSelectedMeasures(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);

  if (flagsLoading) return null;
  if (!flags.phase2_report_builder) return <Navigate to="/" replace />;

  const ds = datasets.find(d => d.key === selectedDataset);

  return (
    <PageShell title="Report Builder" subtitle="Build custom reports by choosing datasets, dimensions, and measures">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left sidebar — saved definitions */}
        <div className="lg:col-span-1">
          <SectionCard>
            <div className="p-3">
              <p className="text-xs font-semibold uppercase text-(--ui-muted) mb-2">Saved Reports</p>
              {definitions.length === 0 ? (
                <p className="text-xs text-(--ui-muted)">No saved reports yet.</p>
              ) : (
                <div className="space-y-1">
                  {definitions.map(d => (
                    <div key={d.id} className="flex items-center justify-between text-sm py-1 border-b border-(--ui-border)">
                      <button onClick={() => handleLoad(d)} className="text-(--ui-text) hover:text-blue-500 text-left truncate grow">{d.name}</button>
                      <button onClick={() => handleDeleteDef(d.id)} className="p-1 hover:text-red-500 shrink-0"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Main builder area */}
        <div className="lg:col-span-3 space-y-4">
          <SectionCard>
            <div className="p-4 space-y-4">
              {/* Dataset picker */}
              <div>
                <label className="block text-sm font-medium text-(--ui-muted) mb-1">Dataset</label>
                <div className="flex gap-2 flex-wrap">
                  {datasets.map(d => (
                    <button key={d.key} onClick={() => { setSelectedDataset(d.key); setSelectedDims([]); setSelectedMeasures([]); setResults(null); }}
                      className={`px-3 py-1.5 text-sm rounded border ${selectedDataset === d.key ? "bg-(--ui-primary) text-white border-(--ui-primary)" : "bg-(--ui-bg) border-(--ui-border) text-(--ui-text)"}`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {ds && (
                <>
                  {/* Dimensions */}
                  <div>
                    <label className="block text-sm font-medium text-(--ui-muted) mb-1">Dimensions (group by)</label>
                    <div className="flex gap-2 flex-wrap">
                      {ds.dimensions.map(d => (
                        <label key={d} className="flex items-center gap-1 text-sm cursor-pointer">
                          <input type="checkbox" checked={selectedDims.includes(d)} onChange={() => toggleDim(d)} />
                          {d}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Measures */}
                  <div>
                    <label className="block text-sm font-medium text-(--ui-muted) mb-1">Measures</label>
                    <div className="flex gap-2 flex-wrap">
                      {ds.measures.map(m => (
                        <label key={m} className="flex items-center gap-1 text-sm cursor-pointer">
                          <input type="checkbox" checked={selectedMeasures.includes(m)} onChange={() => toggleMeasure(m)} />
                          {m.replace(/_/g, " ")}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Filters */}
                  <div className="flex gap-3 flex-wrap items-end">
                    <div>
                      <label className="block text-xs text-(--ui-muted) mb-1">From</label>
                      <input type="date" className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text)" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs text-(--ui-muted) mb-1">To</label>
                      <input type="date" className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text)" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs text-(--ui-muted) mb-1">Sort by</label>
                      <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text)" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                        <option value="">Default</option>
                        {[...selectedDims, ...selectedMeasures].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text)" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                        <option value="desc">Desc</option>
                        <option value="asc">Asc</option>
                      </select>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleRun} disabled={running}><Play size={14} className="mr-1" /> {running ? "Running..." : "Run"}</Button>
                    <Button size="sm" tone="plain" onClick={() => { setSaveName(""); setSaveDesc(""); setShowSaveModal(true); }}><Save size={14} className="mr-1" /> Save</Button>
                    {results?.rows?.length > 0 && (
                      <Button size="sm" tone="plain" onClick={handleExport}><Download size={14} className="mr-1" /> Export CSV</Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </SectionCard>

          {/* Results table */}
          {results && (
            <SectionCard>
              <div className="p-4">
                <p className="text-sm text-(--ui-muted) mb-2">{results.count} rows returned</p>
                {results.rows?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                          {[...selectedDims, ...selectedMeasures].map(col => (
                            <th key={col} className="py-2 font-medium px-2 cursor-pointer hover:text-blue-500" onClick={() => { setSortBy(col); setSortOrder(prev => prev === "asc" ? "desc" : "asc"); }}>
                              {col.replace(/_/g, " ")} {sortBy === col ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.rows.map((row, i) => (
                          <tr key={i} className="border-b border-(--ui-border)">
                            {[...selectedDims, ...selectedMeasures].map(col => (
                              <td key={col} className="py-1.5 px-2">{row[col] ?? "-"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-(--ui-muted) text-sm text-center py-4">No data for this query.</p>
                )}
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-(--ui-bg) rounded-lg shadow-xl w-full max-w-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-(--ui-text)">Save Report</h2>
              <button onClick={() => setShowSaveModal(false)}><X size={18} /></button>
            </div>
            <label className="block text-sm text-(--ui-muted) mb-1">Name</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" value={saveName} onChange={e => setSaveName(e.target.value)} />
            <label className="block text-sm text-(--ui-muted) mb-1">Description</label>
            <textarea className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" rows={2} value={saveDesc} onChange={e => setSaveDesc(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-(--ui-text) mb-4">
              <input type="checkbox" checked={saveShared} onChange={e => setSaveShared(e.target.checked)} />
              Share with all users
            </label>
            <div className="flex gap-2 justify-end">
              <Button tone="plain" size="sm" onClick={() => setShowSaveModal(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSave}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
