// One Toy Store: "Needs a Category" (owner, 2026-10-19). The iPOS import put
// every toy it had no category for into "Other → Needs a Category"; this page
// lists them (and any toy with no category) so the owner can give each a real
// one. Toys that sold come first, then toys in stock; "Show all" adds the
// rest. Each row has a picker that saves at once; tick several to give them
// one category together; when most of the supplier's other toys share a
// category it is offered with "Use it". A toy leaves the list once saved.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import { Button, EmptyState, FilterPill, PageShell, SectionCard, Select } from "../../ui/primitives";
import { leafCategories } from "../../utils/categoryTree";

const isNeeds = (c) => String(c.name || "").trim().toLowerCase() === "needs a category";
const qty = (v) => String(Math.round(Number(v || 0) * 1000) / 1000);
const day = (t) => (t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function NeedsCategoryRedesign() {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [all, setAll] = useState(false);
  const [data, setData] = useState({ rows: [], counts: { listed: 0, all: 0 } });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [categories, setCategories] = useState([]);
  const [ticked, setTicked] = useState(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (showAll) => {
    setLoading(true);
    setLoadError("");
    try {
      setData(await api.get(`/api/products/needs-category${showAll ? "?all=1" : ""}`));
    } catch (err) {
      setLoadError(err?.message || "Couldn't load the list");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(all);
  }, [load, all]);

  useEffect(() => {
    api.get("/api/categories")
      .then((d) => setCategories(leafCategories(d.categories || []).filter((c) => !isNeeds(c))))
      .catch(() => setCategories([]));
  }, []);

  const catLabel = useMemo(() => new Map(categories.map((c) => [Number(c.id), c.path_label || c.name])), [categories]);

  async function assign(ids, categoryId) {
    if (!ids.length || !categoryId) return;
    setSaving(true);
    try {
      await api.post("/api/products/bulk-category", { ids, category_id: Number(categoryId) });
      const gone = new Set(ids);
      setData((d) => ({
        ...d,
        rows: d.rows.filter((r) => !gone.has(r.id)),
        counts: { listed: Math.max(0, d.counts.listed - ids.length), all: Math.max(0, d.counts.all - ids.length) },
      }));
      setTicked((t) => new Set([...t].filter((id) => !gone.has(id))));
      setBulkTarget("");
      const label = catLabel.get(Number(categoryId)) || "the category";
      toast.success(`${ids.length === 1 ? "1 toy" : `${ids.length} toys`} moved to ${label}`);
    } catch (err) {
      toast.error(err?.body?.error || err?.message || "Couldn't save the category");
    } finally {
      setSaving(false);
    }
  }

  const toggle = (id) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = data.rows || [];
  const tickedIds = rows.filter((r) => ticked.has(r.id)).map((r) => r.id);

  const picker = (value, onChange, testId) => (
    <Select value={value} onChange={onChange} disabled={saving} data-testid={testId} className="w-full min-w-[180px]">
      <option value="">Pick a category…</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>{c.path_label || c.name}</option>
      ))}
    </Select>
  );

  return (
    <PageShell
      title="Needs a Category"
      subtitle="Toys the import left without a real category. Sold toys first, then toys in stock. A toy leaves the list once it has a category."
      right={
        <FilterPill
          label={all ? "Sold or in stock only" : `Show all ${data.counts?.all ?? ""}`}
          active={all}
          onClick={() => setAll((v) => !v)}
        />
      }
    >
      <p data-testid="nc-count" className="mb-3 text-sm text-(--ui-text-muted)">
        {data.counts?.listed ?? 0} sold or in stock · {data.counts?.all ?? 0} in all
      </p>

      {tickedIds.length > 0 && (
        <div data-testid="nc-bulk" className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-(--ui-text)">{tickedIds.length} ticked</span>
          <div className="w-64">{picker(bulkTarget, (e) => setBulkTarget(e.target.value))}</div>
          <Button size="sm" disabled={!bulkTarget || saving} onClick={() => assign(tickedIds, bulkTarget)}>
            Apply to {tickedIds.length} ticked
          </Button>
          <Button size="sm" tone="plain" onClick={() => setTicked(new Set())}>Clear</Button>
        </div>
      )}

      <SectionCard className="overflow-x-auto p-0">
        {loadError ? (
          <p className="p-4 text-sm text-(--ui-danger)">{loadError}</p>
        ) : loading && !rows.length ? (
          <p className="p-4 text-sm text-(--ui-text-muted)">Loading…</p>
        ) : !rows.length ? (
          <EmptyState title="Nothing left to fix" body="Every toy that sold or is in stock has a category." />
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-(--ui-muted-surface)">
              <tr className="text-left text-xs text-(--ui-text-muted)">
                <th className="px-3 py-2" />
                <th className="px-3 py-2 font-medium">Toy</th>
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 text-right font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">Stock at cost</th>
                <th className="px-3 py-2 text-right font-medium">Sold</th>
                <th className="px-3 py-2 font-medium">Suggested</th>
                <th className="px-3 py-2 font-medium">Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="nc-row" className="border-t border-(--ui-border) align-top">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Tick ${r.name}`}
                      checked={ticked.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-(--ui-text)">{r.name}</div>
                    <div className="text-xs text-(--ui-text-muted)">
                      {r.sku}{r.category_name ? "" : " · no category"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.supplier_name || "—"}</td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">{qty(r.stock)}</td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">{fmt(r.cost_value)}</td>
                  <td className="px-3 py-2 text-right">
                    {Number(r.units_sold) > 0 ? (
                      <>
                        <div className="font-semibold text-(--ui-text)">{fmt(r.sold_amount)}</div>
                        <div className="text-xs text-(--ui-text-muted)">{qty(r.units_sold)} sold · {day(r.last_sold)}</div>
                      </>
                    ) : (
                      <span className="text-(--ui-text-muted)">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.suggestion ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-(--ui-text)">{r.suggestion.path_label}</span>
                        <span className="text-xs text-(--ui-text-muted)">
                          {r.suggestion.count} of {r.suggestion.of} of this supplier's toys
                        </span>
                        <Button size="sm" disabled={saving} onClick={() => assign([r.id], r.suggestion.category_id)}>
                          Use it
                        </Button>
                      </div>
                    ) : (
                      <span className="text-(--ui-text-muted)">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{picker("", (e) => assign([r.id], e.target.value))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </PageShell>
  );
}
