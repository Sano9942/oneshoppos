import React, { useState, useMemo, useEffect } from "react";
import { RefreshCw, Link2, CheckCircle2, ShieldAlert } from "lucide-react";
import { useShopify } from "./ShopifyContext";

export default function ShopifyMappings() {
  const { apiFetch, config, status, outlets, setError, setSuccess, loadAll } =
    useShopify();

  const [loadingLocations, setLoadingLocations] = useState(false);
  const [liveLocations, setLiveLocations] = useState([]);
  const [locationDraftByOutlet, setLocationDraftByOutlet] = useState({});
  const [savingLocationOutletId, setSavingLocationOutletId] = useState(null);

  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [applyingSuggestions, setApplyingSuggestions] = useState(false);
  const [liveSuggestions, setLiveSuggestions] = useState([]);
  const [excludedSuggestionKeys, setExcludedSuggestionKeys] = useState({});
  const [applySuggestionConflicts, setApplySuggestionConflicts] = useState([]);

  const [webhookSetup, setWebhookSetup] = useState(null);
  const [uatChecklist, setUatChecklist] = useState(null);
  const [liveValidation, setLiveValidation] = useState(null);

  // Sync internal mapping counts/status
  const locationMappings = useMemo(
    () => status?.location_mappings || [],
    [status],
  );
  const mappingByOutlet = useMemo(() => {
    const map = {};
    locationMappings.forEach((m) => (map[m.outlet_id] = m));
    return map;
  }, [locationMappings]);

  useEffect(() => {
    if (outlets.length > 0) {
      const preferredByOutlet = {};
      locationMappings.forEach((row) => {
        if (!preferredByOutlet[row.outlet_id]) {
          preferredByOutlet[row.outlet_id] = row.shopify_location_id;
        }
      });
      setLocationDraftByOutlet((prev) => {
        const nextDraft = { ...prev };
        outlets.forEach((outlet) => {
          const mapped = preferredByOutlet[outlet.id] || "";
          nextDraft[outlet.id] = nextDraft[outlet.id] || mapped;
        });
        return nextDraft;
      });
    }
  }, [outlets, locationMappings]);

  const loadLiveLocations = async () => {
    setLoadingLocations(true);
    try {
      const res = await apiFetch(`/api/integrations/shopify/locations/live`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch locations");
      setLiveLocations(data.locations || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingLocations(false);
    }
  };

  const saveLocationMapping = async (outletId) => {
    const shopifyLocationId = locationDraftByOutlet[outletId];
    if (!shopifyLocationId) return;
    setSavingLocationOutletId(outletId);
    try {
      const res = await apiFetch(`/api/integrations/mappings/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet_id: outletId,
          shopify_location_id: shopifyLocationId,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save mapping");
      }
      setSuccess("Location mapping updated");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingLocationOutletId(null);
    }
  };

  const loadSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const res = await apiFetch(`/api/integrations/shopify/suggestions`);
      const data = await res.json();
      setLiveSuggestions(data.suggestions || []);
      if (res.ok)
        setSuccess(`Found ${data.suggestions?.length || 0} suggestions.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const suggestionKey = (s, idx) =>
    `${s.product_id}-${s.variant_id || "v"}-${idx}`;

  const reviewedSuggestions = useMemo(() => {
    return liveSuggestions.filter(
      (s, idx) => !excludedSuggestionKeys[suggestionKey(s, idx)],
    );
  }, [liveSuggestions, excludedSuggestionKeys]);

  const toggleSuggestion = (s, idx) => {
    const key = suggestionKey(s, idx);
    setExcludedSuggestionKeys((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const applySuggestions = async () => {
    if (
      !window.confirm(`Apply ${reviewedSuggestions.length} approved mappings?`)
    )
      return;
    setApplyingSuggestions(true);
    setApplySuggestionConflicts([]);
    try {
      const res = await apiFetch(
        `/api/integrations/shopify/suggestions/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suggestions: reviewedSuggestions }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        setSuccess(`Successfully applied ${data.applied_count} mappings.`);
        setApplySuggestionConflicts(data.conflicts || []);
        loadAll();
      } else {
        setError(data.error || "Failed to apply suggestions");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setApplyingSuggestions(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">
            Location Mapping
          </h3>
          <button
            onClick={loadLiveLocations}
            disabled={loadingLocations}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
          >
            <RefreshCw
              size={12}
              className={loadingLocations ? "animate-spin" : ""}
            />
            Fetch Live Shopify Locations
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="p-3">POS Outlet</th>
              <th className="p-3">Current Mapping</th>
              <th className="p-3">Map To Shopify Location</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {outlets.map((outlet) => {
              const existing = mappingByOutlet[outlet.id];
              const draftValue = locationDraftByOutlet[outlet.id] || "";
              return (
                <tr key={outlet.id} className="border-t border-slate-100">
                  <td className="p-3 font-medium text-slate-700">
                    {outlet.name}
                  </td>
                  <td className="p-3 text-slate-500 text-xs">
                    {existing ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded">
                        {existing.shopify_location_name ||
                          existing.shopify_location_id}
                      </span>
                    ) : (
                      "Not mapped"
                    )}
                  </td>
                  <td className="p-3">
                    <select
                      value={draftValue}
                      onChange={(e) =>
                        setLocationDraftByOutlet((p) => ({
                          ...p,
                          [outlet.id]: e.target.value,
                        }))
                      }
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs"
                      disabled={liveLocations.length === 0}
                    >
                      <option value="">
                        {liveLocations.length === 0
                          ? "(Fetch live locations first)"
                          : "Select Location..."}
                      </option>
                      {liveLocations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => saveLocationMapping(outlet.id)}
                      disabled={
                        !draftValue || savingLocationOutletId === outlet.id
                      }
                      className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs hover:bg-slate-800 disabled:opacity-50"
                    >
                      {savingLocationOutletId === outlet.id ? "..." : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">
            Auto-Mapping Suggestions
          </h3>
          <div className="flex gap-2">
            <button
              onClick={loadSuggestions}
              disabled={loadingSuggestions}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                size={12}
                className={loadingSuggestions ? "animate-spin" : ""}
              />
              Generate Suggestions
            </button>
            <button
              onClick={applySuggestions}
              disabled={applyingSuggestions || reviewedSuggestions.length === 0}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              <Link2 size={12} />
              Apply Approved ({reviewedSuggestions.length})
            </button>
          </div>
        </div>

        {liveSuggestions.length > 0 ? (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left sticky top-0 z-10">
                <tr>
                  <th className="p-3">Local Product</th>
                  <th className="p-3">Shopify Variant</th>
                  <th className="p-3">Confidence</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {liveSuggestions.map((s, idx) => {
                  const isExcluded =
                    excludedSuggestionKeys[suggestionKey(s, idx)];
                  return (
                    <tr
                      key={suggestionKey(s, idx)}
                      className={`border-t border-slate-100 ${isExcluded ? "bg-slate-50 opacity-60" : ""}`}
                    >
                      <td className="p-3">
                        <div className="font-medium text-slate-700">
                          {s.product_name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {s.local_barcode}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="text-slate-600">{s.shopify_title}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {s.shopify_variant_id}
                        </div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${s.confidence === "exact_barcode" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}
                        >
                          {s.confidence}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => toggleSuggestion(s, idx)}
                          className={`px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-wider ${isExcluded ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                        >
                          {isExcluded ? "Approve" : "Exclude"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400 italic text-sm">
            No suggestions generated. Click "Generate Suggestions" to use
            AI-assisted matching.
          </div>
        )}
      </div>

      {applySuggestionConflicts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h4 className="text-sm font-bold text-amber-800 flex items-center gap-2 mb-2">
            <ShieldAlert size={16} /> Apply Conflicts
          </h4>
          <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
            {applySuggestionConflicts.map((c, i) => (
              <li key={i}>
                {c.reason} for variant {c.shopify_variant_id}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
