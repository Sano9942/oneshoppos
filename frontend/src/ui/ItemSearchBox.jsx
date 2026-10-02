// Find a toy by code, barcode or name: the same search the till uses
// (GET /api/products/search: exact code first, then codes starting with it,
// then names; extra barcodes count). Scanner-friendly: a scanned code + Enter
// picks the exact match. One Toy Store F9 check screen; meant for F5
// (Adjustments / Transfers / Promotions) too.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button, Input } from "./primitives";

export default function ItemSearchBox({ onPick, placeholder = "Code, barcode or name…", autoFocus = false, className = "", ariaLabel = "Find item" }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (!text) return undefined;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api.get("/api/products/search", { query: text })
        .then((d) => {
          if (mine !== seq.current) return;
          setResults((d.products || []).slice(0, 12));
          setActive(0);
          setOpen(true);
        })
        .catch(() => {
          if (mine === seq.current) setResults([]);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (p) => {
    if (!p) return;
    onPick(p);
    setQ("");
    setResults([]);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <Input
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value.trim()) {
            seq.current += 1;
            setResults([]);
          }
        }}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length ? (
        <div role="listbox" className="absolute z-20 mt-1 max-h-72 w-full min-w-72 overflow-y-auto rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-surface) shadow-sm">
          {results.map((p, i) => (
            <Button
              key={p.id}
              tone="plain"
              role="option"
              aria-selected={i === active}
              className={`h-auto! w-full justify-between! rounded-none! px-3! py-1.5! text-left ${i === active ? "bg-(--ui-muted-surface)" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <span className="min-w-0 flex-1 truncate text-(--ui-text)">{p.name}</span>
              <span className="ml-3 shrink-0 font-mono text-xs text-(--ui-text-muted)">{p.barcode || p.sku}</span>
              <span className="ml-3 shrink-0 tabular-nums text-xs">{Number(p.price || 0).toLocaleString()}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
