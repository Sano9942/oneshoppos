import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Link2,
  RefreshCw,
  ShieldAlert,
  Unplug,
  Upload,
  Download,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

import { API } from '../config';

function statusClass(value) {
  const v = String(value || "").toLowerCase();
  if (["processed", "completed", "ok", "matched", "resolved"].includes(v)) return "bg-emerald-100 text-emerald-700";
  if (["failed", "completed_with_errors", "dead_letter", "error", "mismatch"].includes(v)) return "bg-rose-100 text-rose-700";
  if (["running", "pending", "retry", "open"].includes(v)) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function ShopifyIntegration() {
  const { authHeaders } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingPush, setSyncingPush] = useState(false);
  const [syncingPull, setSyncingPull] = useState(false);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [runningLiveValidation, setRunningLiveValidation] = useState(false);
  const [loadingWebhookSetup, setLoadingWebhookSetup] = useState(false);
  const [loadingUatChecklist, setLoadingUatChecklist] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [savingLocationOutletId, setSavingLocationOutletId] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [applyingSuggestions, setApplyingSuggestions] = useState(false);
  const [runningReconciliation, setRunningReconciliation] = useState(false);
  const [loadingReconciliation, setLoadingReconciliation] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [importingProducts, setImportingProducts] = useState(false);
  const [importingInventory, setImportingInventory] = useState(false);
  const [deletingImport, setDeletingImport] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [inventorySyncResult, setInventorySyncResult] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [config, setConfig] = useState({
    connected: false,
    shop_domain: "",
    access_token: "",
    api_version: "2025-10",
    webhook_secret: "",
    default_location_id: "",
  });
  const [status, setStatus] = useState(null);
  const [liveValidation, setLiveValidation] = useState(null);
  const [webhookSetup, setWebhookSetup] = useState(null);
  const [uatChecklist, setUatChecklist] = useState(null);
  const [events, setEvents] = useState([]);
  const [liveLocations, setLiveLocations] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [locationMappings, setLocationMappings] = useState([]);
  const [locationDraftByOutlet, setLocationDraftByOutlet] = useState({});
  const [liveSuggestions, setLiveSuggestions] = useState([]);
  const [excludedSuggestionKeys, setExcludedSuggestionKeys] = useState({});
  const [applySuggestionConflicts, setApplySuggestionConflicts] = useState([]);
  const [reconciliationRows, setReconciliationRows] = useState([]);
  const [eventFilters, setEventFilters] = useState({
    status: "",
    entity_type: "",
    direction: "",
    search: "",
  });
  const [reconFilters, setReconFilters] = useState({
    status: "",
    resolution_status: "",
  });
  const [mappingCounts, setMappingCounts] = useState({
    products: 0,
    locations: 0,
    customers: 0,
  });
  const [pendingReconciliationApprovals, setPendingReconciliationApprovals] = useState({});

  const apiFetch = useCallback(
    (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      const merged = authHeaders();
      Object.entries(merged).forEach(([key, value]) => headers.set(key, value));
      return fetch(url, { ...options, headers });
    },
    [authHeaders],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [cfgRes, statusRes, eventsRes, prodMapRes, locMapRes, custMapRes, outletsRes, approvalsRes] = await Promise.all([
        apiFetch(`${API}/integrations/shopify/config`),
        apiFetch(`${API}/integrations/shopify/status`),
        apiFetch(`${API}/integrations/shopify/events?limit=100`),
        apiFetch(`${API}/integrations/mappings/products`),
        apiFetch(`${API}/integrations/mappings/locations`),
        apiFetch(`${API}/integrations/mappings/customers`),
        apiFetch(`${API}/outlets`),
        apiFetch(`${API}/approvals`),
      ]);

      const cfg = await cfgRes.json();
      const st = await statusRes.json();
      const ev = await eventsRes.json();
      const pm = await prodMapRes.json();
      const lm = await locMapRes.json();
      const cm = await custMapRes.json();
      const outletsData = await outletsRes.json();
      const approvalsData = await approvalsRes.json().catch(() => ({ approvals: [] }));

      if (!cfgRes.ok) throw new Error(cfg.error || "Failed loading config");
      if (!statusRes.ok) throw new Error(st.error || "Failed loading status");
      if (!eventsRes.ok) throw new Error(ev.error || "Failed loading events");

      const next = cfg.connected && cfg.config
        ? {
          connected: true,
          shop_domain: cfg.config.shop_domain || "",
          access_token: "",
          api_version: cfg.config.api_version || "2025-10",
          webhook_secret: "",
          default_location_id: cfg.config.default_location_id || "",
        }
        : {
          connected: false,
          shop_domain: "",
          access_token: "",
          api_version: "2025-10",
          webhook_secret: "",
          default_location_id: "",
        };

      setConfig(next);
      setStatus(st);
      setEvents(ev.events || []);
      setLocationMappings(lm.mappings || []);
      setOutlets(outletsData.outlets || []);
      setMappingCounts({
        products: (pm.mappings || []).length,
        locations: (lm.mappings || []).length,
        customers: (cm.mappings || []).length,
      });
      const pendingMap = {};
      (approvalsData.approvals || []).forEach((a) => {
        if (a.reference_type === "reconciliation" && a.status === "pending_approval") {
          pendingMap[Number(a.reference_id)] = true;
        }
      });
      setPendingReconciliationApprovals(pendingMap);
      const preferredByOutlet = {};
      (lm.mappings || []).forEach((row) => {
        if (!preferredByOutlet[row.outlet_id]) {
          preferredByOutlet[row.outlet_id] = row.shopify_location_id;
        }
      });
      setLocationDraftByOutlet((prev) => {
        const nextDraft = { ...prev };
        (outletsData.outlets || []).forEach((outlet) => {
          const mapped = preferredByOutlet[outlet.id] || "";
          nextDraft[outlet.id] = nextDraft[outlet.id] || mapped;
        });
        return nextDraft;
      });
      await loadReconciliation(true);
      if (next.connected) {
        apiFetch(`${API}/integrations/shopify/webhooks/setup`)
          .then((r) => r.json())
          .then((d) => setWebhookSetup(d))
          .catch(() => {});
        apiFetch(`${API}/integrations/shopify/uat-checklist`)
          .then((r) => r.json())
          .then((d) => setUatChecklist(d))
          .catch(() => {});
      } else {
        setWebhookSetup(null);
        setUatChecklist(null);
      }
    } catch (e) {
      setError(e.message || "Failed to load Shopify integration data");
    } finally {
      setLoading(false);
    }
  // loadReconciliation is declared later in this component and intentionally referenced here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const summary = useMemo(() => {
    const s = status?.event_stats || {};
    return {
      total: s.total || 0,
      processed: s.processed || 0,
      failed: s.failed || 0,
      pending: s.pending || 0,
    };
  }, [status]);

  const filteredReconciliationRows = useMemo(() => {
    return (reconciliationRows || []).filter((r) => {
      if (reconFilters.status && String(r.status || "") !== reconFilters.status) return false;
      if (
        reconFilters.resolution_status &&
        String(r.resolution_status || "open") !== reconFilters.resolution_status
      ) return false;
      return true;
    });
  }, [reconciliationRows, reconFilters]);

  const suggestionKey = (s, idx) =>
    `${s.product_id || "p"}:${s.variant_id || "v"}:${s.shopify_variant_id || "sv"}:${idx}`;

  const mappingByOutlet = useMemo(() => {
    const out = {};
    (locationMappings || []).forEach((row) => {
      if (!out[row.outlet_id]) out[row.outlet_id] = row;
    });
    return out;
  }, [locationMappings]);

  const reviewedSuggestions = useMemo(
    () =>
      (liveSuggestions || []).filter((s, idx) => {
        const key = suggestionKey(s, idx);
        return !excludedSuggestionKeys[key];
      }),
    [liveSuggestions, excludedSuggestionKeys],
  );

  const loadEvents = async (silent = false, overrides = null) => {
    if (!silent) {
      setLoadingEvents(true);
      setError("");
    }
    try {
      const effective = overrides || eventFilters;
      const qs = new URLSearchParams();
      qs.set("limit", "100");
      if (effective.status) qs.set("status", effective.status);
      if (effective.entity_type) qs.set("entity_type", effective.entity_type);
      if (effective.direction) qs.set("direction", effective.direction);
      if (effective.search) qs.set("search", effective.search);
      const res = await apiFetch(`${API}/integrations/shopify/events?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load events");
      setEvents(data.events || []);
    } catch (e) {
      if (!silent) setError(e.message || "Failed to load events");
    } finally {
      if (!silent) setLoadingEvents(false);
    }
  };

  const saveConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        shop_domain: config.shop_domain.trim().toLowerCase(),
        access_token: config.access_token.trim(),
        api_version: config.api_version.trim(),
        webhook_secret: config.webhook_secret.trim() || null,
        default_location_id: config.default_location_id.trim() || null,
      };
      const res = await apiFetch(`${API}/integrations/shopify/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save config");
      setSuccess("Shopify connection saved.");
      setConfig((p) => ({ ...p, access_token: "", webhook_secret: "", connected: true }));
      await loadAll();
    } catch (e2) {
      setError(e2.message || "Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setError("");
    setSuccess("");
    const res = await apiFetch(`${API}/integrations/shopify/disconnect`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to disconnect");
      return;
    }
    setSuccess("Shopify disconnected.");
    await loadAll();
  };

  const runPush = async () => {
    setSyncingPush(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/sync/push-inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Push failed");
      setSuccess(`Inventory push run recorded (events: ${data.queued || 0}).`);
      await loadAll();
    } catch (e) {
      setError(e.message || "Push failed");
    } finally {
      setSyncingPush(false);
    }
  };

  const runPull = async () => {
    setSyncingPull(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/sync/pull-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pull failed");
      setSuccess(`Order pull completed (processed: ${data.processed || 0}, failed: ${data.failed || 0}).`);
      await loadAll();
    } catch (e) {
      setError(e.message || "Pull failed");
    } finally {
      setSyncingPull(false);
    }
  };

  const verify = async () => {
    setVerifying(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/verify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      setSuccess(`Verified with Shopify shop: ${data.shop?.myshopifyDomain || data.shop?.name || "OK"}`);
    } catch (e) {
      setError(e.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const runLiveValidation = async () => {
    setRunningLiveValidation(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/live-validation`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Live validation failed");
      setLiveValidation(data);
      setSuccess("Live validation completed.");
    } catch (e) {
      setError(e.message || "Live validation failed");
    } finally {
      setRunningLiveValidation(false);
    }
  };

  const loadWebhookSetup = async () => {
    setLoadingWebhookSetup(true);
    setError("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/webhooks/setup`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load webhook setup");
      setWebhookSetup(data);
    } catch (e) {
      setError(e.message || "Failed to load webhook setup");
    } finally {
      setLoadingWebhookSetup(false);
    }
  };

  const loadUatChecklist = async () => {
    setLoadingUatChecklist(true);
    setError("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/uat-checklist`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load UAT checklist");
      setUatChecklist(data);
    } catch (e) {
      setError(e.message || "Failed to load UAT checklist");
    } finally {
      setLoadingUatChecklist(false);
    }
  };

  const loadLiveLocations = async () => {
    setLoadingLocations(true);
    setError("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/locations/live`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch Shopify locations");
      setLiveLocations(data.locations || []);
    } catch (e) {
      setError(e.message || "Failed to fetch Shopify locations");
    } finally {
      setLoadingLocations(false);
    }
  };

  const saveLocationMapping = async (outletId) => {
    const shopifyLocationId = String(locationDraftByOutlet[outletId] || "").trim();
    if (!shopifyLocationId) {
      setError("Please select a Shopify location before saving.");
      return;
    }
    const selectedLocation = (liveLocations || []).find((loc) => String(loc.id) === shopifyLocationId);
    setSavingLocationOutletId(outletId);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/mappings/locations/${outletId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopify_location_id: shopifyLocationId,
          shopify_location_name: selectedLocation?.name || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save location mapping");
      setSuccess(`Mapped "${selectedLocation?.name || shopifyLocationId}" saved successfully.`);
      // Reload only location mappings so liveLocations dropdown stays populated
      const lmRes = await apiFetch(`${API}/integrations/mappings/locations`);
      const lm = await lmRes.json();
      setLocationMappings(lm.mappings || []);
      setMappingCounts((prev) => ({ ...prev, locations: (lm.mappings || []).length }));
    } catch (e) {
      setError(e.message || "Failed to save location mapping");
    } finally {
      setSavingLocationOutletId(null);
    }
  };

  const processPending = async () => {
    setProcessingQueue(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/sync/process-pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Queue processing failed");
      setSuccess(`Queue processed: ${data.processed || 0} processed, ${data.failed || 0} failed, ${data.skipped || 0} skipped.`);
      await loadAll();
    } catch (e) {
      setError(e.message || "Queue processing failed");
    } finally {
      setProcessingQueue(false);
    }
  };

  const retryFailed = async () => {
    setRetryingFailed(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/sync/retry-failed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 200 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to queue retries");
      setSuccess(`Queued ${data.queued || 0} failed event(s) for retry.`);
      await loadEvents(true);
      await loadAll();
    } catch (e) {
      setError(e.message || "Failed to queue retries");
    } finally {
      setRetryingFailed(false);
    }
  };

  const importProductsFromShopify = async () => {
    setImportingProducts(true);
    setImportResult(null);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/import/products`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResult(data);
      setSuccess(`Import complete: ${data.created || 0} created, ${data.updated || 0} updated, ${data.skipped || 0} skipped.`);
      await loadAll();
    } catch (e) {
      setError(e.message || "Product import failed");
    } finally {
      setImportingProducts(false);
    }
  };

  const syncInventoryFromShopify = async () => {
    setImportingInventory(true);
    setInventorySyncResult(null);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/import/inventory`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inventory sync failed");
      setInventorySyncResult(data);
      setSuccess(`Inventory synced: ${data.synced || 0} stock records updated from Shopify.`);
    } catch (e) {
      setError(e.message || "Inventory sync failed");
    } finally {
      setImportingInventory(false);
    }
  };

  const deleteShopifyImportedProducts = async () => {
    if (!window.confirm("This will permanently delete ALL products that were imported from Shopify, along with their stock records and Shopify mappings. This cannot be undone. Continue?")) return;
    setDeletingImport(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/import/products`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setImportResult(null);
      setInventorySyncResult(null);
      setSuccess(data.message || `Deleted ${data.deleted || 0} Shopify-imported product(s).`);
      await loadAll();
    } catch (e) {
      setError(e.message || "Delete failed");
    } finally {
      setDeletingImport(false);
    }
  };

  const retrySingleEvent = async (id) => {
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/shopify/sync/retry-event/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to retry event");
      setSuccess(`Event #${id} queued for retry.`);
      await loadEvents(true);
    } catch (e) {
      setError(e.message || "Failed to retry event");
    }
  };

  const loadSuggestions = async () => {
    setLoadingSuggestions(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/mappings/products/auto-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 10000 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate suggestions");
      setLiveSuggestions(data.suggestions || []);
      setExcludedSuggestionKeys({});
      setApplySuggestionConflicts([]);
      setSuccess(`Generated ${data.suggestion_count || 0} live mapping suggestion(s).`);
    } catch (e) {
      setError(e.message || "Failed to generate suggestions");
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const applySuggestions = async () => {
    if (reviewedSuggestions.length === 0) return;
    setApplyingSuggestions(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/integrations/mappings/products/apply-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestions: reviewedSuggestions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to apply suggestions");
      const conflictCount = (data.conflicts || []).length;
      setApplySuggestionConflicts(data.conflicts || []);
      setLiveSuggestions([]);
      setExcludedSuggestionKeys({});
      setSuccess(
        `Suggestion apply done. Applied: ${data.applied || 0}, Skipped: ${data.skipped || 0}, Conflicts: ${conflictCount}.`,
      );
      await loadAll();
    } catch (e) {
      setError(e.message || "Failed to apply suggestions");
    } finally {
      setApplyingSuggestions(false);
    }
  };

  const toggleSuggestion = (s, idx) => {
    const key = suggestionKey(s, idx);
    setExcludedSuggestionKeys((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const loadReconciliation = async (silent = false) => {
    if (!silent) {
      setLoadingReconciliation(true);
      setError("");
    }
    try {
      const res = await apiFetch(`${API}/reconciliation/inventory`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load reconciliation");
      setReconciliationRows(data.rows || []);
    } catch (e) {
      if (!silent) setError(e.message || "Failed to load reconciliation");
    } finally {
      if (!silent) setLoadingReconciliation(false);
    }
  };

  const runReconciliation = async () => {
    setRunningReconciliation(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/reconciliation/inventory/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run reconciliation");
      setSuccess(
        `Reconciliation completed. Rows: ${data.row_count || 0}, mismatch: ${data.mismatch || 0}, errors: ${data.errors || 0}`,
      );
      await loadReconciliation(true);
    } catch (e) {
      setError(e.message || "Failed to run reconciliation");
    } finally {
      setRunningReconciliation(false);
    }
  };

  const resolveReconciliation = async (id, resolution_status) => {
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/reconciliation/inventory/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution_status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update reconciliation row");
      setSuccess("Reconciliation row updated.");
      await loadReconciliation(true);
    } catch (e) {
      setError(e.message || "Failed to update reconciliation row");
    }
  };

  const requestReconciliationFix = async (id, mode) => {
    if (pendingReconciliationApprovals[Number(id)]) {
      setError("A reconciliation approval is already pending for this row. Review it in Approvals.");
      return;
    }
    const prompt =
      mode === "push_to_shopify"
        ? "Submit approval request to push local quantity to Shopify for this row?"
        : "Submit approval request to pull Shopify quantity to local stock for this row?";
    if (!window.confirm(prompt)) return;

    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`${API}/reconciliation/inventory/${id}/request-fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit corrective action request");
      setSuccess(data.message || "Corrective action approval request submitted.");
      setPendingReconciliationApprovals((prev) => ({ ...prev, [Number(id)]: true }));
      await loadReconciliation(true);
    } catch (e) {
      setError(e.message || "Failed to submit corrective action request");
    }
  };

  const exportReconciliationCsv = () => {
    const rows = filteredReconciliationRows || [];
    if (rows.length === 0) {
      setError("No reconciliation rows available to export.");
      return;
    }
    const headers = [
      "id",
      "product_id",
      "product_name",
      "variant_id",
      "outlet_id",
      "outlet_name",
      "external_location_id",
      "local_qty",
      "external_qty",
      "diff",
      "status",
      "resolution_status",
      "resolution_note",
      "checked_at",
      "resolved_at",
    ];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      headers.join(","),
      ...rows.map((r) =>
        [
          r.id,
          r.product_id,
          r.product_name,
          r.variant_id,
          r.outlet_id,
          r.outlet_name,
          r.external_location_id,
          r.local_qty,
          r.external_qty,
          r.diff,
          r.status,
          r.resolution_status || "open",
          r.resolution_note || "",
          r.checked_at || "",
          r.resolved_at || "",
        ]
          .map(esc)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Shopify Integration</h2>
          <p className="text-sm text-slate-500">
            Configure connection, run manual syncs, and monitor sync events.
          </p>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          <RefreshCw size={14} />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg text-sm">
          <ShieldAlert size={16} className="mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-lg text-sm">
          <CheckCircle2 size={16} className="mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Connection</div>
          <div className="mt-2 text-lg font-bold text-slate-800">
            {status?.connected ? "Connected" : "Not Connected"}
          </div>
          <div className="text-xs text-slate-500 mt-1">{status?.shop_domain || "-"}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Events</div>
          <div className="mt-2 text-lg font-bold text-slate-800">{summary.total}</div>
          <div className="text-xs text-slate-500 mt-1">
            Processed {summary.processed} | Failed {summary.failed} | Pending {summary.pending}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Mappings</div>
          <div className="mt-2 text-lg font-bold text-slate-800">
            {mappingCounts.products + mappingCounts.locations + mappingCounts.customers}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Products {mappingCounts.products} | Locations {mappingCounts.locations} | Customers {mappingCounts.customers}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Queue Health</div>
          <div className="mt-2 text-lg font-bold text-slate-800">
            Backlog {status?.queue_health?.backlog ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Retry due {status?.queue_health?.retry_due ?? 0} | Dead letter {status?.queue_health?.dead_letter ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Oldest backlog age {status?.queue_health?.oldest_backlog_minutes ?? "-"} min
          </div>
        </div>
      </div>

      {/* Inventory Sync Status */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">Inventory Sync Status</h3>
          <span className={`text-xs px-2 py-1 rounded-full ${config.connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {config.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100">
          <div className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Last Sync</div>
            <div className="text-sm font-semibold text-slate-800">
              {status?.last_sync_at ? new Date(status.last_sync_at).toLocaleString() : "Never"}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Processed Events</div>
            <div className="text-sm font-semibold text-slate-800">
              {status?.event_stats?.processed ?? 0}
              <span className="text-xs text-slate-400 ml-1">/ {status?.event_stats?.total ?? 0} total</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Pending / Failed</div>
            <div className="text-sm font-semibold text-slate-800">
              {status?.event_stats?.pending ?? 0}
              <span className="text-xs text-slate-400 mx-1">/</span>
              <span className="text-rose-600">{status?.event_stats?.failed ?? 0}</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Mapped Products</div>
            <div className="text-sm font-semibold text-slate-800">
              {mappingCounts.products}
              <span className="text-xs text-slate-400 ml-1">products</span>
            </div>
          </div>
        </div>
        {status?.last_error && (
          <div className="px-4 py-2 bg-rose-50 border-t border-rose-100 text-xs text-rose-700">
            Last error: {status.last_error}
          </div>
        )}
        {mappingCounts.locations === 0 && config.connected && (
          <div className="px-4 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-700">
            No location mappings configured — click "Fetch Live Locations" then map each POS outlet to a Shopify location below.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Connection Settings</h3>
          <form onSubmit={saveConfig} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Shop Domain</label>
                <input
                  value={config.shop_domain}
                  onChange={(e) => setConfig((p) => ({ ...p, shop_domain: e.target.value }))}
                  placeholder="your-store.myshopify.com"
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">API Version</label>
                <input
                  value={config.api_version}
                  onChange={(e) => setConfig((p) => ({ ...p, api_version: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Admin Access Token</label>
                <input
                  type="password"
                  value={config.access_token}
                  onChange={(e) => setConfig((p) => ({ ...p, access_token: e.target.value }))}
                  placeholder={config.connected ? "Enter new token to rotate" : "shpat_..."}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  required={!config.connected}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Webhook Secret (optional)</label>
                <input
                  type="password"
                  value={config.webhook_secret}
                  onChange={(e) => setConfig((p) => ({ ...p, webhook_secret: e.target.value }))}
                  placeholder="whsec_..."
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Default Shopify Location ID</label>
                <input
                  value={config.default_location_id}
                  onChange={(e) => setConfig((p) => ({ ...p, default_location_id: e.target.value }))}
                  placeholder="Location ID"
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
              >
                <Link2 size={14} />
                {saving ? "Saving..." : "Save Connection"}
              </button>
              <button
                type="button"
                onClick={disconnect}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold"
              >
                <Unplug size={14} />
                Disconnect
              </button>
              <button
                type="button"
                onClick={verify}
                disabled={verifying}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
              >
                <CheckCircle2 size={14} />
                {verifying ? "Verifying..." : "Verify Connection"}
              </button>
              <button
                type="button"
                onClick={runLiveValidation}
                disabled={runningLiveValidation}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
              >
                <ShieldAlert size={14} />
                {runningLiveValidation ? "Validating..." : "Run Live Validation"}
              </button>
              <button
                type="button"
                onClick={loadLiveLocations}
                disabled={loadingLocations}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
              >
                <RefreshCw size={14} />
                {loadingLocations ? "Loading..." : "Fetch Live Locations"}
              </button>
              <button
                type="button"
                onClick={loadWebhookSetup}
                disabled={loadingWebhookSetup}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
              >
                <Link2 size={14} />
                {loadingWebhookSetup ? "Loading..." : "Webhook Setup"}
              </button>
              <button
                type="button"
                onClick={loadUatChecklist}
                disabled={loadingUatChecklist}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
              >
                <CheckCircle2 size={14} />
                {loadingUatChecklist ? "Loading..." : "Load UAT Checklist"}
              </button>
            </div>
          </form>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-lg font-semibold text-slate-800">Manual Sync</h3>
          <p className="text-xs text-slate-500">
            Use these controls to validate connector plumbing before live API automation.
          </p>
          <button
            onClick={runPush}
            disabled={syncingPush}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <Upload size={14} />
            {syncingPush ? "Running..." : "Push Inventory (Dry Run)"}
          </button>
          <button
            onClick={runPull}
            disabled={syncingPull}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <Download size={14} />
            {syncingPull ? "Running..." : "Pull Orders (Dry Run)"}
          </button>
          <button
            onClick={processPending}
            disabled={processingQueue}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <RefreshCw size={14} />
            {processingQueue ? "Running..." : "Process Pending Queue"}
          </button>
          <button
            onClick={retryFailed}
            disabled={retryingFailed}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <RefreshCw size={14} />
            {retryingFailed ? "Running..." : "Retry Failed Events"}
          </button>
          <button
            onClick={loadSuggestions}
            disabled={loadingSuggestions}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <RefreshCw size={14} />
            {loadingSuggestions ? "Running..." : "Generate Live Suggestions"}
          </button>
          <button
            onClick={applySuggestions}
            disabled={applyingSuggestions || reviewedSuggestions.length === 0}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <Link2 size={14} />
            {applyingSuggestions ? "Applying..." : `Apply Approved (${reviewedSuggestions.length})`}
          </button>
          <div className="text-xs text-slate-500 border-t border-slate-100 pt-3">
            Last run: {status?.last_run?.finished_at || status?.last_run?.started_at || "-"}
            <span className={`ml-2 px-2 py-0.5 rounded-full ${statusClass(status?.last_run?.status)}`}>
              {status?.last_run?.status || "n/a"}
            </span>
          </div>
        </div>

        {/* Import from Shopify */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-lg font-semibold text-slate-800">Import from Shopify</h3>
          <p className="text-xs text-slate-500">
            Pull products and inventory levels directly from Shopify into POS. Products are matched by barcode and created or updated automatically.
          </p>
          <button
            onClick={importProductsFromShopify}
            disabled={importingProducts || !config.connected}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <Download size={14} />
            {importingProducts ? "Importing..." : "Import Products from Shopify"}
          </button>
          <button
            onClick={syncInventoryFromShopify}
            disabled={importingInventory || !config.connected}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <RefreshCw size={14} />
            {importingInventory ? "Syncing..." : "Sync Inventory Levels from Shopify"}
          </button>
          <p className="text-xs text-slate-400">
            <strong>Import Products</strong> — creates new POS products for Shopify variants that have a barcode, updates existing ones, and sets stock from Shopify inventory levels.<br />
            <strong>Sync Inventory</strong> — for already-mapped products, overwrites POS stock quantities with the current Shopify values.
          </p>
          <div className="border-t border-slate-100 pt-3">
            <button
              onClick={deleteShopifyImportedProducts}
              disabled={deletingImport}
              className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 border border-rose-300 text-rose-600 hover:bg-rose-50 rounded-lg text-sm font-semibold disabled:opacity-60"
            >
              {deletingImport ? "Deleting..." : "Delete All Shopify-Imported Products"}
            </button>
            <p className="text-xs text-rose-400 mt-1">Removes all products that were imported from Shopify and clears their stock + mappings. Use before re-testing import.</p>
          </div>
          {importResult && (
            <div className="mt-2 p-3 bg-violet-50 border border-violet-200 rounded-lg text-xs space-y-1">
              <div className="font-semibold text-violet-800">Last Product Import</div>
              <div className="flex gap-4 text-slate-700">
                <span>Created: <strong>{importResult.created}</strong></span>
                <span>Updated: <strong>{importResult.updated}</strong></span>
                <span>Skipped: <strong>{importResult.skipped}</strong></span>
              </div>
              {importResult.errors?.length > 0 && (
                <div className="text-rose-600 mt-1">{importResult.errors.length} error(s). First: {importResult.errors[0]?.error}</div>
              )}
            </div>
          )}
          {inventorySyncResult && (
            <div className="mt-2 p-3 bg-teal-50 border border-teal-200 rounded-lg text-xs space-y-1">
              <div className="font-semibold text-teal-800">Last Inventory Sync</div>
              <div className="flex gap-4 text-slate-700">
                <span>Synced: <strong>{inventorySyncResult.synced}</strong></span>
                <span>Failed: <strong>{inventorySyncResult.failed}</strong></span>
              </div>
              {inventorySyncResult.errors?.length > 0 && (
                <div className="text-rose-600 mt-1">{inventorySyncResult.errors.length} error(s). First: {inventorySyncResult.errors[0]?.error}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">Location Mapping</h3>
          <span className="text-xs text-slate-500">
            {outlets.length} outlet(s), {liveLocations.length} live location(s)
          </span>
        </div>
        {outlets.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No outlets found. Create a POS outlet first.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left p-3">POS Outlet</th>
                <th className="text-left p-3">Current Mapping</th>
                <th className="text-left p-3">Map To Shopify Location</th>
                <th className="text-right p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {outlets.map((outlet) => {
                const existing = mappingByOutlet[outlet.id];
                const draftValue = locationDraftByOutlet[outlet.id] || "";
                return (
                  <tr key={outlet.id} className="border-t border-slate-100">
                    <td className="p-3 text-slate-700">{outlet.name}</td>
                    <td className="p-3 text-slate-600">
                      {existing?.shopify_location_name || existing?.shopify_location_id || "Not mapped"}
                    </td>
                    <td className="p-3">
                      <select
                        value={draftValue}
                        onChange={(e) =>
                          setLocationDraftByOutlet((prev) => ({ ...prev, [outlet.id]: e.target.value }))
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-700"
                        disabled={liveLocations.length === 0}
                      >
                        <option value="">
                          {liveLocations.length === 0 ? "Fetch live locations first" : "Select Shopify location"}
                        </option>
                        {liveLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name} ({loc.id})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => saveLocationMapping(outlet.id)}
                        disabled={!draftValue || savingLocationOutletId === outlet.id}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold disabled:opacity-60"
                      >
                        {savingLocationOutletId === outlet.id ? "Saving..." : "Save Mapping"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {liveLocations.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-800">Live Shopify Locations</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left p-3">Location ID</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">State</th>
              </tr>
            </thead>
            <tbody>
              {liveLocations.map((loc) => (
                <tr key={loc.id} className="border-t border-slate-100">
                  <td className="p-3 text-slate-700">{loc.id}</td>
                  <td className="p-3 text-slate-700">{loc.name}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${loc.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                      {loc.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {liveValidation && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-800">Live Validation Result</h3>
            <span className={`text-xs px-2 py-1 rounded-full ${liveValidation.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
              {liveValidation.ok ? "PASS" : "CHECK REQUIRED"}
            </span>
          </div>
          <div className="p-4 text-sm text-slate-700 space-y-2">
            <div>Checked at: {liveValidation.checked_at || "-"}</div>
            <div>Shop: {liveValidation?.checks?.shop_connection?.myshopify_domain || "-"}</div>
            <div>Locations fetched: {liveValidation?.checks?.locations?.count ?? 0}</div>
            <div>
              Inventory sample: {liveValidation?.checks?.mapped_inventory_sample?.total ?? 0} checked,{" "}
              {liveValidation?.checks?.mapped_inventory_sample?.failed ?? 0} failed
            </div>
          </div>
        </div>
      )}

      {webhookSetup && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-800">Webhook Production Setup</h3>
          </div>
          <div className="p-4 text-sm text-slate-700 space-y-2">
            <div>Callback URL: <code className="text-xs">{webhookSetup.callback_url}</code></div>
            <div>Secret configured: {webhookSetup.secret_configured ? "Yes" : "No"}</div>
            <div>Topics: {(webhookSetup.required_topics || []).join(", ")}</div>
          </div>
        </div>
      )}

      {uatChecklist?.checklist?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-800">UAT Readiness Checklist</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left p-3">Item</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {uatChecklist.checklist.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="p-3 text-slate-700">{item.label}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${item.pass ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {item.pass ? "pass" : "pending"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {liveSuggestions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-800">Live Product Mapping Suggestions</h3>
            <span className="text-xs text-slate-500">{reviewedSuggestions.length}/{liveSuggestions.length} approved</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left p-3">Local Product</th>
                <th className="text-left p-3">Local SKU/Barcode</th>
                <th className="text-left p-3">Shopify Variant</th>
                <th className="text-left p-3">Confidence</th>
                <th className="text-right p-3">Decision</th>
              </tr>
            </thead>
            <tbody>
              {liveSuggestions.slice(0, 200).map((s, idx) => (
                <tr key={`${s.product_id}-${s.variant_id || "p"}-${idx}`} className="border-t border-slate-100">
                  <td className="p-3 text-slate-700">{s.product_name}</td>
                  <td className="p-3 text-slate-500">{s.local_sku || "-"} / {s.local_barcode || "-"}</td>
                  <td className="p-3 text-slate-700">{s.shopify_title || s.shopify_variant_id}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${s.confidence === "exact_barcode" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
                      {s.confidence}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => toggleSuggestion(s, idx)}
                      className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 hover:bg-slate-50"
                    >
                      {excludedSuggestionKeys[suggestionKey(s, idx)] ? "Include" : "Exclude"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {applySuggestionConflicts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200 flex items-center justify-between">
            <h3 className="text-base font-semibold text-amber-800">Mapping Conflicts</h3>
            <span className="text-xs text-amber-700">{applySuggestionConflicts.length} conflict(s)</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-amber-100/60 text-amber-800">
              <tr>
                <th className="text-left p-3">Local</th>
                <th className="text-left p-3">Shopify Variant</th>
                <th className="text-left p-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {applySuggestionConflicts.slice(0, 100).map((c, idx) => (
                <tr key={`${c.product_id || "p"}-${c.variant_id || "v"}-${idx}`} className="border-t border-amber-200/70">
                  <td className="p-3 text-amber-900">{c.product_id || "-"} / {c.variant_id || "-"}</td>
                  <td className="p-3 text-amber-900">{c.shopify_variant_id || "-"}</td>
                  <td className="p-3 text-amber-800">{c.reason || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">Inventory Reconciliation</h3>
          <div className="flex items-center gap-2">
            <select
              value={reconFilters.status}
              onChange={(e) => setReconFilters((p) => ({ ...p, status: e.target.value }))}
              className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-700"
            >
              <option value="">All Statuses</option>
              <option value="matched">matched</option>
              <option value="mismatch">mismatch</option>
              <option value="error">error</option>
            </select>
            <select
              value={reconFilters.resolution_status}
              onChange={(e) => setReconFilters((p) => ({ ...p, resolution_status: e.target.value }))}
              className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-700"
            >
              <option value="">All Resolutions</option>
              <option value="open">open</option>
              <option value="resolved">resolved</option>
              <option value="ignored">ignored</option>
            </select>
            <button
              onClick={() => loadReconciliation(false)}
              disabled={loadingReconciliation}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold disabled:opacity-60"
            >
              <RefreshCw size={12} />
              {loadingReconciliation ? "Loading..." : "Refresh"}
            </button>
            <button
              onClick={runReconciliation}
              disabled={runningReconciliation}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold disabled:opacity-60"
            >
              <RefreshCw size={12} />
              {runningReconciliation ? "Running..." : "Run Live Reconciliation"}
            </button>
            <button
              onClick={exportReconciliationCsv}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
            >
              Export CSV
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left p-3">Product</th>
              <th className="text-right p-3">Local Qty</th>
              <th className="text-right p-3">Shopify Qty</th>
              <th className="text-right p-3">Diff</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Resolution</th>
              <th className="text-right p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredReconciliationRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-400">No reconciliation rows yet.</td>
              </tr>
            ) : (
              filteredReconciliationRows.slice(0, 200).map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-3 text-slate-700">{r.product_name || r.product_id}</td>
                  <td className="p-3 text-right text-slate-600">{Number(r.local_qty || 0).toFixed(2)}</td>
                  <td className="p-3 text-right text-slate-600">{Number(r.external_qty || 0).toFixed(2)}</td>
                  <td className="p-3 text-right text-slate-700 font-semibold">{Number(r.diff || 0).toFixed(2)}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${statusClass(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500">{r.resolution_status || "open"}</td>
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-2">
                      {(() => {
                        const hasPendingApproval = Boolean(pendingReconciliationApprovals[Number(r.id)]);
                        const isOpen = String(r.resolution_status || "open") === "open";
                        const disableRequests = hasPendingApproval || !isOpen;
                        return (
                          <>
                            <button
                              onClick={() => requestReconciliationFix(r.id, "push_to_shopify")}
                              disabled={disableRequests}
                              className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              {hasPendingApproval ? "Push Pending" : "Request Push"}
                            </button>
                            <button
                              onClick={() => requestReconciliationFix(r.id, "pull_to_local")}
                              disabled={disableRequests}
                              className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              {hasPendingApproval ? "Pull Pending" : "Request Pull"}
                            </button>
                          </>
                        );
                      })()}
                      <button
                        onClick={() => resolveReconciliation(r.id, "resolved")}
                        className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Resolve
                      </button>
                      <button
                        onClick={() => resolveReconciliation(r.id, "ignored")}
                        className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Ignore
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-slate-800">Recent Sync Events</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={eventFilters.status}
              onChange={(e) => setEventFilters((p) => ({ ...p, status: e.target.value }))}
              className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-700"
            >
              <option value="">All Statuses</option>
              <option value="pending">pending</option>
              <option value="retry">retry</option>
              <option value="processed">processed</option>
              <option value="failed_mapping">failed_mapping</option>
              <option value="dead_letter">dead_letter</option>
            </select>
            <select
              value={eventFilters.entity_type}
              onChange={(e) => setEventFilters((p) => ({ ...p, entity_type: e.target.value }))}
              className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-700"
            >
              <option value="">All Entities</option>
              <option value="inventory">inventory</option>
              <option value="order">order</option>
            </select>
            <select
              value={eventFilters.direction}
              onChange={(e) => setEventFilters((p) => ({ ...p, direction: e.target.value }))}
              className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-700"
            >
              <option value="">All Directions</option>
              <option value="outbound">outbound</option>
              <option value="inbound">inbound</option>
            </select>
            <input
              value={eventFilters.search}
              onChange={(e) => setEventFilters((p) => ({ ...p, search: e.target.value }))}
              placeholder="Search key/error"
              className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-700"
            />
            <button
              onClick={() => loadEvents(false)}
              disabled={loadingEvents}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={12} />
              {loadingEvents ? "Loading..." : "Apply"}
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left p-3">ID</th>
                <th className="text-left p-3">Direction</th>
                <th className="text-left p-3">Entity</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Attempts</th>
                <th className="text-left p-3">Created</th>
                <th className="text-left p-3">Processed</th>
                <th className="text-right p-3">Action</th>
              </tr>
            </thead>
            <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-400">No sync events yet.</td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="p-3 text-slate-700 font-medium">#{e.id}</td>
                  <td className="p-3 text-slate-600">{e.direction}</td>
                  <td className="p-3 text-slate-600">{e.entity_type}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${statusClass(e.status)}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500">{e.attempt_count ?? 0}</td>
                  <td className="p-3 text-slate-500">{e.created_at || "-"}</td>
                  <td className="p-3 text-slate-500">{e.processed_at || "-"}</td>
                  <td className="p-3 text-right">
                    {["failed_mapping", "dead_letter", "retry", "failed"].includes(String(e.status || "")) ? (
                      <button
                        onClick={() => retrySingleEvent(e.id)}
                        className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Retry
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
