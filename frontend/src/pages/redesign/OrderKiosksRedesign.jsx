import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Monitor, Copy, Trash2, ExternalLink, Plus } from "lucide-react";
import {
  PageShell,
  SectionCard,
  Button,
  Select,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  EmptyState,
  Badge,
} from "../../ui/primitives";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { api } from "../../api";
import { IS_MULTI_TENANT } from "../../config";
import { readTenantSlug } from "../../auth/authStore";
import { fmtUtcDateTime } from "../../utils/dates";

// Manager-facing launcher for restaurant order kiosks. Mints/lists/revokes
// counter slots and table-mode tokens. The customer-facing surface is
// frontend/src/pages/public/PublicRestaurantMenuPage.jsx — accessed via the
// /menu/<token> URL produced here.
//
// Gated by phase4_restaurant_qr + manage_restaurant + restaurant mode.
// See docs/plans/2026-05-06-order-kiosk-design.md.

function buildKioskUrl(token) {
  if (typeof window === "undefined") return "";
  const slug = IS_MULTI_TENANT ? readTenantSlug() : "";
  const tenantQuery = slug ? `?tenant=${encodeURIComponent(slug)}` : "";
  return `${window.location.origin}/menu/${encodeURIComponent(token)}${tenantQuery}`;
}

export default function OrderKiosksRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { success, error } = useToast();

  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");
  const [tables, setTables] = useState([]);
  const [data, setData] = useState({ counters: [], tables: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [pickedTable, setPickedTable] = useState("");
  const [counterLabel, setCounterLabel] = useState("");

  const loadOutlets = useCallback(async () => {
    try {
      const list = await api.get("/api/outlets");
      const arr = Array.isArray(list) ? list : list?.outlets || [];
      setOutlets(arr);
      if (arr.length && !outletId) setOutletId(String(arr[0].id));
    } catch (e) {
      error(e?.message || "Failed to load outlets");
    }
  }, [error, outletId]);

  const loadTokens = useCallback(async (oid) => {
    if (!oid) return;
    setLoading(true);
    try {
      const res = await api.get("/api/restaurant/kiosk-tokens", { outlet_id: oid });
      setData({ counters: res.counters || [], tables: res.tables || [] });
      setTables(res.available_tables || []);
    } catch (e) {
      error(e?.message || "Failed to load kiosk tokens");
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => { loadOutlets(); }, [loadOutlets]);
  useEffect(() => {
    if (outletId) loadTokens(outletId);
  }, [outletId, loadTokens]);

  if (flagsLoading) return null;
  if (!flags.phase4_restaurant_qr) return <Navigate to="/" replace />;
  if (!hasPerm("manage_restaurant")) return <Navigate to="/" replace />;

  const launchCounter = async () => {
    if (!outletId) return;
    setBusy(true);
    try {
      const res = await api.post("/api/restaurant/kiosk-tokens", {
        outlet_id: Number(outletId),
        label: counterLabel.trim() || null,
      });
      success("Counter kiosk launched");
      const url = buildKioskUrl(res.token);
      try { await navigator.clipboard.writeText(url); } catch {}
      setCounterLabel("");
      await loadTokens(outletId);
    } catch (e) {
      error(e?.message || "Failed to launch counter kiosk");
    } finally {
      setBusy(false);
    }
  };

  const launchTable = async () => {
    if (!outletId || !pickedTable) return;
    setBusy(true);
    try {
      const res = await api.post("/api/restaurant/kiosk-tokens", {
        outlet_id: Number(outletId),
        table_id: Number(pickedTable),
      });
      success(`Kiosk launched for ${res.table_label || `table #${pickedTable}`}`);
      const url = buildKioskUrl(res.token);
      try { await navigator.clipboard.writeText(url); } catch {}
      setPickedTable("");
      setTableModalOpen(false);
      await loadTokens(outletId);
    } catch (e) {
      error(e?.message || "Failed to launch table kiosk");
    } finally {
      setBusy(false);
    }
  };

  const revokeCounter = async (id, label) => {
    setBusy(true);
    try {
      await api.del(`/api/restaurant/kiosk-tokens/counter/${id}`);
      success(`Revoked ${label || "counter kiosk"}`);
      await loadTokens(outletId);
    } catch (e) {
      error(e?.message || "Failed to revoke");
    } finally {
      setBusy(false);
    }
  };

  const revokeTable = async (id, label) => {
    setBusy(true);
    try {
      await api.del(`/api/restaurant/kiosk-tokens/table/${id}`);
      success(`Revoked ${label || "table kiosk"}`);
      await loadTokens(outletId);
    } catch (e) {
      error(e?.message || "Failed to revoke");
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async (token) => {
    try {
      await navigator.clipboard.writeText(buildKioskUrl(token));
      success("Kiosk URL copied to clipboard");
    } catch {
      error("Could not copy — your browser blocked clipboard access");
    }
  };

  const rows = useMemo(() => {
    return [
      ...data.counters.map((c) => ({ ...c, kind: "counter" })),
      ...data.tables.map((t) => ({ ...t, kind: "table" })),
    ];
  }, [data]);

  return (
    <PageShell
      title="Order Kiosks"
      subtitle="Set up tablets at your counter or each table. Customers tap to order; orders land in the Restaurant Inbox for staff to accept."
    >
      <SectionCard>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-(--ui-text-muted) mb-1">Outlet</label>
            <Select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-(--ui-text-muted) mb-1">
              Counter label <span className="text-(--ui-text-muted)">(optional)</span>
            </label>
            <Input
              value={counterLabel}
              onChange={(e) => setCounterLabel(e.target.value)}
              placeholder="e.g. Front counter"
              maxLength={64}
            />
          </div>
          <Button tone="primary" onClick={launchCounter} disabled={busy || !outletId}>
            <Plus size={14} className="mr-1" /> Launch counter kiosk
          </Button>
          <Button tone="default" onClick={() => setTableModalOpen(true)} disabled={busy || !outletId}>
            <Plus size={14} className="mr-1" /> Launch table kiosk
          </Button>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="flex items-center gap-2 text-sm text-(--ui-text-muted) mb-3">
          <Monitor size={16} />
          <span>{rows.length} active kiosk{rows.length === 1 ? "" : "s"}</span>
        </div>

        {loading ? (
          <div className="text-sm text-(--ui-text-muted)">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No active kiosks for this outlet"
            body="Launch a counter kiosk or assign one to a table to get started."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-(--ui-border)">
                  <th className="py-2 pr-4 font-semibold">Type</th>
                  <th className="py-2 pr-4 font-semibold">Label / Table</th>
                  <th className="py-2 pr-4 font-semibold">Created</th>
                  <th className="py-2 pr-4 font-semibold">URL</th>
                  <th className="py-2 pr-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const url = buildKioskUrl(row.token);
                  const isCounter = row.kind === "counter";
                  return (
                    <tr key={`${row.kind}-${row.id}`} className="border-b border-(--ui-border)">
                      <td className="py-2 pr-4">
                        <Badge tone={isCounter ? "success" : "default"}>
                          {isCounter ? "Counter" : "Table"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        {isCounter
                          ? (row.label || "Counter kiosk")
                          : (row.table_label || `Table #${row.table_id}`)}
                      </td>
                      <td className="py-2 pr-4 text-(--ui-text-muted)">
                        {fmtUtcDateTime(row.created_at)}
                      </td>
                      <td className="py-2 pr-4 truncate max-w-md font-mono text-xs text-(--ui-text-muted)">
                        {url}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" tone="default" onClick={() => copyUrl(row.token)}>
                            <Copy size={14} className="mr-1" /> Copy
                          </Button>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-(--ui-border) bg-(--ui-surface) px-3 py-1.5 text-xs font-medium hover:bg-(--ui-muted-surface)"
                          >
                            <ExternalLink size={14} /> Open
                          </a>
                          <Button
                            size="sm"
                            tone="danger"
                            onClick={() => isCounter
                              ? revokeCounter(row.id, row.label)
                              : revokeTable(row.id, row.table_label)
                            }
                            disabled={busy}
                          >
                            <Trash2 size={14} className="mr-1" /> Revoke
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal
        open={tableModalOpen}
        onClose={() => setTableModalOpen(false)}
        title="Launch a table kiosk"
      >
        <ModalBody>
          <p className="text-sm text-(--ui-text-muted)">
            Pick the table this tablet will live at. The kiosk URL is a stable bookmark for that table — orders land on the matching check.
          </p>
          <label className="block text-xs font-medium text-(--ui-text-muted)">Table</label>
          <Select value={pickedTable} onChange={(e) => setPickedTable(e.target.value)}>
            <option value="">Select a table…</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Select>
          {tables.length === 0 && (
            <p className="text-xs text-(--ui-text-muted) italic">
              No tables configured for this outlet. Add tables on the Floor Plan page first.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button tone="default" onClick={() => setTableModalOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button tone="primary" onClick={launchTable} disabled={busy || !pickedTable}>
            Launch
          </Button>
        </ModalFooter>
      </Modal>
    </PageShell>
  );
}
