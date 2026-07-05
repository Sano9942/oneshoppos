import React, { useState, useMemo, useEffect } from "react";
import { X } from "lucide-react";
import { usePOS } from "./POSContext";
import { useCurrency } from "../../../contexts/CurrencyContext";

export default function POSModifierModal() {
  const { modifierModalState, confirmModifiers, cancelModifiers } = usePOS();
  const { fmt } = useCurrency();
  const [picked, setPicked] = useState({});
  const [error, setError] = useState("");

  const open = Boolean(modifierModalState);
  const product = modifierModalState?.product;
  const groups = modifierModalState?.groups || [];

  useEffect(() => {
    if (!open) return;
    const defaults = {};
    for (const g of groups) {
      const defaultOpts = (g.options || []).filter((o) => o.is_default);
      if (g.selection_type === "single") {
        defaults[g.id] = defaultOpts[0] ? [defaultOpts[0].id] : [];
      } else {
        defaults[g.id] = defaultOpts.map((o) => o.id);
      }
    }
    setPicked(defaults);
    setError("");
    // Reset handled on next open; no cleanup needed on close since the modal
    // unmounts (via `if (!open) return null` below) and remounts fresh.
  }, [open, modifierModalState?.product?.id]);

  const toggle = (group, optionId) => {
    setError("");
    setPicked((prev) => {
      const cur = prev[group.id] || [];
      if (group.selection_type === "single") {
        return { ...prev, [group.id]: cur[0] === optionId ? [] : [optionId] };
      }
      if (cur.includes(optionId)) {
        return { ...prev, [group.id]: cur.filter((x) => x !== optionId) };
      }
      if (group.max_select != null && cur.length >= group.max_select) {
        return prev;
      }
      return { ...prev, [group.id]: [...cur, optionId] };
    });
  };

  const priceDelta = useMemo(() => {
    let sum = 0;
    for (const g of groups) {
      const picks = picked[g.id] || [];
      for (const id of picks) {
        const opt = (g.options || []).find((o) => o.id === id);
        if (opt) sum += Number(opt.price_delta || 0);
      }
    }
    return sum;
  }, [picked, groups]);

  const flatModifiers = useMemo(() => {
    const out = [];
    for (const g of groups) {
      const picks = picked[g.id] || [];
      for (const id of picks) {
        const opt = (g.options || []).find((o) => o.id === id);
        if (opt) {
          out.push({
            option_id: id,
            group_id: g.id,
            group_name: g.name,
            name: opt.name,
            price_delta: Number(opt.price_delta || 0),
          });
        }
      }
    }
    return out;
  }, [picked, groups]);

  const handleAdd = () => {
    for (const g of groups) {
      const picks = picked[g.id] || [];
      const min = g.min_select ?? (g.is_required ? 1 : 0);
      if (picks.length < min) {
        setError(`"${g.name}" requires at least ${min} selection${min === 1 ? "" : "s"}.`);
        return;
      }
      if (g.max_select != null && picks.length > g.max_select) {
        setError(`"${g.name}" allows at most ${g.max_select}.`);
        return;
      }
    }
    confirmModifiers(flatModifiers, priceDelta);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-(--ui-surface) shadow-(--ui-shadow-lg) flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-(--ui-border-strong)">
          <div>
            <div className="text-xs uppercase tracking-wide text-(--ui-text-muted)">Customize</div>
            <div className="text-base font-semibold text-(--ui-text)">{product?.name || "Item"}</div>
          </div>
          <button onClick={cancelModifiers} className="p-1 hover:bg-(--ui-muted-surface) rounded">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {groups.length === 0 && (
            <div className="text-sm text-(--ui-text-muted)">No modifier options for this item.</div>
          )}
          {groups.map((g) => {
            const picks = picked[g.id] || [];
            const headerRule = g.selection_type === "single"
              ? "Pick one"
              : g.max_select
                ? `Pick up to ${g.max_select}`
                : "Pick any";
            const req = g.is_required || (g.min_select ?? 0) > 0;
            return (
              <div key={g.id}>
                <div className="flex items-baseline justify-between mb-2">
                  <div className="text-sm font-semibold text-(--ui-text)">
                    {g.name}
                    {req && <span className="text-(--ui-danger-fg) ml-1">*</span>}
                  </div>
                  <div className="text-xs text-(--ui-text-muted)">{headerRule}</div>
                </div>
                <div className="space-y-1.5">
                  {(g.options || []).map((o) => {
                    const active = picks.includes(o.id);
                    const delta = Number(o.price_delta || 0);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggle(g, o.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition ${
                          active
                            ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                            : "border-(--ui-border-strong) hover:border-(--ui-border-strong) bg-(--ui-surface) text-(--ui-text)"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`w-4 h-4 rounded-${g.selection_type === "single" ? "full" : "sm"} border flex items-center justify-center ${
                              active ? "border-(--ui-primary) bg-(--ui-primary)" : "border-(--ui-border-strong)"
                            }`}
                          >
                            {active && <span className="w-2 h-2 bg-(--ui-surface) rounded-full" />}
                          </span>
                          <span>{o.name}</span>
                        </span>
                        {delta !== 0 && (
                          <span className={`text-xs font-medium ${delta > 0 ? "text-(--ui-text-muted)" : "text-(--ui-success-fg)"}`}>
                            {delta > 0 ? "+" : ""}{fmt(delta)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="px-5 pt-2 text-xs text-(--ui-danger-fg)">{error}</div>
        )}

        <div className="px-5 py-3 border-t border-(--ui-border-strong) flex items-center justify-between gap-3">
          <div className="text-sm text-(--ui-text-muted)">
            {priceDelta !== 0 && (
              <span>Modifiers: <b className="text-(--ui-text)">{priceDelta > 0 ? "+" : ""}{fmt(priceDelta)}</b></span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={cancelModifiers}
              className="px-4 py-2 rounded-lg border border-(--ui-border-strong) text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface)"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              className="px-4 py-2 rounded-lg bg-(--ui-primary) text-white text-sm font-semibold hover:bg-(--ui-primary-strong)"
            >
              Add to cart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
