// One Toy Store F9 (c1): the check screen's lines. Each bill line in the
// bill's own order (S.No, page) with: pieces received (vs billed), which toy(s)
// they are, cost per piece after discounts / split, our selling price.
import { useMemo, useState } from "react";
import { Badge, Button, FilterPill, Input } from "../../../ui/primitives";
import ItemSearchBox from "../../../ui/ItemSearchBox";
import { lineStatus, unitCost } from "./billMath";

const STATUS = {
  ready: { tone: "success", label: "Ready" },
  confirm: { tone: "warning", label: "Confirm toy" },
  pick: { tone: "danger", label: "Which toy?" },
  split: { tone: "warning", label: "Share pieces" },
};
const HOW = { supplier_code: "their code", barcode: "barcode", name_code: "code in name", similar: "similar name", picked: "picked" };

export default function CheckLines({ lines, onChange, billDiscountRatio = 0, multiFile = false }) {
  // A filter picks its rows when pressed; they stay while being edited (a row
  // that becomes ready doesn't jump away under the cursor).
  const [show, setShow] = useState({ k: "all", keys: null });
  const counts = useMemo(() => {
    const c = { all: lines.length, ready: 0, confirm: 0, pick: 0, split: 0 };
    for (const l of lines) c[lineStatus(l)] += 1;
    return c;
  }, [lines]);
  const visible = show.keys ? lines.filter((l) => show.keys.has(l.key)) : lines;
  const pickFilter = (k) => setShow({ k, keys: k === "all" ? null : new Set(lines.filter((l) => lineStatus(l) === k).map((l) => l.key)) });

  const set = (key, fn) => onChange(lines.map((l) => (l.key === key ? fn({ ...l, toys: l.toys.map((t) => ({ ...t })) }) : l)));
  const pieces = (l) => (Number(l.received) || 0) * Math.max(1, Number(l.split_into) || 1);
  const reshare = (l) => {
    if (l.toys.length === 1) l.toys[0].qty = pieces(l);
    return l;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {[["all", "All"], ["pick", "Which toy?"], ["confirm", "Confirm toy"], ["split", "Share pieces"], ["ready", "Ready"]].map(([k, label]) => (
          <FilterPill key={k} label={label} value={String(counts[k])} active={show.k === k} onClick={() => pickFilter(k)} />
        ))}
      </div>
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
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {l.billed}
                    <div className="text-xs text-(--ui-text-muted)">× {Number(l.rate).toLocaleString()}</div>
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      className="w-20! shrink-0"
                      aria-label={`Received, line ${l.line_no}`}
                      value={l.received}
                      onChange={(e) => set(l.key, (x) => reshare({ ...x, received: e.target.value === "" ? "" : Number(e.target.value) }))}
                    />
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
                    <ToyCell line={l} pieces={pieces(l)} set={(fn) => set(l.key, fn)} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {cost.toLocaleString()}
                    {l.toys.length === 1 && Number(l.toys[0].cost_price) && Number(l.toys[0].cost_price) !== cost ? (
                      <div className="text-xs text-(--ui-text-muted)">was {Number(l.toys[0].cost_price).toLocaleString()}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {l.toys.map((t) => (
                      <div key={t.product_id} className={Number(t.price) <= cost ? "text-(--ui-danger-fg)" : ""}>
                        {Number(t.price || 0).toLocaleString()}
                      </div>
                    ))}
                    {l.is_new ? <span className="text-xs text-(--ui-text-muted)">set in next step</span> : null}
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

function ToyCell({ line, pieces, set }) {
  const [finding, setFinding] = useState(false);
  const addToy = (p, how = "picked") => set((x) => {
    if (x.toys.some((t) => t.product_id === (p.product_id ?? p.id))) return x;
    const toy = { product_id: p.product_id ?? p.id, name: p.name, sku: p.sku, barcode: p.barcode, price: Number(p.price) || 0, cost_price: Number(p.cost_price) || 0, how, qty: 0 };
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
    return (
      <div>
        <div className="mb-1 flex items-center gap-2">
          <Badge>New toy</Badge>
          <Button size="sm" tone="link" onClick={() => set((x) => ({ ...x, is_new: false }))}>undo</Button>
        </div>
        <Input aria-label={`New toy name, line ${line.line_no}`} value={line.new_name} onChange={(e) => set((x) => ({ ...x, new_name: e.target.value }))} />
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
