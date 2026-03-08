import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Plus, Search, Trash2, Upload } from "lucide-react";
import { API_BASE as API } from "../../config";
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
} from "../../ui/primitives";
import { useAuth } from "../../auth/AuthProvider";
import { indentLabel, leafCategories, sortCategories } from "../../utils/categoryTree";

const PAGE_SIZE = 50;

const BLANK_FORM = {
  name: "", barcode: "", sku: "", price: "", cost_price: "",
  stock: "", category_id: "", brand_id: "", status: "active", unit: "pcs",
  product_type: "", vendor: "", tags: "", image_url: "",
};


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

const CSV_IMPORT_HEADERS = [
  "name", "barcode", "sku", "price", "cost_price", "compare_at_price",
  "stock", "unit", "status", "product_type", "vendor", "tags",
  "description_html", "gst", "min_qty", "max_qty",
];

function downloadImportTemplate() {
  const blob = new Blob([CSV_IMPORT_HEADERS.join(",") + "\n"], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "products-import-template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    // Handle quoted fields with commas inside
    const values = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { values.push(cur); cur = ""; continue; }
      cur += ch;
    }
    values.push(cur);
    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] || "").trim(); });
    return row;
  });
}

export default function InventoryRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const navigate = useNavigate();
  const canViewAllLocations = hasPerm("all_access");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [status, setStatus] = useState("");
  const [outletFilter, setOutletFilter] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState("");
  const [importResults, setImportResults] = useState(null); // null=closed, array=results
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef(null);
  const [page, setPage] = useState(1);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (status) qs.set("status", status);
      if (categoryId) qs.set("category_id", categoryId);
      if (outletFilter) qs.set("outlet_id", outletFilter);
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
      const [catRes, brandRes, outletRes] = await Promise.all([
        fetch(`${API}/api/categories`, { headers: authHeaders() }),
        fetch(`${API}/api/brands`, { headers: authHeaders() }),
        fetch(`${API}/api/outlets`, { headers: authHeaders() }),
      ]);
      const catData = await catRes.json();
      const brandData = await brandRes.json();
      const outletData = await outletRes.json();
      setCategories(sortCategories(catData.categories || []));
      setBrands(brandData.brands || []);
      setOutlets(outletData.outlets || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (canViewAllLocations) return;
    if (outletFilter) return;
    if (!outlets.length) return;
    setOutletFilter(String(outlets[0].id));
  }, [canViewAllLocations, outletFilter, outlets]);

  useEffect(() => {
    const t = setTimeout(fetchProducts, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, sortField, sortOrder, status, categoryId, outletFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const text = await file.text();
    const rows = parseCSV(text);
    if (!rows.length) return alert("CSV is empty or unreadable.");
    setImporting(true);
    try {
      const res = await fetch(`${API}/api/products/bulk-import`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResults(data.results || []);
      await fetchProducts();
    } catch (err) {
      alert(err.message);
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <>
    <PageShell
      title="Products"
      subtitle="Manage products, pricing, stock levels, and variants."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={downloadImportTemplate}>
            <Download size={14} className="mr-1 inline" />
            CSV Template
          </Button>
          <Button onClick={() => importFileRef.current?.click()} disabled={importing}>
            <Upload size={14} className="mr-1 inline" />
            {importing ? "Importing…" : "Import CSV"}
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImportFile}
          />
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
                  category_path: p.category_path_label || p.category_name || "",
                  product_type: p.product_type || "",
                  vendor: p.vendor || "",
                  tags: p.tags || "",
                  price: p.price,
                  cost_price: p.cost_price || 0,
                  stock: p.total_stock,
                })),
                "inventory-export.csv",
              )
            }
          >
            <Download size={14} className="mr-1 inline" />
            Export all
          </Button>
          <Button tone="primary" onClick={() => navigate("/products/new")}>
            <Plus size={14} className="mr-1 inline" />
            Add Product
          </Button>
        </div>
      }
    >
      <SectionCard>
        <TableToolbar
          left={
            <>
              <div className="relative min-w-65">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
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
                <option value="draft">Draft</option>
                <option value="inactive">Inactive</option>
              </Select>
              <Select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {indentLabel(c)}
                  </option>
                ))}
              </Select>
              <Select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}>
                {canViewAllLocations ? <option value="">All locations</option> : null}
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
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
                <option value="cost_price:asc">Cost (Low-High)</option>
                <option value="cost_price:desc">Cost (High-Low)</option>
                <option value="created_at:desc">Newest</option>
              </Select>
            </>
          }
          right={<p className="text-sm text-(--ui-text-muted)">{products.length} items</p>}
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
                  <option key={c.id} value={c.id} disabled={!c.is_leaf}>
                    {indentLabel(c)}{c.is_leaf ? "" : " (parent)"}
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
                        category_path: p.category_path_label || p.category_name || "",
                        product_type: p.product_type || "",
                        vendor: p.vendor || "",
                        tags: p.tags || "",
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
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface)">
              <tr className="text-left text-xs uppercase tracking-wide text-(--ui-text-muted)">
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
                <th className="px-3 py-2">SKU</th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("price")}>
                  Price
                </th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("cost_price")}>
                  Cost
                </th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("stock")}>
                  Stock
                </th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t border-(--ui-border) cursor-pointer ${
                    selectedIds.has(p.id) ? "bg-emerald-50" : "hover:bg-slate-50 bg-white"
                  }`}
                  onClick={() => navigate(`/products/${p.id}`)}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-(--ui-text)">{p.name}</div>
                    <div className="text-xs text-(--ui-text-muted)">
                      {p.vendor || "-"} {p.product_type ? `| ${p.product_type}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-(--ui-text-muted)">
                    {p.barcode || "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-(--ui-text-muted)">
                    {p.sku || "-"}
                  </td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">
                    PKRs {(Number(p.price || 0)).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right text-(--ui-text-muted)">
                    PKRs {(Number(p.cost_price || 0)).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">
                    {p.total_stock ?? 0}
                  </td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">
                    {p.category_path_label || p.category_name || "-"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={
                        String(p.status || "active") === "active"
                          ? "success"
                          : String(p.status) === "draft"
                            ? "warning"
                            : "danger"
                      }
                    >
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
        <div className="flex items-center justify-between border-t border-(--ui-border) p-3">
          <span className="text-xs text-(--ui-text-muted)">
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
    {importResults !== null && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border)">
            <div>
              <p className="font-semibold text-(--ui-text)">Import Results</p>
              <p className="text-xs text-(--ui-text-muted)">
                {importResults.filter((r) => r.status === "inserted").length} inserted &nbsp;·&nbsp;
                {importResults.filter((r) => r.status === "error").length} errors
              </p>
            </div>
            <button onClick={() => setImportResults(null)} className="text-(--ui-text-muted) hover:text-(--ui-text)">
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto flex-1 px-5 py-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-(--ui-text-muted) border-b border-(--ui-border)">
                  <th className="py-2 pr-3">Row</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Barcode</th>
                  <th className="py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {importResults.map((r, i) => (
                  <tr key={i} className="border-t border-(--ui-border)">
                    <td className="py-1.5 pr-3 text-(--ui-text-muted)">{i + 1}</td>
                    <td className="py-1.5 pr-3 text-(--ui-text)">{r.name || "-"}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-(--ui-text-muted)">{r.barcode || "-"}</td>
                    <td className="py-1.5">
                      {r.status === "inserted" ? (
                        <span className="text-emerald-600 font-medium">Inserted</span>
                      ) : (
                        <span className="text-red-600 text-xs">{r.message || "Error"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-(--ui-border) flex justify-end">
            <Button onClick={() => setImportResults(null)}>Close</Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
