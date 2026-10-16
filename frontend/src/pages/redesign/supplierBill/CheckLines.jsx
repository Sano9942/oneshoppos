// One Toy Store F9 (c1): the check screen's lines. Each bill line in the
// bill's own order (S.No, page) with: pieces received (vs billed), which toy(s)
// they are, cost per piece after discounts / split, our selling price.
// (d) a new toy: name, category, Brand / Non-brand, its own code or the next
// from 31000, maker's barcode, price from the shop's rules; an existing toy
// whose cost changes gets the rule's price as a suggestion ("Use").
import { useMemo, useState } from "react";
import { Badge, Button, FilterPill, Input, Select } from "../../../ui/primitives";
import ItemSearchBox from "../../../ui/ItemSearchBox";
import { lineStatus, newToyPrice, piecesNow, suggestedPrice, unitCost } from "./billMath";
import { RULES } from "./priceRules";

const STATUS = {
  ready: { tone: "success", label: "Ready" },
  confirm: { tone: "warning", label: "Confirm toy" },
  pick: { tone: "danger", label: "Which toy?" },
  split: { tone: "warning", label: "Share pieces" },
  newtoy: { tone: "warning", label: "Fill in new toy" },
};
const HOW = { supplier_code: "their code", barcode: "barcode", name_code: "code in name", similar: "similar name", picked: "picked" };

export default function CheckLines({ lines, onChange, billDiscountRatio = 0, multiFile = false, supplierName = "", categories = [], brands = [] }) {
  const ctx = { supplierName, billDiscountRatio };
  // A filter picks its rows when pressed; they stay while being edited (a row
  // that becomes ready doesn't jump away under the cursor).
  const [show, setShow] = useState({ k: "all", keys: null });
  const counts = useMemo(() => {
    const c = { all: lines.length, ready: 0, confirm: 0, pick: 0, split: 0, newtoy: 0 };
    for (const l of lines) c[lineStatus(l)] += 1;
    return c;
  }, [lines]);
  const visible = show.keys ? lines.filter((l) => show.keys.has(l.key)) : lines;
  const pickFilter = (k) => setShow({ k, keys: k === "all" ? null : new Set(lines.filter((l) => lineStatus(l) === k).map((l) => l.key)) });

  const set = (key, fn) => onChange(lines.map((l) => (l.key === key ? fn({ ...l, toys: l.toys.map((t) => ({ ...t })) }) : l)));
  const pieces = (l) => piecesNow(l);
  const reshare = (l) => {
    if (l.toys.length === 1) l.toys[0].qty = pieces(l);
    return l;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {[["all", "All"], ["pick", "Which toy?"], ["confirm", "Confirm toy"], ["split", "Share pieces"], ["newtoy", "Fill in new toy"], ["ready", "Ready"]].map(([k, label]) => (
          <FilterPill key={k} label={label} value={String(counts[k])} active={show.k === k} onClick={() => pickFilter(k)} />
        ))}
      </div>
      <datalist id="f9-brand-list">
        {brands.map((b) => <option key={b} value={b} />)}
      </datalist>
      <div className="overflow-x-auto rounded-(--ui-radius-md) border border-(--ui-border)">
        <table className="w-full text-sm">
          <thead className="bg-(--ui-muted-surface) text-left text-xs uppercase text-(--ui-text-muted)">
            <tr>
              <th className="px-2 py-2">S.No</th>
              <th className="px-2 py-2">Their code · description</th>
              <th className="px-2 py-2 text-right">Billed</th>
              <th className="px-2 py-2">Received</th>
              <th className="px-2 py-2">Split</th>
              <th className="px-2 py-2">Our toy</th>
              <th className="px-2 py-2 text-right">Cost / pc</th>
              <th className="px-2 py-2 text-right">Our price</th>
              <th className="px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => {
              const st = lineStatus(l);
              const cost = unitCost(l, billDiscountRatio);
              return (
                <tr key={l.key} className="border-t border-(--ui-border) align-top">
                  <td className="px-2 py-2 tabular-nums">
                    {l.line_no}
                    <div className="text-xs text-(--ui-text-muted)">p{multiFile ? `${l.file_index + 1}·` : ""}{l.page}</div>
                  </td>
                  <td className="max-w-64 px-2 py-2">
                    <div className="font-mono text-xs">{l.supplier_code}</div>
                    <div>{l.description}</div>
                    {l.is_return ? <Badge tone="warning">Sent back</Badge> : null}
                    {l.paper_mark === "struck" ? <Badge tone="warning">Struck through on the paper</Badge> : null}
                    {l.paper_mark === "circled" ? <Badge tone="warning">Circled on the paper</Badge> : null}
                    {l.unsure || l.read_note ? (
                      <div className="text-xs text-(--ui-warning-fg)">Hard to read{l.read_note ? `: ${l.read_note}` : ""}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {l.billed}
                    <div className="text-xs text-(--ui-text-muted)">× {Number(l.rate).toLocaleString()}{Number(l.discount_pct) ? ` − ${Number(l.discount_pct)}%` : ""}</div>
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      className="w-20! shrink-0"
                      aria-label={`Received, line ${l.line_no}`}
                      value={l.received}
                      onChange={(e) => set(l.key, (x) => reshare({ ...x, received: e.target.value === "" ? "" : Number(e.target.value) }))}
                    />
                    <WaitingOffer line={l} set={(fn) => set(l.key, fn)} />
                    {Number(l.received) !== Number(l.billed) ? (
                      <div className="mt-1 text-xs text-(--ui-warning-fg)">
                        {Number(l.received) < Number(l.billed) ? `${l.billed - l.received} not received` : `${l.received - l.billed} extra`}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min="1"
                      className="w-16! shrink-0"
                      aria-label={`Split into pieces, line ${l.line_no}`}
                      value={l.split_into}
                      onChange={(e) => set(l.key, (x) => reshare({ ...x, split_into: Math.max(1, Number(e.target.value) || 1) }))}
                    />
                    {l.split_into > 1 ? <div className="mt-1 text-xs text-(--ui-text-muted)">{pieces(l)} pcs</div> : null}
                  </td>
                  <td className="min-w-72 px-2 py-2">
                    <ToyCell line={l} pieces={pieces(l)} set={(fn) => set(l.key, fn)} categories={categories} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {cost.toLocaleString()}
                    {l.toys.length === 1 && Number(l.toys[0].cost_price) && Number(l.toys[0].cost_price) !== cost ? (
                      <div className="text-xs text-(--ui-text-muted)">was {Number(l.toys[0].cost_price).toLocaleString()}</div>
                    ) : null}
                  </td>
                  <td className="min-w-40 px-2 py-2 text-right tabular-nums">
                    {l.is_new ? (
                      <NewToyPrice line={l} cost={cost} ctx={ctx} set={(fn) => set(l.key, fn)} />
                    ) : l.toys.map((t) => (
                      <ToyPrice key={t.product_id} line={l} toy={t} cost={cost} ctx={ctx} set={(fn) => set(l.key, fn)} />
                    ))}
                  </td>
                  <td className="px-2 py-2"><Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// F9 (f) 6/6: extra pieces of this toy already in the shop, waiting for this
// supplier's bill: pre-ticked "These are those pieces" (not stock again).
function WaitingOffer({ line, set }) {
  const offer = line.waiting_offer || [];
  if (!offer.length) return null;
  const total = offer.reduce((a, w) => a + w.qty, 0);
  const bills = [...new Set(offer.map((w) => `${w.bill_number || "(no number)"}${w.bill_date ? ` (${w.bill_date})` : ""}`))].join(", ");
  return (
    <div className="mt-1 max-w-56 text-xs" data-testid={`waiting-offer-${line.line_no}`}>
      <div className="text-(--ui-text-muted)">{total} pcs already in the shop: extras from bill {bills}</div>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={!line.waiting_off} aria-label={`These are those pieces, line ${line.line_no}`}
          onChange={(e) => set((x) => ({ ...x, waiting_off: !e.target.checked }))} />
        These are those pieces
      </label>
      {!line.waiting_off ? <div className="text-(--ui-text-muted)">{Math.max(0, piecesNow(line))} pcs arrive now</div> : null}
    </div>
  );
}

// A new toy's price: the rule's (shown greyed) until the shop types one; the
// rule can be switched. Red when not above cost; a note when below the rule.
function NewToyPrice({ line, cost, ctx, set }) {
  const r = newToyPrice(line, ctx);
  const nt = (patch) => set((x) => ({ ...x, new_toy: { ...x.new_toy, ...patch } }));
  return (
    <div className="space-y-1">
      <Input
        type="number"
        className={`ml-auto w-24! text-right ${r.price <= cost ? "text-(--ui-danger-fg)" : ""}`}
        aria-label={`Selling price, line ${line.line_no}`}
        placeholder={String(r.rule_price)}
        value={line.new_toy.price}
        onChange={(e) => nt({ price: e.target.value })}
      />
      <div className="text-xs text-(--ui-text-muted)">
        {r.typed ? `rule ${r.rule_price.toLocaleString()}` : `+${r.pct} % on cost`}
        {r.typed && r.price < r.rule_price ? <span className="text-(--ui-warning-fg)"> · below the rule</span> : null}
      </div>
      <Select
        className="w-full text-xs"
        aria-label={`Price rule, line ${line.line_no}`}
        value={line.new_toy.rule}
        onChange={(e) => nt({ rule: e.target.value })}
      >
        <option value="">Rule: {RULES.find((x) => x.key === r.key).label}</option>
        {RULES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
      </Select>
    </div>
  );
}

// An existing toy's price; when this bill changes its cost, the rule's price
// is offered ("Use"), never applied by itself (owner).
function ToyPrice({ line, toy, cost, ctx, set }) {
  const sug = suggestedPrice(line, toy, ctx);
  const setNew = (v) => set((x) => ({ ...x, toys: x.toys.map((y) => (y.product_id === toy.product_id ? { ...y, new_price: v } : y)) }));
  if (toy.new_price !== undefined) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-end gap-1">
          <Input
            type="number"
            className={`w-24! text-right ${Number(toy.new_price) <= cost ? "text-(--ui-danger-fg)" : ""}`}
            aria-label={`New price of ${toy.name}`}
            value={toy.new_price}
            onChange={(e) => setNew(e.target.value)}
          />
          <Button size="sm" tone="plain" aria-label={`Keep the old price of ${toy.name}`} onClick={() => setNew(undefined)}>✕</Button>
        </div>
        <div className="text-xs text-(--ui-text-muted)">was {Number(toy.price || 0).toLocaleString()}</div>
      </div>
    );
  }
  return (
    <div>
      <div className={Number(toy.price) <= cost ? "text-(--ui-danger-fg)" : ""}>{Number(toy.price || 0).toLocaleString()}</div>
      {sug ? (
        <div className="flex items-center justify-end gap-1 text-xs text-(--ui-text-muted)">
          rule {sug.price.toLocaleString()}
          <Button size="sm" tone="link" aria-label={`Use ${sug.price} for ${toy.name}`} onClick={() => setNew(sug.price)}>Use</Button>
        </div>
      ) : null}
    </div>
  );
}

function ToyCell({ line, pieces, set, categories }) {
  const [finding, setFinding] = useState(false);
  const addToy = (p, how = "picked") => set((x) => {
    if (x.toys.some((t) => t.product_id === (p.product_id ?? p.id))) return x;
    const toy = { product_id: p.product_id ?? p.id, name: p.name, sku: p.sku, barcode: p.barcode, price: Number(p.price) || 0, cost_price: Number(p.cost_price) || 0, brand_id: p.brand_id ?? null, brand_name: p.brand_name ?? null, how, qty: 0 };
    const toys = [...x.toys, toy];
    if (toys.length === 1) toys[0].qty = pieces;
    return { ...x, is_new: false, toys, suggestions: x.suggestions.filter((s) => s.product_id !== toy.product_id) };
  });
  const removeToy = (id) => set((x) => {
    const toys = x.toys.filter((t) => t.product_id !== id);
    if (toys.length === 1) toys[0].qty = pieces;
    return { ...x, toys };
  });

  if (line.is_new) {
    const t = line.new_toy;
    const nt = (patch) => set((x) => ({ ...x, new_toy: { ...x.new_toy, ...patch } }));
    const n = line.line_no;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge>New toy</Badge>
          <Button size="sm" tone="link" onClick={() => set((x) => ({ ...x, is_new: false }))}>undo</Button>
        </div>
        <Input aria-label={`New toy name, line ${n}`} value={t.name} onChange={(e) => nt({ name: e.target.value })} />
        <Select className="w-full" aria-label={`Category, line ${n}`} value={t.category_id} onChange={(e) => nt({ category_id: e.target.value })}>
          <option value="">Category…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.path_label || c.name}</option>)}
        </Select>
        <div className="flex items-center gap-1">
          <Button size="sm" tone={t.is_brand === true ? "primary" : "default"} aria-pressed={t.is_brand === true} onClick={() => nt({ is_brand: true })}>
            Brand
          </Button>
          <Button size="sm" tone={t.is_brand === false ? "primary" : "default"} aria-pressed={t.is_brand === false} onClick={() => nt({ is_brand: false })}>
            Non-brand
          </Button>
          {t.is_brand ? (
            <Input className="min-w-0 flex-1" list="f9-brand-list" placeholder="Which brand?" aria-label={`Brand, line ${n}`}
              value={t.brand_name} onChange={(e) => nt({ brand_name: e.target.value })} />
          ) : null}
        </div>
        <div className="flex gap-1">
          <Input className="w-28! shrink-0 font-mono" inputMode="numeric" maxLength={5} placeholder="Code: next" aria-label={`Shop code, line ${n}`}
            value={t.code} onChange={(e) => nt({ code: e.target.value.replace(/\D/g, "") })} />
          <Input className="min-w-0 flex-1 font-mono" placeholder="Scan maker's barcode" aria-label={`Maker's barcode, line ${n}`}
            value={t.barcode} onChange={(e) => nt({ barcode: e.target.value.trim() })} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {line.toys.map((t) => (
        <div key={t.product_id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate">{t.name}</div>
            <div className="text-xs text-(--ui-text-muted)">
              <span className="font-mono">{t.barcode || t.sku}</span> · {HOW[t.how] || t.how}
            </div>
          </div>
          {line.toys.length > 1 ? (
            <Input
              type="number"
              className="w-16! shrink-0"
              aria-label={`Pieces of ${t.name}`}
              value={t.qty}
              onChange={(e) => set((x) => ({ ...x, toys: x.toys.map((y) => (y.product_id === t.product_id ? { ...y, qty: Number(e.target.value) || 0 } : y)) }))}
            />
          ) : null}
          <Button size="sm" tone="plain" aria-label={`Remove ${t.name}`} onClick={() => removeToy(t.product_id)}>✕</Button>
        </div>
      ))}
      {line.toys.length > 1 ? (
        <div className="text-xs text-(--ui-text-muted)">
          {line.toys.reduce((s, t) => s + (Number(t.qty) || 0), 0)} of {pieces} pieces shared out
        </div>
      ) : null}
      {line.suggestions.slice(0, 3).map((s) => (
        <div key={s.product_id} className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate">Is it <b>{s.name}</b>? <span className="text-(--ui-text-muted)">({HOW[s.how]})</span></span>
          <Button size="sm" onClick={() => addToy(s, s.how)}>Yes</Button>
        </div>
      ))}
      {finding || !line.toys.length ? (
        <div className="flex items-center gap-2">
          <ItemSearchBox className="flex-1" ariaLabel={`Find toy, line ${line.line_no}`} onPick={(p) => { addToy(p); setFinding(false); }} />
          <Button size="sm" onClick={() => set((x) => ({ ...x, is_new: true, toys: [] }))}>New toy</Button>
        </div>
      ) : (
        <Button size="sm" tone="link" onClick={() => setFinding(true)}>
          {line.toys.length ? "add / change toy" : "find toy"}
        </Button>
      )}
    </div>
  );
}
