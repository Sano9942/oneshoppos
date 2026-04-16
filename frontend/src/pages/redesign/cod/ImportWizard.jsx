import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Upload, X } from "lucide-react";
import { api } from "../../../api";
import { Button } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useToast } from "../../../contexts/ToastContext";

// xlsx is ~430 KB (143 KB gzip) — load on demand, not eagerly. The wizard
// only needs it inside handleFile when the user actually picks a file.

// The courier_integrations.config_json column is stored as TEXT, not JSONB.
// Defensively parse it so the wizard does not crash on legacy data or a
// future migration to JSONB.
function readCodMapping(courier) {
  if (!courier?.config_json) return null;
  try {
    const raw =
      typeof courier.config_json === "string"
        ? JSON.parse(courier.config_json)
        : courier.config_json;
    return raw?.cod_csv_mapping ?? null;
  } catch {
    return null;
  }
}

export default function ImportWizard({ onCancel, onComplete }) {
  const toast = useToast();
  const { fmt } = useCurrency();
  const [step, setStep] = useState(1);
  const [couriers, setCouriers] = useState([]);
  const [courierId, setCourierId] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState({});
  const [saveMapping, setSaveMapping] = useState(true);
  const [batchRef, setBatchRef] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get("/api/couriers")
      .then((d) => setCouriers((d.couriers || []).filter((c) => c.enabled)))
      .catch(() => {});
  }, []);

  const selectedCourier = couriers.find(
    (c) => String(c.id) === String(courierId),
  );
  const savedMapping = readCodMapping(selectedCourier);

  // When courier changes (or courier list loads), pre-load any saved mapping.
  useEffect(() => {
    const saved = readCodMapping(
      couriers.find((c) => String(c.id) === String(courierId)),
    );
    if (saved) {
      setMapping(saved);
    } else {
      setMapping({});
    }
  }, [courierId, couriers]);

  async function handleFile(file) {
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (json.length < 2) {
        toast.error("File has no data rows");
        return;
      }
      const parsedHeaders = json[0].map(String);
      const parsedRows = json
        .slice(1)
        .filter((r) => r.some((cell) => cell !== ""));
      setHeaders(parsedHeaders);
      setRows(parsedRows);

      // If the saved mapping still matches the uploaded file's columns,
      // skip the mapping step entirely. Otherwise, fall back to step 3.
      const existing = readCodMapping(selectedCourier) || {};
      const hasAnyMapping = Object.keys(existing).length > 0;
      const requiredColumnsPresent =
        hasAnyMapping &&
        parsedHeaders.includes(existing.courier_tracking_number) &&
        parsedHeaders.includes(existing.remitted_amount);
      if (requiredColumnsPresent) {
        setStep(4);
      } else {
        setStep(3);
      }
    } catch (err) {
      toast.error("Failed to parse file: " + (err.message || "unknown error"));
    }
  }

  // Step navigation guards
  const canNext1 = !!courierId;
  const canNext3 =
    !!mapping.courier_tracking_number &&
    !!mapping.remitted_amount &&
    headers.includes(mapping.courier_tracking_number) &&
    headers.includes(mapping.remitted_amount);

  // Step 4 preview — apply mapping to first 10 rows
  const mappedPreview = rows.slice(0, 10).map((row) => {
    const rec = {};
    for (const [target, sourceHeader] of Object.entries(mapping)) {
      if (sourceHeader) {
        const idx = headers.indexOf(sourceHeader);
        rec[target] = idx >= 0 ? row[idx] : "";
      }
    }
    return rec;
  });

  // Non-numeric amount check (scan first 50 rows)
  const amountIdx = headers.indexOf(mapping.remitted_amount);
  const hasBadAmounts =
    amountIdx >= 0 &&
    rows.some((r) => {
      const v = r[amountIdx];
      if (v === "" || v === null || v === undefined) return false;
      return !isFinite(Number(v));
    });

  const totalAmount = rows.reduce((sum, r) => {
    if (amountIdx < 0) return sum;
    const n = Number(r[amountIdx]);
    return sum + (isFinite(n) ? n : 0);
  }, 0);

  async function handleImport() {
    setBusy(true);
    try {
      // Save mapping first if requested — failure here must not block import.
      if (saveMapping) {
        try {
          const res = await api.raw(
            `/api/couriers/${courierId}/csv-mapping`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mapping }),
            },
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
          }
        } catch (err) {
          toast.warning(
            "Could not save mapping for next time: " +
              (err.message || "unknown error"),
          );
        }
      }

      // Build lines array
      const lines = rows.map((row) => {
        const line = {};
        for (const [target, sourceHeader] of Object.entries(mapping)) {
          if (!sourceHeader) continue;
          const idx = headers.indexOf(sourceHeader);
          if (idx < 0) continue;
          let val = row[idx];
          if (target === "remitted_amount" || target === "courier_fee") {
            const n = Number(val);
            val = isFinite(n) ? n : 0;
          }
          line[target] = val;
        }
        return line;
      });

      // Import
      const { batch } = await api.post(
        "/api/fulfillment/cod/settlements/import",
        {
          courier_id: Number(courierId),
          batch_ref: batchRef || fileName,
          lines,
        },
      );

      // Auto-run match — a failure here should not lose the successful import
      try {
        await api.post(
          `/api/fulfillment/cod/settlements/${batch.id}/match`,
          {},
        );
        toast.success("Batch imported and matched");
      } catch (matchErr) {
        toast.warning(
          "Batch imported but matching failed: " +
            (matchErr.message || "unknown error") +
            ". You can re-run match from the detail view.",
        );
      }

      onComplete(batch.id);
    } catch (err) {
      toast.error(err.message || "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-(--text-primary)">
            Import COD Batch
          </h2>
          <p className="text-xs text-(--text-muted)">Step {step} of 4</p>
        </div>
        <button
          onClick={onCancel}
          className="text-(--text-muted) hover:text-(--text-primary)"
          aria-label="Close wizard"
        >
          <X size={20} />
        </button>
      </div>

      {/* Step 1 — Courier */}
      {step === 1 && (
        <div className="space-y-4 max-w-md">
          <label className="block text-sm font-medium text-(--text-secondary)">
            Courier
          </label>
          <select
            value={courierId}
            onChange={(e) => setCourierId(e.target.value)}
            className="w-full rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
          >
            <option value="">Select a courier…</option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {savedMapping && (
            <p className="text-xs text-green-600 dark:text-green-400">
              Saved column mapping available for this courier — step 3 will be
              skipped if the uploaded file matches.
            </p>
          )}
        </div>
      )}

      {/* Step 2 — Upload */}
      {step === 2 && (
        <div className="space-y-4 max-w-md">
          <label className="block text-sm font-medium text-(--text-secondary)">
            Upload CSV or Excel file
          </label>
          <label className="block border-2 border-dashed border-(--border) rounded-lg p-8 text-center cursor-pointer hover:border-(--accent)">
            <Upload
              size={24}
              className="mx-auto mb-2 text-(--text-muted)"
            />
            <span className="text-sm text-(--text-secondary)">
              {fileName || "Click to choose a file (.csv, .xlsx)"}
            </span>
            <input
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) =>
                e.target.files?.[0] && handleFile(e.target.files[0])
              }
            />
          </label>
        </div>
      )}

      {/* Step 3 — Mapping */}
      {step === 3 && (
        <div className="space-y-4 max-w-xl">
          <p className="text-sm text-(--text-secondary)">
            Map columns from your file to the required fields.
          </p>
          {[
            { key: "courier_tracking_number", label: "Tracking Number *" },
            { key: "remitted_amount", label: "Remitted Amount *" },
            { key: "courier_order_ref", label: "Courier Reference (optional)" },
            { key: "courier_fee", label: "Courier Fee (optional)" },
          ].map((f) => (
            <div key={f.key} className="flex items-center gap-3">
              <label className="w-52 text-sm text-(--text-secondary) shrink-0">
                {f.label}
              </label>
              <select
                value={mapping[f.key] || ""}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, [f.key]: e.target.value }))
                }
                className="grow rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
              >
                <option value="">— not mapped —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm text-(--text-secondary)">
            <input
              type="checkbox"
              checked={saveMapping}
              onChange={(e) => setSaveMapping(e.target.checked)}
              className="w-4 h-4"
            />
            Save this mapping for {selectedCourier?.name} (next import will
            skip this step)
          </label>
        </div>
      )}

      {/* Step 4 — Preview & confirm */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-(--border) p-4 bg-(--bg-subtle)/50">
            <div className="text-sm text-(--text-secondary)">
              <strong>{rows.length}</strong> lines from{" "}
              <strong>{fileName}</strong>
            </div>
            <div className="text-sm text-(--text-secondary)">
              Total remitted: <strong>{fmt(totalAmount)}</strong>
            </div>
            {rows.length > 5000 && (
              <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Large batch — import may take a minute.
              </div>
            )}
            {hasBadAmounts && (
              <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                Warning: amount column contains non-numeric values. Fix the
                mapping or the file before continuing.
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-(--text-secondary) mb-1">
              Batch reference
            </label>
            <input
              type="text"
              placeholder={`e.g. ${selectedCourier?.name || "Courier"} — Week of ${new Date().toLocaleDateString("en-CA")}`}
              value={batchRef}
              onChange={(e) => setBatchRef(e.target.value)}
              className="w-full max-w-md rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
            />
          </div>

          <div className="rounded-lg border border-(--border) overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-(--bg-subtle) text-(--text-muted) uppercase">
                  <th className="text-left px-3 py-2">Tracking</th>
                  <th className="text-left px-3 py-2">Courier Ref</th>
                  <th className="text-right px-3 py-2">Remitted</th>
                  <th className="text-right px-3 py-2">Fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {mappedPreview.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-(--text-primary)">
                      {r.courier_tracking_number}
                    </td>
                    <td className="px-3 py-1.5 text-(--text-secondary)">
                      {r.courier_order_ref || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-(--text-primary)">
                      {r.remitted_amount}
                    </td>
                    <td className="px-3 py-1.5 text-right text-(--text-muted)">
                      {r.courier_fee || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 10 && (
              <div className="px-3 py-2 text-center text-xs text-(--text-muted) bg-(--bg-subtle)">
                …and {rows.length - 10} more rows
              </div>
            )}
          </div>
        </div>
      )}

      {/* Nav buttons */}
      <div className="flex items-center justify-between mt-8 pt-4 border-t border-(--border)">
        {step > 1 ? (
          <Button
            variant="ghost"
            onClick={() => setStep((s) => s - 1)}
            disabled={busy}
          >
            <ArrowLeft size={14} /> Back
          </Button>
        ) : (
          <span />
        )}

        {step === 1 && (
          <Button disabled={!canNext1} onClick={() => setStep(2)}>
            Next <ArrowRight size={14} />
          </Button>
        )}
        {step === 3 && (
          <Button disabled={!canNext3} onClick={() => setStep(4)}>
            Next <ArrowRight size={14} />
          </Button>
        )}
        {step === 4 && (
          <Button
            disabled={busy || hasBadAmounts}
            onClick={handleImport}
          >
            {busy ? "Importing…" : "Import & Match"}
          </Button>
        )}
      </div>
    </div>
  );
}
