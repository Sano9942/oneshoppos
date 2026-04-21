import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Upload, Save } from "lucide-react";
import { api } from "../../api";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import {
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
} from "../../ui/primitives";

// Parse a 2-column (product_id,price) OR 3-column (product_id,variant_id,price)
// CSV into an array of item payloads. Header row optional. Invalid lines
// are skipped; caller sees a summary toast.
function parsePriceBookCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { items: [], skipped: 0 };

  const firstCells = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const hasHeader =
    firstCells.includes("product_id") ||
    firstCells.includes("price") ||
    firstCells[0] === "id";
  const rows = hasHeader ? lines.slice(1) : lines;

  const items = [];
  let skipped = 0;
  for (const row of rows) {
    const cells = row.split(",").map((c) => c.trim());
    if (cells.length < 2) {
      skipped += 1;
      continue;
    }
    let productId, variantId, price;
    if (cells.length === 2) {
      productId = Number(cells[0]);
      price = Number(cells[1]);
    } else {
      productId = Number(cells[0]);
      variantId = cells[1] === "" ? null : Number(cells[1]);
      price = Number(cells[2]);
    }
    if (!Number.isFinite(productId) || !Number.isFinite(price) || price < 0) {
      skipped += 1;
      continue;
    }
    items.push({
      product_id: productId,
      variant_id: variantId ?? null,
      price,
      min_qty: 1,
    });
  }
  return { items, skipped };
}

export default function CustomerGroupPriceBookRedesign() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);

  const [group, setGroup] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRow, setNewRow] = useState({ product_id: "", price: "" });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [groupsData, bookData] = await Promise.all([
        api.get("/api/customer-groups"),
        api.get(`/api/price-books/groups/${groupId}`),
      ]);
      const g = (groupsData.groups || []).find((x) => String(x.id) === String(groupId));
      setGroup(g || null);
      setItems(bookData.items || []);
    } catch (e) {
      toast.error(e.body?.error || e.message || "Failed to load price book");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!flagsLoading && flags.phase2g_price_books) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, flagsLoading, flags.phase2g_price_books]);

  const addItem = async (e) => {
    e.preventDefault();
    const productId = Number(newRow.product_id);
    const price = Number(newRow.price);
    if (!Number.isInteger(productId) || productId <= 0) {
      toast.error("Valid product id required");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Price must be 0 or more");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/api/price-books/groups/${groupId}/items`, {
        items: [{ product_id: productId, price, min_qty: 1 }],
      });
      toast.success("Override added");
      setNewRow({ product_id: "", price: "" });
      await fetchData();
    } catch (e) {
      toast.error(e.body?.error || "Failed to add override");
    } finally {
      setSaving(false);
    }
  };

  const savePrice = async (item, newPrice) => {
    const n = Number(newPrice);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Invalid price");
      return;
    }
    try {
      await api.put(`/api/price-books/groups/${groupId}/items/${item.id}`, {
        price: n,
      });
      toast.success("Updated");
      await fetchData();
    } catch (e) {
      toast.error(e.body?.error || "Update failed");
    }
  };

  const removeItem = async (item) => {
    if (!window.confirm(`Remove override for product ${item.product_id}?`)) return;
    try {
      await api.del(`/api/price-books/groups/${groupId}/items/${item.id}`);
      toast.success("Removed");
      await fetchData();
    } catch (e) {
      toast.error(e.body?.error || "Remove failed");
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Remove ALL overrides in this price book?")) return;
    try {
      await api.del(`/api/price-books/groups/${groupId}/items`);
      toast.success("Cleared");
      await fetchData();
    } catch (e) {
      toast.error(e.body?.error || "Clear failed");
    }
  };

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const text = await file.text();
    const { items: parsed, skipped } = parsePriceBookCsv(text);
    if (parsed.length === 0) {
      toast.error("No valid rows found in CSV");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post(`/api/price-books/groups/${groupId}/items`, {
        items: parsed,
      });
      const created = res.upserted.filter((r) => r.created).length;
      const updated = res.upserted.filter((r) => r.updated).length;
      toast.success(
        `Imported ${parsed.length} rows — ${created} new, ${updated} updated` +
          (skipped > 0 ? `, ${skipped} skipped` : ""),
      );
      await fetchData();
    } catch (err) {
      toast.error(err.body?.error || "Import failed");
    } finally {
      setSaving(false);
    }
  };

  const headerRight = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <Button onClick={() => navigate("/customer-groups")}>
          <ArrowLeft size={14} className="mr-1 inline" />
          All Groups
        </Button>
        <label className="inline-flex">
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleCsvUpload}
          />
          <span className="cursor-pointer inline-flex items-center rounded-md border border-(--ui-border) bg-(--ui-surface) px-3 py-1.5 text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface)">
            <Upload size={14} className="mr-1 inline" />
            Import CSV
          </span>
        </label>
        <Button tone="danger" onClick={clearAll} disabled={items.length === 0}>
          Clear All
        </Button>
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, navigate],
  );

  if (flagsLoading) {
    return (
      <PageShell title="Price Book">
        <SectionCard>
          <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading…</div>
        </SectionCard>
      </PageShell>
    );
  }

  if (!flags.phase2g_price_books) {
    return (
      <PageShell title="Price Book">
        <SectionCard>
          <EmptyState
            title="Price books are not enabled"
            body="Turn on the phase2g_price_books feature flag to manage per-group, per-product price overrides."
          />
        </SectionCard>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={group ? `${group.name} — Price Book` : "Price Book"}
      subtitle={
        group
          ? `Per-product overrides. Group discount ${group.discount_percent || 0}% still applies on top at checkout.`
          : "Loading group…"
      }
      right={headerRight}
    >
      <SectionCard>
        <form
          className="flex flex-wrap items-end gap-2 border-b border-(--ui-border) px-4 py-3"
          onSubmit={addItem}
        >
          <div>
            <label className="text-[10px] font-medium text-(--ui-text-muted)">Product ID</label>
            <Input
              type="number"
              min="1"
              value={newRow.product_id}
              onChange={(e) => setNewRow((p) => ({ ...p, product_id: e.target.value }))}
              placeholder="e.g. 42"
              className="w-32"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-(--ui-text-muted)">Override Price</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={newRow.price}
              onChange={(e) => setNewRow((p) => ({ ...p, price: e.target.value }))}
              placeholder="0.00"
              className="w-32"
            />
          </div>
          <Button tone="primary" type="submit" disabled={saving}>
            <Plus size={14} className="mr-1 inline" />
            Add
          </Button>
        </form>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-4 py-2.5 text-left">Product</th>
                <th className="px-4 py-2.5 text-left">Variant</th>
                <th className="px-4 py-2.5 text-right">Default Price</th>
                <th className="px-4 py-2.5 text-right">Override Price</th>
                <th className="px-4 py-2.5 text-center">Min Qty</th>
                <th className="px-4 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                items.map((it) => (
                  <tr key={it.id} className="border-t border-(--ui-border)">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-(--ui-text)">{it.product_name || `#${it.product_id}`}</div>
                      {it.sku && <div className="text-xs text-(--ui-text-muted)">{it.sku}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-(--ui-text-muted)">
                      {it.variant_sku || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-(--ui-text-muted)">
                      {Number(it.default_price).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <InlinePriceEdit
                        initial={Number(it.price)}
                        onSave={(v) => savePrice(it, v)}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center text-(--ui-text-muted)">{it.min_qty}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Button size="sm" tone="danger" onClick={() => removeItem(it)}>
                        <Trash2 size={12} className="mr-1 inline" />Remove
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading && (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading overrides…</div>
          )}
          {!loading && items.length === 0 && (
            <EmptyState
              title="No price overrides yet"
              body="Add a single override above or import a CSV (columns: product_id,price or product_id,variant_id,price)."
            />
          )}
        </div>
      </SectionCard>
    </PageShell>
  );
}

function InlinePriceEdit({ initial, onSave }) {
  const [v, setV] = useState(String(initial));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setV(String(initial));
    setDirty(false);
  }, [initial]);
  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        type="number"
        min="0"
        step="0.01"
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          setDirty(true);
        }}
        className="w-24 text-right"
      />
      {dirty && (
        <Button size="sm" tone="primary" onClick={() => onSave(v)}>
          <Save size={12} />
        </Button>
      )}
    </div>
  );
}
