import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Factory, Scissors, Search, Trash2, Plus } from "lucide-react";
import { api } from "../../api";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { fmtUtcDateTime } from "../../utils/dates";

// F01 — production (assembly) + disassembly runs.
//   Assembly:    consume an assembled product's recipe → produce output stock.
//   Disassembly: consume 1 source unit → produce N outputs (cuts) with yields.
export default function ProductionRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { success, error: toastError } = useToast();
  const { fmt } = useCurrency();

  const [mode, setMode] = useState("assembly");
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Assembly state
  const [asmProduct, setAsmProduct] = useState(null); // { id, name, sku }
  const [asmRecipe, setAsmRecipe] = useState([]);
  const [asmQty, setAsmQty] = useState(1);

  // Disassembly state
  const [srcProduct, setSrcProduct] = useState(null);
  const [srcQty, setSrcQty] = useState(1);
  const [outputs, setOutputs] = useState([]); // [{ product_id, name, quantity, unit_cost }]

  // Shared product search
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searchFor, setSearchFor] = useState(null); // 'assembly' | 'source' | 'output'

  const loadRuns = async (oid) => {
    try {
      const data = await api.get("/api/stock-conversions", oid ? { outlet_id: oid } : {});
      setRuns(data.conversions || []);
    } catch {
      setRuns([]);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const oData = await api.get("/api/outlets");
        const os = oData.outlets || [];
        setOutlets(os);
        const first = os[0]?.id ? String(os[0].id) : "";
        setOutletId(first);
        await loadRuns(first);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const runSearch = async (q, forWhat) => {
    setSearch(q);
    setSearchFor(forWhat);
    if (!q || q.length < 2) { setResults([]); return; }
    try {
      const data = await api.get("/api/products/search", { query: q });
      let list = data.products || [];
      if (forWhat === "assembly") list = list.filter((p) => p.bom_type === "assembled");
      setResults(list);
    } catch { setResults([]); }
  };

  const pickProduct = async (p) => {
    if (searchFor === "assembly") {
      setAsmProduct({ id: p.id, name: p.name, sku: p.sku });
      try {
        const c = await api.get(`/api/products/${p.id}/components`);
        setAsmRecipe(c.components || []);
      } catch { setAsmRecipe([]); }
    } else if (searchFor === "source") {
      setSrcProduct({ id: p.id, name: p.name, sku: p.sku });
    } else if (searchFor === "output") {
      setOutputs((prev) =>
        prev.some((o) => o.product_id === p.id)
          ? prev
          : [...prev, { product_id: p.id, name: p.name, quantity: 1, unit_cost: "" }]
      );
    }
    setSearch("");
    setResults([]);
    setSearchFor(null);
  };

  const plateCost = useMemo(
    () => asmRecipe.reduce((s, c) => s + (Number(c.component_cost) || 0) * (Number(c.quantity) || 0), 0),
    [asmRecipe]
  );

  async function runAssembly() {
    if (!outletId) return toastError("Select an outlet");
    if (!asmProduct) return toastError("Pick an assembled product to build");
    if (!(Number(asmQty) > 0)) return toastError("Output quantity must be greater than zero");
    setSaving(true);
    try {
      await api.post("/api/stock-conversions", {
        conversion_type: "assembly",
        outlet_id: Number(outletId),
        output_product_id: asmProduct.id,
        output_qty: Number(asmQty),
      });
      success(`Produced ${asmQty} × ${asmProduct.name}`);
      setAsmProduct(null); setAsmRecipe([]); setAsmQty(1);
      await loadRuns(outletId);
    } catch (e) {
      toastError(e.message || "Production run failed");
    } finally {
      setSaving(false);
    }
  }

  async function runDisassembly() {
    if (!outletId) return toastError("Select an outlet");
    if (!srcProduct) return toastError("Pick a source product to break down");
    if (!(Number(srcQty) > 0)) return toastError("Source quantity must be greater than zero");
    if (outputs.length === 0) return toastError("Add at least one output product");
    if (outputs.some((o) => !(Number(o.quantity) > 0))) return toastError("Every output needs a quantity");
    setSaving(true);
    try {
      await api.post("/api/stock-conversions", {
        conversion_type: "disassembly",
        outlet_id: Number(outletId),
        source_product_id: srcProduct.id,
        source_qty: Number(srcQty),
        outputs: outputs.map((o) => ({
          product_id: o.product_id,
          quantity: Number(o.quantity),
          unit_cost: o.unit_cost !== "" ? Number(o.unit_cost) : null,
        })),
      });
      success(`Broke down ${srcQty} × ${srcProduct.name} into ${outputs.length} products`);
      setSrcProduct(null); setSrcQty(1); setOutputs([]);
      await loadRuns(outletId);
    } catch (e) {
      toastError(e.message || "Disassembly run failed");
    } finally {
      setSaving(false);
    }
  }

  if (flagsLoading) return null;
  if (!flags.kit_bom_engine) return <Navigate to="/" replace />;

  const searchBox = (forWhat, placeholder) => (
    <div className="relative">
      <div className="flex items-center gap-2">
        <Search size={14} className="text-(--ui-text-muted)" />
        <Input
          value={searchFor === forWhat ? search : ""}
          onChange={(e) => runSearch(e.target.value, forWhat)}
          placeholder={placeholder}
          className="flex-1"
        />
      </div>
      {searchFor === forWhat && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-(--ui-surface) border border-(--ui-border) rounded-(--ui-radius-sm) shadow-(--ui-shadow-lg) max-h-48 overflow-y-auto">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickProduct(p)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-(--ui-muted-surface) flex justify-between items-center"
            >
              <span className="font-medium text-(--ui-text)">{p.name}</span>
              <span className="text-xs text-(--ui-text-muted)">{p.sku || "—"}</span>
            </button>
          ))}
        </div>
      )}
      {searchFor === forWhat && search.length >= 2 && results.length === 0 && (
        <p className="text-xs text-(--ui-text-muted) mt-1">
          {forWhat === "assembly" ? "No assembled products found — set a product's type to Assembled first." : "No products found."}
        </p>
      )}
    </div>
  );

  return (
    <PageShell
      title="Production"
      subtitle="Build assembled products from recipes, or break one item down into many."
      right={
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--ui-text-muted)">Outlet</span>
          <Select value={outletId} onChange={(e) => { setOutletId(e.target.value); loadRuns(e.target.value); }}>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </div>
      }
    >
      {/* Mode switch */}
      <div className="flex gap-2 mb-3">
        <Button tone={mode === "assembly" ? "primary" : "plain"} onClick={() => setMode("assembly")}>
          <Factory size={14} /> Assembly
        </Button>
        <Button tone={mode === "disassembly" ? "primary" : "plain"} onClick={() => setMode("disassembly")}>
          <Scissors size={14} /> Disassembly
        </Button>
      </div>

      {mode === "assembly" ? (
        <SectionCard className="mb-4">
          <div className="p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Assembly run</p>
            {searchBox("assembly", "Search an assembled product to build…")}

            {asmProduct && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-(--ui-text)">{asmProduct.name}</div>
                    <div className="text-xs text-(--ui-text-muted)">{asmProduct.sku || "—"}</div>
                  </div>
                  <button type="button" onClick={() => { setAsmProduct(null); setAsmRecipe([]); }}
                    className="text-(--ui-text-muted) hover:text-(--ui-danger-fg) p-1"><Trash2 size={14} /></button>
                </div>

                {asmRecipe.length > 0 ? (
                  <div className="rounded-(--ui-radius-sm) border border-(--ui-border) p-3">
                    <p className="text-xs font-semibold uppercase text-(--ui-text-muted) mb-2">Consumes per unit</p>
                    <ul className="text-sm space-y-1">
                      {asmRecipe.map((c) => (
                        <li key={c.id} className="flex justify-between">
                          <span className="text-(--ui-text)">{c.component_name}</span>
                          <span className="text-(--ui-text-muted)">
                            {Number(c.quantity)} {c.unit || c.component_unit || ""} · {fmt((Number(c.component_cost) || 0) * (Number(c.quantity) || 0))}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex justify-between border-t border-(--ui-border) mt-2 pt-2 text-sm font-semibold">
                      <span>Plate cost / unit</span><span>{fmt(plateCost)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-(--ui-danger-fg)">This product has no recipe — add components on its product page first.</p>
                )}

                <div className="flex items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-(--ui-text-muted)">Quantity to produce</label>
                    <Input type="number" min="0" step="0.0001" value={asmQty}
                      onChange={(e) => setAsmQty(e.target.value)} className="w-32" />
                  </div>
                  <div className="text-sm text-(--ui-text-muted) pb-2">
                    Total recipe cost: <span className="font-semibold text-(--ui-text)">{fmt(plateCost * (Number(asmQty) || 0))}</span>
                  </div>
                </div>

                <Button tone="primary" onClick={runAssembly} disabled={saving || asmRecipe.length === 0}>
                  {saving ? "Running…" : "Run production"}
                </Button>
              </div>
            )}
          </div>
        </SectionCard>
      ) : (
        <SectionCard className="mb-4">
          <div className="p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Disassembly run</p>
            {searchBox("source", "Search the source product to break down…")}

            {srcProduct && (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <div className="font-medium text-(--ui-text)">{srcProduct.name}</div>
                  <div className="text-xs text-(--ui-text-muted)">{srcProduct.sku || "—"}</div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-(--ui-text-muted)">Source qty</label>
                  <Input type="number" min="0" step="0.0001" value={srcQty}
                    onChange={(e) => setSrcQty(e.target.value)} className="w-28" />
                </div>
                <button type="button" onClick={() => setSrcProduct(null)}
                  className="text-(--ui-text-muted) hover:text-(--ui-danger-fg) p-1 pb-2"><Trash2 size={14} /></button>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold uppercase text-(--ui-text-muted) mb-1">Outputs (yield)</p>
              {searchBox("output", "Search products this breaks down into…")}
            </div>

            {outputs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs font-semibold uppercase text-(--ui-text-muted) border-b border-(--ui-border)">
                      <th className="pb-2 text-left pr-3">Product</th>
                      <th className="pb-2 text-right pr-3">Qty produced</th>
                      <th className="pb-2 text-right pr-3">Unit cost (opt.)</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {outputs.map((o) => (
                      <tr key={o.product_id} className="border-b border-(--ui-border) last:border-0">
                        <td className="py-2 pr-3 font-medium text-(--ui-text)">{o.name}</td>
                        <td className="py-2 pr-3">
                          <Input type="number" min="0" step="0.0001" value={o.quantity}
                            onChange={(e) => setOutputs((prev) => prev.map((x) => x.product_id === o.product_id ? { ...x, quantity: e.target.value } : x))}
                            className="w-24 text-right" />
                        </td>
                        <td className="py-2 pr-3">
                          <Input type="number" min="0" step="0.0001" value={o.unit_cost}
                            onChange={(e) => setOutputs((prev) => prev.map((x) => x.product_id === o.product_id ? { ...x, unit_cost: e.target.value } : x))}
                            placeholder="—" className="w-24 text-right" />
                        </td>
                        <td className="py-2 text-center">
                          <button type="button" onClick={() => setOutputs((prev) => prev.filter((x) => x.product_id !== o.product_id))}
                            className="text-(--ui-danger-fg) hover:opacity-70 p-1"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Button tone="primary" onClick={runDisassembly} disabled={saving}>
              {saving ? "Running…" : "Run disassembly"}
            </Button>
          </div>
        </SectionCard>
      )}

      {/* Recent runs */}
      <SectionCard>
        <div className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted) mb-3">Recent runs</p>
          {loading ? null : runs.length === 0 ? (
            <EmptyState title="No production runs yet" body="Run an assembly or disassembly above to see it here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase text-(--ui-text-muted) border-b border-(--ui-border)">
                    <th className="pb-2 text-left pr-3">When</th>
                    <th className="pb-2 text-left pr-3">Type</th>
                    <th className="pb-2 text-left pr-3">Item</th>
                    <th className="pb-2 text-right pr-3">Qty</th>
                    <th className="pb-2 text-left pr-3">By</th>
                    <th className="pb-2 text-left">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-(--ui-border) last:border-0 align-top">
                      <td className="py-2 pr-3 text-(--ui-text-muted) whitespace-nowrap">{fmtUtcDateTime(r.created_at)}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={r.conversion_type === "assembly" ? "success" : "warning"}>{r.conversion_type}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-medium text-(--ui-text)">
                        {r.conversion_type === "assembly" ? r.output_product_name : r.source_product_name}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {Number(r.conversion_type === "assembly" ? r.output_qty : r.source_qty)}
                      </td>
                      <td className="py-2 pr-3 text-(--ui-text-muted)">{r.employee_name || "—"}</td>
                      <td className="py-2 text-xs text-(--ui-text-muted)">
                        {(r.lines || []).map((l) => `${l.direction === "consume" ? "−" : "+"}${Number(l.quantity)} ${l.product_name}`).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>
    </PageShell>
  );
}
