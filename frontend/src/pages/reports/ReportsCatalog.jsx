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
              ["Category", "Orders", "Revenue"],
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
              {r.category_name}
            </td>
            <td className="p-4">
              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-bold">
                {r.total_items} items
              </span>
            </td>
            <td className="p-4 font-bold text-indigo-600">
              {fmt(r.total_revenue)}
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
      setRows(d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.categoryId, filters.brandId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Product Specification"
      subtitle="Full product catalogue with all fields"
    >
      <TableShell
        cols={[
          "ID",
          "Barcode",
          "Product",
          "Category",
          "Brand",
          "Supplier",
          "Price",
          "Cost",
          "Tax",
          "Rate",
        ]}
        loading={loading}
        empty={rows.length === 0}
        emptyIcon={Package}
      >
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-xs font-mono text-slate-400">{r.id}</td>
            <td className="p-4 text-xs font-mono text-slate-500">
              {r.barcode}
            </td>
            <td className="p-4 font-medium text-slate-800">{r.name}</td>
            <td className="p-4 text-sm text-slate-600">{r.category}</td>
            <td className="p-4 text-sm text-slate-600">{r.brand}</td>
            <td className="p-4 text-sm text-slate-600">{r.supplier}</td>
            <td className="p-4 text-right font-bold text-slate-900">
              {fmt(r.price)}
            </td>
            <td className="p-4 text-right text-sm text-slate-500">
              {fmt(r.cost_price)}
            </td>
            <td className="p-4 text-sm text-slate-600">{r.tax_name}</td>
            <td className="p-4 text-center text-sm font-semibold text-slate-700">
              {r.tax_rate}%
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}
