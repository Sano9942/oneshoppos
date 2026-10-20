// One Toy Store F10 (owner 2026-10-20, PHASE-F-PLAN F10): Settings → Price
// rules. The five rules the supplier bill check screen uses to suggest a
// selling price, in a fixed order: each %, the cost bands, the suppliers (tick
// boxes), the item words, the stationery brands and the rounding.
// Administrators only. A change only changes future suggestions: no toy is
// repriced. Every % 30–300 and bands rising (Save stays off until fixed); a
// preview of sample costs old vs new; history of every save with "Go back".
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useToast } from "../../contexts/ToastContext";
import { Button, ConfirmDialog, Input, PageShell, SectionCard, Select } from "../../ui/primitives";
import { fmtUtcDateTime } from "../../utils/dates";
import { ROUNDING_STEPS, previewRows, validateRules } from "./supplierBill/priceRules";

const num = (v) => (v === "" || v == null ? "" : Number(v));
const words = (text) => [...new Set(String(text || "").split("\n").map((w) => w.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];

/** Server rules → what the boxes hold (words as one-per-line text). */
function toDraft(r) {
  return {
    rounding: r.rounding,
    big: { ...r.big, groups: r.big.groups.map((g) => ({ supplier_ids: g.supplier_ids, words: g.words.join("\n") })) },
    bbtt: { ...r.bbtt, words: r.bbtt.words.join("\n") },
    stationery: { pct: r.stationery.pct, supplier_ids: r.stationery.supplier_ids, brand_ids: r.stationery.brand_ids },
    brand: { bands: r.brand.bands.map((b) => [...b]) },
    nonbrand: { bands: r.nonbrand.bands.map((b) => [...b]) },
  };
}

/** What the boxes hold → rules (what is checked, previewed and saved). */
function toRules(d) {
  const bands = (list) => list.map(([below, pct], i) => [i === list.length - 1 ? null : num(below), num(pct)]);
  return {
    rounding: Number(d.rounding),
    big: {
      pct: num(d.big.pct), high_from_cost: num(d.big.high_from_cost), high_pct: num(d.big.high_pct),
      groups: d.big.groups.map((g) => ({ supplier_ids: g.supplier_ids, words: words(g.words) })),
    },
    bbtt: { pct: num(d.bbtt.pct), supplier_ids: d.bbtt.supplier_ids, words: words(d.bbtt.words) },
    stationery: { pct: num(d.stationery.pct), supplier_ids: d.stationery.supplier_ids, brand_ids: d.stationery.brand_ids, brand_names: [] },
    brand: { bands: bands(d.brand.bands) },
    nonbrand: { bands: bands(d.nonbrand.bands) },
  };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const toggle = (ids, id) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

function Rule({ title, hint, children }) {
  return (
    <div role="region" aria-label={title} className="mb-4">
      <SectionCard className="p-4">
        <h2 className="text-base font-semibold text-(--ui-text)">{title}</h2>
        {hint ? <p className="mb-3 text-sm text-(--ui-text-muted)">{hint}</p> : null}
        <div className="space-y-4">{children}</div>
      </SectionCard>
    </div>
  );
}

function Pct({ label, value, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span>{label.replace(/ %$/, "")}</span>
      <Input type="number" className="w-24! text-right" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      <span>% on cost</span>
    </label>
  );
}

function Ticks({ title, items, ids, onChange }) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold uppercase text-(--ui-text-muted)">{title}</legend>
      {items.length ? (
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <label key={it.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ids.includes(it.id)} onChange={() => onChange(toggle(ids, it.id))} />
              <span>{it.name}</span>
            </label>
          ))}
        </div>
      ) : <p className="text-sm text-(--ui-text-muted)">None yet.</p>}
    </fieldset>
  );
}

function Words({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase text-(--ui-text-muted)">{label}</span>
      <span className="mb-1 block text-xs text-(--ui-text-muted)">One per line. Whole words; a space may be left out ("high chair" = "HIGHCHAIR"); an s on the end still counts.</span>
      <textarea
        aria-label={label}
        rows={5}
        className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Bands({ title, bands, onChange }) {
  const set = (i, j, v) => onChange(bands.map((b, k) => (k === i ? (j === 0 ? [v, b[1]] : [b[0], v]) : b)));
  const add = () => {
    const before = bands.slice(0, -1);
    const prev = before.length ? Number(before[before.length - 1][0]) || 0 : 0;
    onChange([...before, [prev ? prev * 2 : 1000, bands[bands.length - 1]?.[1] ?? 100], ...bands.slice(-1)]);
  };
  return (
    <div>
      <table className="w-full max-w-lg text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-(--ui-text-muted)">
            <th className="py-1 font-semibold">Cost below</th>
            <th className="py-1 font-semibold">% on cost</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {bands.map(([below, pct], i) => {
            const last = i === bands.length - 1;
            return (
              <tr key={i}>
                <td className="py-1 pr-2">
                  {last ? <span className="text-(--ui-text-muted)">and above</span> : (
                    <Input type="number" className="w-32!" aria-label={`${title}: row ${i + 1} cost below`} value={below ?? ""} onChange={(e) => set(i, 0, e.target.value)} />
                  )}
                </td>
                <td className="py-1 pr-2">
                  <Input type="number" className="w-24! text-right" aria-label={`${title}: row ${i + 1} %`} value={pct} onChange={(e) => set(i, 1, e.target.value)} />
                </td>
                <td className="py-1">
                  {!last ? (
                    <Button size="sm" tone="plain" aria-label={`Remove row ${i + 1}, ${title}`} onClick={() => onChange(bands.filter((_, k) => k !== i))}>Remove</Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Button size="sm" className="mt-2" onClick={add}>Add a band</Button>
    </div>
  );
}

export default function PriceRulesRedesign() {
  const toast = useToast();
  const [saved, setSaved] = useState(null);
  const [version, setVersion] = useState(null);
  const [draft, setDraft] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [brands, setBrands] = useState([]);
  const [versions, setVersions] = useState([]);
  const [serverErrors, setServerErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [goBack, setGoBack] = useState(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api.get("/api/price-rules");
      setSaved(d.rules);
      setVersion(d.version);
      setDraft(toDraft(d.rules));
      setLoadError("");
    } catch (err) {
      setLoadError(err.message || "Couldn't load the price rules.");
    }
    api.get("/api/price-rules/history").then((d) => setVersions(d.versions || [])).catch(() => setVersions([]));
  }, []);

  useEffect(() => {
    load();
    api.get("/api/suppliers")
      .then((d) => setSuppliers((d.suppliers || d || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))))
      .catch(() => {});
    api.get("/api/brands")
      .then((d) => setBrands((d.brands || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))))
      .catch(() => {});
  }, [load]);

  const rules = useMemo(() => (draft ? toRules(draft) : null), [draft]);
  const savedRules = useMemo(() => (saved ? toRules(toDraft(saved)) : null), [saved]);
  const errors = useMemo(() => (rules ? validateRules(rules) : []), [rules]);
  const changed = rules && savedRules && !sameJson(rules, savedRules);
  const preview = useMemo(() => (rules && savedRules && !errors.length ? previewRows(savedRules, rules) : null), [rules, savedRules, errors]);

  const edit = (fn) => { setServerErrors([]); setDraft((d) => fn(structuredClone(d))); };

  async function save() {
    setBusy(true);
    setServerErrors([]);
    try {
      await api.put("/api/price-rules", { rules });
      toast.success("Price rules saved. They apply from the next supplier bill.");
      await load();
    } catch (err) {
      setServerErrors(err.body?.errors || [err.message || "Couldn't save the price rules."]);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    const v = goBack;
    setBusy(true);
    try {
      await api.post(`/api/price-rules/history/${v.id}/restore`, {});
      toast.success(`Back to version ${v.id}.`);
      setGoBack(null);
      await load();
    } catch (err) {
      toast.error(err.message || "Couldn't go back to that version.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <PageShell title="Price rules"><SectionCard className="p-4 text-sm text-(--ui-danger-fg)">{loadError}</SectionCard></PageShell>;
  if (!draft) return <PageShell title="Price rules"><p className="text-sm text-(--ui-text-muted)">Loading…</p></PageShell>;

  const problems = [...errors, ...serverErrors];
  return (
    <PageShell
      title="Price rules"
      subtitle="The selling price suggested for a toy on a supplier bill: % added on cost, first rule that fits wins. Changing a rule never changes a toy's price; it only changes the next suggestions."
      right={
        <div className="flex items-center gap-2">
          {changed ? <Button onClick={() => { setServerErrors([]); setDraft(toDraft(saved)); }} disabled={busy}>Undo changes</Button> : null}
          <Button tone="primary" onClick={save} disabled={!changed || errors.length > 0 || busy}>Save price rules</Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-(--ui-text-muted)">
        {version ? `Version ${version.id}, saved ${fmtUtcDateTime(version.saved_at)}${version.saved_by_name ? ` by ${version.saved_by_name}` : ""}.` : "Not changed yet: these are the rules from the margin sheets."}
      </p>

      {problems.length ? (
        <SectionCard className="mb-4 border-(--ui-danger-fg)! p-4">
          <p className="mb-1 text-sm font-semibold text-(--ui-danger-fg)">Fix these before saving:</p>
          <ul className="list-disc pl-5 text-sm text-(--ui-danger-fg)">{problems.map((e) => <li key={e}>{e}</li>)}</ul>
        </SectionCard>
      ) : null}

      <SectionCard className="mb-4 p-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <span>Round prices to the nearest</span>
          <Select aria-label="Round prices to the nearest" value={String(draft.rounding)} onChange={(e) => edit((d) => { d.rounding = Number(e.target.value); return d; })}>
            {ROUNDING_STEPS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </label>
      </SectionCard>

      <Rule title="Big item" hint="Big items from the ticked suppliers: tricycles, strollers, slides, ride-ons… A lower % from a set cost.">
        {/* Reads "80 % on cost, 65 % from cost 10,000". */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input type="number" className="w-24! text-right" aria-label="Big item %" value={draft.big.pct} onChange={(e) => edit((d) => { d.big.pct = e.target.value; return d; })} />
          <span>% on cost,</span>
          <Input type="number" className="w-24! text-right" aria-label="Big item from that cost %" value={draft.big.high_pct} onChange={(e) => edit((d) => { d.big.high_pct = e.target.value; return d; })} />
          <span>% from cost</span>
          <Input type="number" className="w-28! text-right" aria-label="Big item: from cost" value={draft.big.high_from_cost} onChange={(e) => edit((d) => { d.big.high_from_cost = e.target.value; return d; })} />
        </div>
        {[["Big items", "Suppliers for big items"], ["Scooty only", "Suppliers where only these words count"]].map(([name, tickTitle], gi) => (
          <div key={name} className="rounded-(--ui-radius-sm) border border-(--ui-border) p-3">
            <h3 className="mb-2 text-sm font-semibold">{name}</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Ticks title={tickTitle} items={suppliers} ids={draft.big.groups[gi].supplier_ids} onChange={(ids) => edit((d) => { d.big.groups[gi].supplier_ids = ids; return d; })} />
              <Words label={`${name}: item words`} value={draft.big.groups[gi].words} onChange={(v) => edit((d) => { d.big.groups[gi].words = v; return d; })} />
            </div>
          </div>
        ))}
      </Rule>

      <Rule title="B.B Land & T&T list" hint="Non-brand toys from the ticked suppliers whose name has one of these words.">
        <Pct label="B.B Land & T&T list %" value={draft.bbtt.pct} onChange={(v) => edit((d) => { d.bbtt.pct = v; return d; })} />
        <div className="grid gap-4 md:grid-cols-2">
          <Ticks title="Suppliers" items={suppliers} ids={draft.bbtt.supplier_ids} onChange={(ids) => edit((d) => { d.bbtt.supplier_ids = ids; return d; })} />
          <Words label="B.B Land & T&T list: item words" value={draft.bbtt.words} onChange={(v) => edit((d) => { d.bbtt.words = v; return d; })} />
        </div>
      </Rule>

      <Rule title="Stuff & stationery" hint="Every toy from the ticked suppliers, and toys of the ticked brands.">
        <Pct label="Stuff & stationery %" value={draft.stationery.pct} onChange={(v) => edit((d) => { d.stationery.pct = v; return d; })} />
        <Ticks title="Suppliers" items={suppliers} ids={draft.stationery.supplier_ids} onChange={(ids) => edit((d) => { d.stationery.supplier_ids = ids; return d; })} />
        <Ticks title="Brands (from Catalog → Brands)" items={brands} ids={draft.stationery.brand_ids} onChange={(ids) => edit((d) => { d.stationery.brand_ids = ids; return d; })} />
      </Rule>

      <Rule title="Brand, by cost" hint="Any other toy with a brand.">
        <Bands title="Brand, by cost" bands={draft.brand.bands} onChange={(b) => edit((d) => { d.brand.bands = b; return d; })} />
      </Rule>

      <Rule title="Non-brand, by cost" hint="Everything else.">
        <Bands title="Non-brand, by cost" bands={draft.nonbrand.bands} onChange={(b) => edit((d) => { d.nonbrand.bands = b; return d; })} />
      </Rule>

      <SectionCard className="mb-4 p-4">
        <h2 className="mb-1 text-base font-semibold">Preview</h2>
        <p className="mb-3 text-sm text-(--ui-text-muted)">Suggested price for a piece costing… (saved rules → your changes).</p>
        {preview ? (
          <div className="overflow-x-auto">
            <table aria-label="Preview" className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-(--ui-text-muted)">
                  <th className="py-1 pr-3 font-semibold">Rule</th>
                  {preview[0].cells.map((c) => <th key={c.cost} className="py-1 pr-3 text-right font-semibold">Cost {c.cost.toLocaleString()}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.key} className="border-t border-(--ui-border)">
                    <td className="py-1.5 pr-3">{row.label}</td>
                    {row.cells.map((c) => (
                      <td key={c.cost} className={`py-1.5 pr-3 text-right tabular-nums ${c.changed ? "font-semibold text-(--ui-text)" : "text-(--ui-text-muted)"}`}>
                        {c.changed ? `${c.old.toLocaleString()} → ${c.new.toLocaleString()}` : c.new.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-(--ui-text-muted)">Fix the problems above to see the preview.</p>}
      </SectionCard>

      <div role="region" aria-label="History">
        <SectionCard className="p-4">
          <h2 className="mb-2 text-base font-semibold">History</h2>
          {versions.length ? (
            <ul className="divide-y divide-(--ui-border) text-sm">
              {versions.map((v, i) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <b>Version {v.id}</b> · {fmtUtcDateTime(v.saved_at)}{v.saved_by_name ? ` · ${v.saved_by_name}` : ""}
                    {v.restored_from ? <span className="text-(--ui-text-muted)"> · went back to version {v.restored_from}</span> : null}
                    {i === 0 ? <span className="text-(--ui-text-muted)"> · in use</span> : null}
                  </span>
                  {i > 0 ? (
                    <Button size="sm" aria-label={`Go back to version ${v.id}`} onClick={() => setGoBack(v)} disabled={busy}>Go back to this version</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-(--ui-text-muted)">No saves yet.</p>}
        </SectionCard>
      </div>

      <ConfirmDialog
        open={!!goBack}
        title={goBack ? `Go back to version ${goBack.id}?` : ""}
        body={goBack ? `The rules become what they were in version ${goBack.id}. This is saved as a new version; no toy's price changes.` : ""}
        confirmLabel="Go back"
        busy={busy}
        onConfirm={restore}
        onCancel={() => setGoBack(null)}
      />
    </PageShell>
  );
}

