import React, { useState } from "react";
import { Search, LayoutGrid, List } from "lucide-react";
import { usePOS } from "./POSContext";
import { usePreset } from "../../../contexts/PresetContext";

export default function POSSearchArea() {
  const { pos_layout_mode, pos_search_config } = usePreset();
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem("pos_view_mode") || pos_layout_mode || "grid"
  );
  const toggleView = () => {
    const next = viewMode === "grid" ? "list" : "grid";
    setViewMode(next);
    localStorage.setItem("pos_view_mode", next);
  };
  const {
    barcodeSearch,
    skuSearch,
    priceSearch,
    handleSearchChange,
    searchRef,
    search,
    results,
    showResults,
    setShowResults,
    addToCart,
    money,
  } = usePOS();

  return (
    <div className="mb-3 space-y-2">
      {/* Specific field search row — conditionally shown per preset */}
      {(() => {
        const fields = [
          pos_search_config?.show_barcode !== false && { field: "barcode", val: barcodeSearch, placeholder: "Search by Barcode" },
          pos_search_config?.show_sku !== false && { field: "sku", val: skuSearch, placeholder: "Search by SKU" },
          pos_search_config?.show_price !== false && { field: "price", val: priceSearch, placeholder: "Search by Price" },
        ].filter(Boolean);
        if (fields.length === 0) return null;
        return (
      <div className={`grid gap-2 ${fields.length === 1 ? "grid-cols-1" : fields.length === 2 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"}`}>
        {fields.map(({ field, val, placeholder }) => (
          <input
            key={field}
            type="text"
            value={val}
            placeholder={placeholder}
            onChange={(e) => handleSearchChange(e, field)}
            className="block w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-medium placeholder-slate-300 focus:outline-none focus:border-[#8066FF] focus:ring-1 focus:ring-[#8066FF] transition shadow-sm"
          />
        ))}
      </div>
        );
      })()}

      {/* Unified search */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
        />
        <input
          ref={searchRef}
          type="text"
          autoFocus
          autoComplete="off"
          value={search}
          onChange={handleSearchChange}
          onFocus={() => {
            if (results.length > 0) setShowResults(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results.length > 0) {
              e.preventDefault();
              addToCart(results[0]);
            }
          }}
          placeholder="Search by Name, Barcode, SKU… (F2)"
          className="block w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl bg-white font-medium text-sm placeholder-slate-300 focus:outline-none focus:border-[#8066FF] focus:ring-1 focus:ring-[#8066FF] transition shadow-sm"
        />
        {/* View toggle */}
        <button type="button" onClick={toggleView}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-[#8066FF] transition z-10"
          title={viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}>
          {viewMode === "grid" ? <List size={14} /> : <LayoutGrid size={14} />}
        </button>
        {showResults && results.length > 0 && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-100 rounded-xl shadow-xl max-h-64 overflow-y-auto">
            {viewMode === "list" ? (
              results.map((p) => {
                const stock = Number(p.local_stock ?? p.stock ?? 0);
                return (
                  <div key={p.id} onClick={() => addToCart(p)}
                    className="flex items-center gap-3 px-3 py-1.5 hover:bg-[#8066FF]/5 cursor-pointer border-b border-slate-50 last:border-0 transition text-xs">
                    <span className="flex-1 font-medium text-slate-800 truncate">{p.name}</span>
                    <span className="text-slate-400 shrink-0">{p.barcode || p.sku || ""}</span>
                    <span className="font-bold text-[#8066FF] shrink-0 w-16 text-right">{money(p.price)}</span>
                    <span className={`shrink-0 w-12 text-right font-bold uppercase ${stock > 0 ? "text-emerald-500" : "text-red-400"}`}>
                      {stock > 0 ? stock : "—"}
                    </span>
                  </div>
                );
              })
            ) : (
              results.map((p) => {
                const stock = Number(p.local_stock ?? p.stock ?? 0);
                return (
                  <div key={p.id} onClick={() => addToCart(p)}
                    className="flex justify-between items-center px-4 py-2.5 hover:bg-[#8066FF]/5 cursor-pointer border-b border-slate-50 last:border-0 transition">
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{p.name}</div>
                      <div className="text-[10px] text-slate-400">{p.barcode || p.sku || "—"}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-[#8066FF] text-sm">{money(p.price)}</div>
                      <div className={`text-[10px] font-bold uppercase ${stock > 0 ? "text-emerald-500" : "text-red-400"}`}>
                        {stock > 0 ? `${stock} in stock` : "out of stock"}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
