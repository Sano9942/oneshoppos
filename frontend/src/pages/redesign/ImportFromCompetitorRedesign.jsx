import { useState, useRef, useCallback } from "react";
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { PageShell, SectionCard, Button, Select } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";
import { api } from "../../api";
import { API_BASE } from "../../config";

const SOURCES = [
  { key: "shopify", label: "Shopify" },
  { key: "square", label: "Square" },
];

const ENTITIES = [
  { key: "products", label: "Products" },
  { key: "customers", label: "Customers" },
];

export default function ImportFromCompetitorRedesign() {
  const [source, setSource] = useState("shopify");
  const [entity, setEntity] = useState("products");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const { success, error: showError } = useToast();

  const resetState = useCallback(() => {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleSourceChange = useCallback(
    (key) => {
      setSource(key);
      resetState();
    },
    [resetState],
  );

  const handleEntityChange = useCallback(
    (key) => {
      setEntity(key);
      resetState();
    },
    [resetState],
  );

  const handleFileSelect = useCallback(
    async (e) => {
      const selected = e.target.files?.[0];
      if (!selected) return;
      setFile(selected);
      setPreview(null);
      setLoading(true);

      try {
        const fd = new FormData();
        fd.append("file", selected);
        const res = await api.upload(
          `/api/import/${entity}?source=${source}&preview=1`,
          fd,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Preview failed");
        setPreview(data);
      } catch (err) {
        showError(err.message);
        resetState();
      } finally {
        setLoading(false);
      }
    },
    [source, entity, showError, resetState],
  );

  const handleImport = useCallback(async () => {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.upload(
        `/api/import/${entity}?source=${source}`,
        fd,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      success(`Imported ${data.imported ?? 0} ${entity} from ${source}`);
      resetState();
    } catch (err) {
      showError(err.message);
    } finally {
      setImporting(false);
    }
  }, [file, source, entity, success, showError, resetState]);

  const sample = preview?.sample ?? [];
  const validCount = preview?.valid ?? 0;
  const errorRows = preview?.errors ?? [];
  const columns = sample.length
    ? Object.keys(sample[0]).filter((k) => k !== "row")
    : [];

  return (
    <PageShell
      title="Import from Shopify or Square"
      subtitle="Switching from Shopify or Square? Export your data from their dashboard and upload it here."
    >
      <SectionCard className="p-5">
        {/* Source + entity selectors */}
        <div className="mb-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Exporting from
            </label>
            <Select
              value={source}
              onChange={(e) => handleSourceChange(e.target.value)}
              disabled={loading || importing}
            >
              {SOURCES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Data type
            </label>
            <Select
              value={entity}
              onChange={(e) => handleEntityChange(e.target.value)}
              disabled={loading || importing}
            >
              {ENTITIES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </Select>
          </div>
        </div>

        {/* Template download */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="text-sm text-(--ui-text-muted)">
            Don't have an export yet? Grab a template shaped like a real {SOURCES.find((s) => s.key === source)?.label} CSV.
          </div>
          <a
            href={`${API_BASE}/api/import/template/${entity}?source=${source}`}
            download
            className="inline-flex items-center gap-2 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-surface) px-4 py-2 text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface) transition shrink-0"
          >
            <Download className="h-4 w-4" />
            Download {SOURCES.find((s) => s.key === source)?.label} template
          </a>
        </div>

        {/* Drop zone */}
        <label
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-(--ui-radius-md) border-2 border-dashed p-10 transition ${
            loading
              ? "border-(--ui-primary) bg-(--ui-primary)/5"
              : "border-(--ui-border) hover:border-(--ui-primary) hover:bg-(--ui-primary)/5"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileSelect}
            disabled={loading || importing}
          />
          {loading ? (
            <Loader2 className="h-10 w-10 text-(--ui-primary) animate-spin" />
          ) : (
            <FileSpreadsheet className="h-10 w-10 text-(--ui-text-muted)" />
          )}
          <div className="text-center">
            <p className="text-sm font-medium text-(--ui-text)">
              {loading ? "Parsing file..." : "Click to upload or drag and drop"}
            </p>
            <p className="mt-1 text-xs text-(--ui-text-muted)">CSV, XLSX, or XLS exported from {SOURCES.find((s) => s.key === source)?.label}</p>
          </div>
          {file && !loading && (
            <p className="text-xs text-(--ui-text-muted)">Selected: {file.name}</p>
          )}
        </label>

        {/* Preview */}
        {preview && (
          <div className="mt-5">
            <div className="mb-4 flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                {validCount} valid row{validCount !== 1 ? "s" : ""}
              </span>
              {errorRows.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  {errorRows.length} error{errorRows.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {columns.length > 0 && (
              <div className="overflow-x-auto rounded-(--ui-radius-sm) border border-(--ui-border)">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface)">
                      <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">#</th>
                      {columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left font-medium text-(--ui-text-muted)"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sample.map((row, i) => (
                      <tr key={i} className="border-b border-(--ui-border)">
                        <td className="px-3 py-2 text-(--ui-text-muted)">{row.row ?? i + 1}</td>
                        {columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-(--ui-text) max-w-48 truncate">
                            {row[col] == null ? "" : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {errorRows.length > 0 && (
              <div className="mt-4 rounded-(--ui-radius-sm) border border-red-200 bg-red-50 p-3 text-sm">
                <p className="mb-2 font-medium text-red-700">
                  {errorRows.length} row{errorRows.length !== 1 ? "s" : ""} will be skipped:
                </p>
                <ul className="list-disc pl-5 space-y-0.5 text-red-700 max-h-40 overflow-y-auto">
                  {errorRows.slice(0, 20).map((er, i) => (
                    <li key={i}>
                      Row {er.row}: {Array.isArray(er.errors) ? er.errors.join("; ") : "error"}
                    </li>
                  ))}
                  {errorRows.length > 20 && (
                    <li className="italic">…and {errorRows.length - 20} more</li>
                  )}
                </ul>
              </div>
            )}

            {validCount > 0 && (
              <div className="mt-4 flex justify-end">
                <Button
                  tone="primary"
                  disabled={importing}
                  onClick={handleImport}
                >
                  {importing ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Importing...
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      Import {validCount} row{validCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}
