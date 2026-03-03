import React, { useState, useEffect, useCallback } from "react";
import { Tag, Package } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

// --- Tab: Category Wise -------------------------------------------------------
export function CategoryWiseTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/category-wise?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Category Performance Matrix"
      subtitle="Revenue and volume breakdown by product taxonomy"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "category_wise.csv",
              [
                { header: "Category", key: "category" },
                { header: "Orders", key: "units_sold" },
                { header: "Revenue", key: "revenue" },
              ],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Category", "Volume", "Total Revenue"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 font-bold text-slate-800 text-sm italic">
              {r.category}
            </td>
            <td className="p-4">
              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-bold">
                {r.units_sold} items
              </span>
            </td>
            <td className="p-4 font-bold text-indigo-600">
              {fmt(r.revenue)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Product Specification -----------------------------------------------
export function ProductSpecTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        search: filters.search,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
      });
      const res = await fetch(`${API}/api/reports/product-spec?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.categoryId, filters.brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const categorizedRows = rows.filter((row) => row.category && row.category !== "-").length;
  const brandedRows = rows.filter((row) => row.brand && row.brand !== "-").length;
  const supplierRows = rows.filter((row) => row.supplier && row.supplier !== "-").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Categorized
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {categorizedRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Branded
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {brandedRows} / {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            With Supplier
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {supplierRows} / {rows.length}
          </p>
        </div>
      </div>

      <CardShell
        title="Product Specification"
        subtitle="Full catalog detail with taxonomy, brand, supplier, and tax context"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "product_specification.csv",
                [
                  { header: "ID", key: "id" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Product", key: "name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Price", key: "price" },
                  { header: "Cost", key: "cost_price" },
                  { header: "Tax", key: "tax_name" },
                  { header: "Rate", key: "tax_rate" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={[
            "Product",
            "Category",
            "Brand / Supplier",
            "Price",
            "Cost",
            "Tax",
          ]}
          loading={loading}
          empty={rows.length === 0}
          emptyIcon={Package}
        >
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{r.name}</div>
                <div className="font-mono text-[11px] text-slate-400">
                  #{r.id} | {r.barcode}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.category}</td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{r.brand}</div>
                <div className="text-[11px] text-slate-400">{r.supplier}</div>
              </td>
              <td className="px-4 py-3 text-right text-sm font-bold text-slate-900">
                {fmt(r.price)}
              </td>
              <td className="px-4 py-3 text-right text-sm text-slate-600">
                {fmt(r.cost_price)}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{r.tax_name}</div>
                <div className="text-[11px] font-semibold text-slate-500">
                  {r.tax_rate}%
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
