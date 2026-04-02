import React, { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { useShopify } from "./ShopifyContext";

export default function ShopifyImport() {
  const { apiFetch, config, setError, setSuccess, loadAll } = useShopify();

  const [importingProducts, setImportingProducts] = useState(false);
  const [importingInventory, setImportingInventory] = useState(false);
  const [deletingImport, setDeletingImport] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [inventorySyncResult, setInventorySyncResult] = useState(null);

  const importProductsFromShopify = async () => {
    if (
      !window.confirm(
        "Import products? This will create/update POS items based on Shopify barcodes.",
      )
    )
      return;
    setImportingProducts(true);
    setImportResult(null);
    try {
      const res = await apiFetch(
        `/api/integrations/shopify/import/products`,
        { method: "POST" },
      );
      const data = await res.json();
      setImportResult(data);
      if (res.ok) setSuccess("Product import complete!");
      else setError(data.error || "Import failed");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setImportingProducts(false);
    }
  };

  const syncInventoryFromShopify = async () => {
    setImportingInventory(true);
    setInventorySyncResult(null);
    try {
      const res = await apiFetch(
        `/api/integrations/shopify/import/inventory`,
        { method: "POST" },
      );
      const data = await res.json();
      setInventorySyncResult(data);
      if (res.ok) setSuccess("Inventory sync complete!");
      else setError(data.error || "Sync failed");
    } catch (err) {
      setError(err.message);
    } finally {
      setImportingInventory(false);
    }
  };

  const deleteShopifyImportedProducts = async () => {
    if (
      !window.confirm(
        "CRITICAL: This will delete ALL products imported from Shopify and clear mappings. Proceed?",
      )
    )
      return;
    setDeletingImport(true);
    try {
      const res = await apiFetch(
        `/api/integrations/shopify/import/products`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setSuccess("Shopify products deleted successfully.");
        setImportResult(null);
        setInventorySyncResult(null);
        await loadAll();
      } else {
        const d = await res.json();
        setError(d.error || "Delete failed");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingImport(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <h3 className="text-lg font-semibold text-slate-800">
        Import from Shopify
      </h3>
      <p className="text-sm text-slate-500">
        Pull products and inventory levels directly from Shopify into POS.
        Products are matched by barcode and created or updated automatically.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <button
            onClick={importProductsFromShopify}
            disabled={importingProducts || !config.connected}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <Download size={14} />
            {importingProducts
              ? "Importing..."
              : "Import Products from Shopify"}
          </button>
          <button
            onClick={syncInventoryFromShopify}
            disabled={importingInventory || !config.connected}
            className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            <RefreshCw size={14} />
            {importingInventory
              ? "Syncing..."
              : "Sync Inventory Levels from Shopify"}
          </button>

          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={deleteShopifyImportedProducts}
              disabled={deletingImport}
              className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 border border-rose-300 text-rose-600 hover:bg-rose-50 rounded-lg text-sm font-semibold disabled:opacity-60"
            >
              {deletingImport
                ? "Deleting..."
                : "Delete All Shopify-Imported Products"}
            </button>
            <p className="text-xs text-rose-400 mt-2">
              Removes all products that were imported from Shopify and clears
              their stock + mappings.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {importResult && (
            <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg text-sm space-y-1">
              <div className="font-semibold text-violet-800 underline mb-1">
                Last Product Import
              </div>
              <div className="grid grid-cols-3 gap-2 text-slate-700">
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400">Created</span>
                  <strong>{importResult.created}</strong>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400">Updated</span>
                  <strong>{importResult.updated}</strong>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400">Skipped</span>
                  <strong>{importResult.skipped}</strong>
                </div>
              </div>
              {importResult.errors?.length > 0 && (
                <div className="text-rose-600 text-xs mt-2 p-1 bg-white rounded border border-rose-100">
                  {importResult.errors.length} error(s). e.g.,{" "}
                  {importResult.errors[0]?.error}
                </div>
              )}
            </div>
          )}

          {inventorySyncResult && (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-sm space-y-1">
              <div className="font-semibold text-teal-800 underline mb-1">
                Last Inventory Sync
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-700">
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400">Synced</span>
                  <strong>{inventorySyncResult.synced}</strong>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400">Failed</span>
                  <strong>{inventorySyncResult.failed}</strong>
                </div>
              </div>
              {inventorySyncResult.errors?.length > 0 && (
                <div className="text-rose-600 text-xs mt-2 p-1 bg-white rounded border border-rose-100">
                  {inventorySyncResult.errors.length} error(s). e.g.,{" "}
                  {inventorySyncResult.errors[0]?.error}
                </div>
              )}
            </div>
          )}

          {!importResult && !inventorySyncResult && (
            <div className="h-full flex items-center justify-center p-8 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-slate-400 text-sm">
              No recent import activity
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
