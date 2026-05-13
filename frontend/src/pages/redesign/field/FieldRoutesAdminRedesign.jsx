import { useState, useEffect, useMemo, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { ArrowUp, ArrowDown, X, Plus, Save, Search } from "lucide-react";
import { api } from "../../../api";
import { useAuth } from "../../../auth/AuthProvider";
import { useToast } from "../../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Input, Select, EmptyState } from "../../../ui/primitives";
import useFeatureFlags from "../../../hooks/useFeatureFlags";

const DAY_TABS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const MAX_PER_DAY = 50;

/**
 * Tier 1.1.5 wholesale: owner-facing route assignment UI.
 *
 * Lets an owner build a field rep's weekly beat without touching SQL.
 * Pick a rep, pick a day, add customers from the picker, reorder with
 * arrows, Save. Replace-all semantics per (rep, day) — matches the
 * existing POST /api/admin/field-routes contract.
 */
export default function FieldRoutesAdminRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { success: toastOk, error: toastErr } = useToast();
  const authHeadersMemo = useMemo(() => authHeaders, [authHeaders]);
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeadersMemo);

  const [reps, setReps] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [activeDay, setActiveDay] = useState(new Date().getDay());

  const [allCustomers, setAllCustomers] = useState([]);
  const [days, setDays] = useState({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });
  const [dirty, setDirty] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (flagsLoading || !flags.wholesale_field_sales) return;
    api
      .get("/api/employees", { include_deleted: 0 })
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.employees || data?.rows || [];
        const fieldReps = list.filter((e) => e.employee_type === "field_rep");
        setReps(fieldReps);
        if (fieldReps.length && !employeeId) setEmployeeId(String(fieldReps[0].id));
      })
      .catch(() => setReps([]));
  }, [flagsLoading, flags.wholesale_field_sales]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (flagsLoading || !flags.wholesale_field_sales) return;
    api
      .get("/api/customers")
      .then((data) => setAllCustomers(data?.customers || []))
      .catch(() => setAllCustomers([]));
  }, [flagsLoading, flags.wholesale_field_sales]);

  const loadRoutes = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const data = await api.get("/api/admin/field-routes", { employee_id: employeeId });
      const fresh = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      for (const d of Object.keys(data.days || {})) {
        fresh[d] = (data.days[d] || []).map((row) => ({
          customer_id: row.customer_id,
          name: row.name,
          mobile: row.mobile,
        }));
      }
      setDays(fresh);
      setDirty(false);
    } catch (e) {
      toastErr(e.message || "Failed to load routes");
    } finally {
      setLoading(false);
    }
  }, [employeeId, toastErr]);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  if (flagsLoading) return null;
  if (!flags.wholesale_field_sales) return <Navigate to="/" replace />;
  if (!hasPerm("manage_field_sales")) return <Navigate to="/" replace />;

  const currentDayList = days[activeDay] || [];
  const assignedIds = new Set(currentDayList.map((c) => c.customer_id));

  const filteredAvailable = allCustomers.filter((c) => {
    if (assignedIds.has(c.id)) return false;
    if (!customerSearch.trim()) return true;
    const q = customerSearch.trim().toLowerCase();
    return (
      String(c.name || "").toLowerCase().includes(q) ||
      String(c.mobile || "").toLowerCase().includes(q)
    );
  });

  const addCustomer = (c) => {
    if (currentDayList.length >= MAX_PER_DAY) {
      toastErr(`Maximum ${MAX_PER_DAY} customers per day`);
      return;
    }
    setDays((prev) => ({
      ...prev,
      [activeDay]: [...prev[activeDay], { customer_id: c.id, name: c.name, mobile: c.mobile }],
    }));
    setDirty(true);
  };

  const removeCustomer = (idx) => {
    setDays((prev) => ({
      ...prev,
      [activeDay]: prev[activeDay].filter((_, i) => i !== idx),
    }));
    setDirty(true);
  };

  const moveCustomer = (idx, direction) => {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= currentDayList.length) return;
    const next = [...currentDayList];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setDays((prev) => ({ ...prev, [activeDay]: next }));
    setDirty(true);
  };

  const saveDay = async () => {
    if (!employeeId) return;
    setSaving(true);
    try {
      await api.post("/api/admin/field-routes", {
        employee_id: Number(employeeId),
        day_of_week: activeDay,
        customer_ids: currentDayList.map((c) => c.customer_id),
      });
      toastOk(`Saved ${DAY_TABS[activeDay].label} route (${currentDayList.length} stops)`);
      setDirty(false);
    } catch (e) {
      toastErr(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onChangeRep = (e) => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    setEmployeeId(e.target.value);
  };

  const onChangeDay = (newDay) => {
    if (newDay === activeDay) return;
    setActiveDay(newDay);
    setCustomerSearch("");
  };

  return (
    <PageShell
      title="Field Routes"
      subtitle="Assign customers to each rep's weekly beat"
      right={
        <Button
          tone="primary"
          onClick={saveDay}
          disabled={!dirty || saving || !employeeId}
        >
          <Save className="h-4 w-4 mr-1" />
          {saving ? "Saving…" : `Save ${DAY_TABS[activeDay].label}`}
        </Button>
      }
    >
      <SectionCard className="mb-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-(--ui-text-muted) block mb-1">Field Rep</label>
            <Select value={employeeId} onChange={onChangeRep}>
              {reps.length === 0 && <option value="">No field reps yet</option>}
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs text-(--ui-text-muted) block mb-1">Day</label>
            <div className="flex flex-wrap gap-1">
              {DAY_TABS.map((d) => {
                const count = days[d.value]?.length || 0;
                const isActive = activeDay === d.value;
                return (
                  <Button
                    key={d.value}
                    size="sm"
                    tone={isActive ? "primary" : "default"}
                    onClick={() => onChangeDay(d.value)}
                    aria-label={`Select ${d.label}`}
                  >
                    {d.label}
                    {count > 0 && (
                      <span
                        className={`ml-1.5 text-xs ${
                          isActive ? "opacity-80" : "text-(--ui-text-muted)"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SectionCard>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-(--ui-text)">
              {DAY_TABS[activeDay].label} route
            </h3>
            <span className="text-xs text-(--ui-text-muted)">
              {currentDayList.length} / {MAX_PER_DAY} stops
            </span>
          </div>

          {loading ? (
            <div className="py-6 text-center text-(--ui-text-muted) text-sm">Loading…</div>
          ) : currentDayList.length === 0 ? (
            <EmptyState
              title="No stops yet"
              body="Add customers from the right to build this day's route."
            />
          ) : (
            <ol className="space-y-1">
              {currentDayList.map((c, idx) => (
                <li
                  key={c.customer_id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-(--ui-border) bg-(--ui-surface)"
                >
                  <span className="text-xs text-(--ui-text-muted) w-6 text-right tabular-nums">
                    {idx + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-(--ui-text) truncate">{c.name}</div>
                    {c.mobile && (
                      <div className="text-xs text-(--ui-text-muted) truncate">{c.mobile}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Button
                      size="sm"
                      iconOnly
                      tone="plain"
                      onClick={() => moveCustomer(idx, -1)}
                      disabled={idx === 0}
                      title="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      iconOnly
                      tone="plain"
                      onClick={() => moveCustomer(idx, 1)}
                      disabled={idx === currentDayList.length - 1}
                      title="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      iconOnly
                      tone="plain"
                      onClick={() => removeCustomer(idx)}
                      title="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        <SectionCard>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-(--ui-text)">Customers</h3>
            <span className="text-xs text-(--ui-text-muted)">
              {filteredAvailable.length} available
            </span>
          </div>
          <div className="relative mb-2">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-(--ui-text-muted)" />
            <Input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Search by name or mobile…"
              className="pl-8"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {filteredAvailable.length === 0 ? (
              <div className="py-6 text-center text-(--ui-text-muted) text-sm">
                {customerSearch ? "No matches" : "All customers are already assigned"}
              </div>
            ) : (
              <ul className="space-y-1">
                {filteredAvailable.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-(--ui-border) bg-(--ui-surface) hover:bg-(--ui-muted-surface)"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-(--ui-text) truncate">{c.name}</div>
                      {c.mobile && (
                        <div className="text-xs text-(--ui-text-muted) truncate">{c.mobile}</div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      iconOnly
                      tone="plain"
                      onClick={() => addCustomer(c)}
                      disabled={currentDayList.length >= MAX_PER_DAY}
                      title="Add to route"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionCard>
      </div>
    </PageShell>
  );
}
