import { useEffect, useMemo, useState } from "react";
import { Download, Search, Trash2 } from "lucide-react";
import { API_BASE as API } from "../config";
import {
  Badge,
  BulkActionBar,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../ui/primitives";
import { useAuth } from "../auth/AuthProvider";

const PAGE_SIZE = 50;

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]).join(",");
  const body = rows.map((r) =>
    Object.values(r)
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers, ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function InventoryRedesign() {
  const { authHeaders } = useAuth();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState("");
  const [page, setPage] = useState(1);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (status) qs.set("status", status);
      if (categoryId) qs.set("category_id", categoryId);
      qs.set("sort", sortField);
      qs.set("order", sortOrder);
      const res = await fetch(`${API}/api/products?${qs}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setProducts(data.products || []);
      setSelectedIds(new Set());
      setPage(1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API}/api/categories`, { headers: authHeaders() });
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(fetchProducts, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, sortField, sortOrder, status, categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const paged = useMemo(
    () => products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, products],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const toggleSort = (field) => {
    if (sortField === field) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = () => {
    const allSelected = paged.length > 0 && paged.every((p) => selectedIds.has(p.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paged.forEach((p) => {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      });
      return next;
    });
  };

  const runBulk = async (path, payload, successMessage = null) => {
    setBulkWorking(true);
    try {
      const res = await fetch(`${API}/api/products/${path}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk action failed");
      if (successMessage) alert(successMessage(data));
      setSelectedIds(new Set());
      await fetchProducts();
    } catch (err) {
      alert(err.message);
    } finally {
      setBulkWorking(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <PageShell
      title="Products"
      subtitle="Shopify-style product listing with server filtering, sorting, and bulk operations."
      right={
        <div className="flex items-center gap-2">
          <Button
            onClick={() =>
              exportCSV(
                products.map((p) => ({
                  id: p.id,
                  barcode: p.barcode,
                  sku: p.sku || "",
                  name: p.name,
                  status: p.status || "active",
                  category: p.category_name || "",
                  price: p.price,
                  stock: p.total_stock,
                })),
                "inventory-export.csv",
              )
            }
          >
            <Download size={14} className="mr-1 inline" />
            Export all
          </Button>
        </div>
      }
    >
      <SectionCard>
        <TableToolbar
          left={
            <>
              <div className="relative min-w-[260px]">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--ui-text-muted)]"
                />
                <Input
                  className="pl-8"
                  placeholder="Search name, barcode, SKU"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
              <Select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select
                value={`${sortField}:${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split(":");
                  setSortField(field);
                  setSortOrder(order);
                }}
              >
                <option value="name:asc">Name (A-Z)</option>
                <option value="name:desc">Name (Z-A)</option>
                <option value="price:asc">Price (Low-High)</option>
                <option value="price:desc">Price (High-Low)</option>
                <option value="stock:desc">Stock (High-Low)</option>
                <option value="stock:asc">Stock (Low-High)</option>
                <option value="min_qty:asc">Min Qty (Low-High)</option>
                <option value="min_qty:desc">Min Qty (High-Low)</option>
                <option value="created_at:desc">Newest</option>
              </Select>
            </>
          }
          right={<p className="text-sm text-[var(--ui-text-muted)]">{products.length} items</p>}
        />

        <div className="p-3">
          {selectedCount > 0 ? (
            <BulkActionBar>
              <span className="text-sm font-semibold text-emerald-800">
                {selectedCount} selected
              </span>
              <Button
                tone="danger"
                size="sm"
                disabled={bulkWorking}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${selectedCount} products? This cannot be undone.`,
                    )
                  ) {
                    runBulk(
                      "bulk-delete",
                      { ids: [...selectedIds] },
                      (d) => `Deleted ${d.deleted} products`,
                    );
                  }
                }}
              >
                <Trash2 size={13} className="mr-1 inline" />
                Delete
              </Button>
              <Button
                size="sm"
                disabled={bulkWorking}
                onClick={() =>
                  runBulk("bulk-status", {
                    ids: [...selectedIds],
                    status: "active",
                  })
                }
              >
                Set Active
              </Button>
              <Button
                size="sm"
                disabled={bulkWorking}
                onClick={() =>
                  runBulk("bulk-status", {
                    ids: [...selectedIds],
                    status: "inactive",
                  })
                }
              >
                Set Inactive
              </Button>
              <Select
                value={bulkCategoryTarget}
                onChange={(e) => setBulkCategoryTarget(e.target.value)}
              >
                <option value="">Assign category...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={!bulkCategoryTarget || bulkWorking}
                onClick={() =>
                  runBulk("bulk-category", {
                    ids: [...selectedIds],
                    category_id: Number(bulkCategoryTarget),
                  })
                }
              >
                Apply category
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  exportCSV(
                    products
                      .filter((p) => selectedIds.has(p.id))
                      .map((p) => ({
                        id: p.id,
                        barcode: p.barcode,
                        name: p.name,
                        status: p.status || "active",
                        price: p.price,
                        stock: p.total_stock,
                      })),
                    "inventory-selected.csv",
                  )
                }
              >
                <Download size={13} className="mr-1 inline" />
                Export selected
              </Button>
              <Button size="sm" tone="plain" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </BulkActionBar>
          ) : null}
        </div>

        <div className="overflow-auto">
          <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
            <thead className="bg-[var(--ui-muted-surface)]">
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--ui-text-muted)]">
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={
                      paged.length > 0 && paged.every((p) => selectedIds.has(p.id))
                    }
                    onChange={toggleSelectPage}
                  />
                </th>
                <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("name")}>
                  Product
                </th>
                <th className="px-3 py-2">Barcode</th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("price")}>
                  Price
                </th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("stock")}>
                  Stock
                </th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("min_qty")}>
                  Min Qty
                </th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t border-[var(--ui-border)] ${
                    selectedIds.has(p.id) ? "bg-emerald-50" : "bg-white"
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-[var(--ui-text)]">{p.name}</div>
                    <div className="text-xs text-[var(--ui-text-muted)]">
                      {p.vendor || "-"} {p.product_type ? `| ${p.product_type}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--ui-text-muted)]">
                    {p.barcode || "-"}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--ui-text)]">
                    ${(Number(p.price || 0)).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--ui-text)]">
                    {p.total_stock ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--ui-text)]">
                    {p.min_qty ?? 0}
                  </td>
                  <td className="px-3 py-2 text-[var(--ui-text-muted)]">
                    {p.category_name || "-"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={String(p.status || "active") === "active" ? "success" : "warning"}>
                      {p.status || "active"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && products.length === 0 ? (
            <EmptyState
              title="No products found"
              body="Try changing filters, or import products from Shopify."
            />
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-[var(--ui-border)] p-3">
          <span className="text-xs text-[var(--ui-text-muted)]">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </SectionCard>
    </PageShell>
  );
}
