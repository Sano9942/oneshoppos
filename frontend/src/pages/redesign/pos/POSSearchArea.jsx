import React, { useState } from "react";
import { Search, LayoutGrid, List } from "lucide-react";
import { usePOS } from "./POSContext";
import { usePreset } from "../../../contexts/PresetContext";
import POSOmniInput from "./POSOmniInput";
import POSPluPad from "./POSPluPad";

export default function POSSearchArea() {
  const { pos_layout_mode, pos_search_config, labels = {} } = usePreset();
  const productsWord = (labels.products || "products").toLowerCase();
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
    posFlags,
  } = usePOS();

  return (
    <div className="mb-3 space-y-2">
      {/* 2-G.0 scan-first omni-input — flag-gated; existing inputs below
          remain as fallback so flag-off behavior matches main exactly. */}
      {posFlags?.phase2g_omni_input && <POSOmniInput />}

      {/* V01 grocery — PLU rapid-entry pad for loose produce (preset-gated). */}
      {pos_search_config?.show_plu && <POSPluPad />}

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
            className="block w-full px-3 py-2 border border-(--ui-border) rounded-xl bg-(--ui-surface) text-xs font-medium placeholder-(--ui-text-muted) focus:outline-none focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) transition"
          />
        ))}
      </div>
        );
      })()}

      {/* Unified search */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted) pointer-events-none"
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
          placeholder={`Search ${productsWord} by name, barcode, SKU… (F2)`}
          className="block w-full pl-9 pr-10 py-2.5 border border-(--ui-border) rounded-xl bg-(--ui-surface) font-medium text-sm placeholder-(--ui-text-muted) focus:outline-none focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) transition"
        />
        {/* View toggle */}
        <button type="button" onClick={toggleView}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-(--ui-text-muted) hover:text-(--ui-text) transition z-10"
          title={viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}>
          {viewMode === "grid" ? <List size={14} /> : <LayoutGrid size={14} />}
        </button>
        {showResults && results.length > 0 && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-(--ui-surface) border border-(--ui-border) rounded-xl shadow-(--ui-shadow-lg) max-h-64 overflow-y-auto">
            {viewMode === "list" ? (
              results.map((p) => {
                const stock = Number(p.local_stock ?? p.stock ?? 0);
                // 2-R.1: grey out + block click for 86'd items; un-86 from
                // the overflow modal or admin page to clear.
                const soldOut = Boolean(p.is_sold_out);
                return (
                  <div
                    key={p.id}
                    onClick={() => { if (!soldOut) addToCart(p); }}
                    className={`flex items-center gap-3 px-3 py-1.5 border-b border-(--ui-border) last:border-0 transition text-xs ${
                      soldOut ? "opacity-50 cursor-not-allowed" : "hover:bg-(--ui-muted-surface) cursor-pointer"
                    }`}>
                    <span className="flex-1 font-medium text-(--ui-text) truncate">
                      {p.name}
                      {soldOut && <span className="ml-2 px-1.5 py-0.5 rounded bg-(--ui-danger-bg) text-(--ui-danger-fg) text-[10px] font-bold uppercase">86'd</span>}
                    </span>
                    <span className="text-(--ui-text-muted) shrink-0">{p.barcode || p.sku || ""}</span>
                    <span className="font-bold text-(--ui-text) shrink-0 w-16 text-right">{money(p.price)}</span>
                    <span className={`shrink-0 w-12 text-right font-bold uppercase ${stock > 0 ? "text-(--ui-success-fg)" : "text-(--ui-danger)"}`}>
                      {stock > 0 ? stock : "—"}
                    </span>
                  </div>
                );
              })
            ) : (
              results.map((p) => {
                const stock = Number(p.local_stock ?? p.stock ?? 0);
                const soldOut = Boolean(p.is_sold_out);
                return (
                  <div
                    key={p.id}
                    onClick={() => { if (!soldOut) addToCart(p); }}
                    className={`flex justify-between items-center px-4 py-2.5 border-b border-(--ui-border) last:border-0 transition ${
                      soldOut ? "opacity-50 cursor-not-allowed" : "hover:bg-(--ui-muted-surface) cursor-pointer"
                    }`}>
                    <div>
                      <div className="font-bold text-(--ui-text) text-sm">
                        {p.name}
                        {soldOut && <span className="ml-2 px-1.5 py-0.5 rounded bg-(--ui-danger-bg) text-(--ui-danger-fg) text-[10px] font-bold uppercase">86'd</span>}
                      </div>
                      <div className="text-[10px] text-(--ui-text-muted)">{p.barcode || p.sku || "—"}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-(--ui-text) text-sm">{money(p.price)}</div>
                      <div className={`text-[10px] font-bold uppercase ${stock > 0 ? "text-(--ui-success-fg)" : "text-(--ui-danger)"}`}>
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
