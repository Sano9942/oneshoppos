import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, ChevronDown, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { readContext, writeContext } from "../auth/authStore";
import { useAuth } from "../auth/AuthProvider";
import { API_BASE as API } from "../config";

export default function ContextSwitcher() {
  const { employee, hasPerm } = useAuth();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState(() => readContext());
  const [outlets, setOutlets] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Load allowed outlets on mount
  useEffect(() => {
    if (!employee?.id) return;
    fetch(`${API}/api/context/bootstrap`)
      .then((r) => r.json())
      .then((data) => {
        if (data.outlets) setOutlets(data.outlets);
      })
      .catch(() => {});
  }, [employee?.id]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const switchOutlet = useCallback(
    (outletId) => {
      const isAllowed = outlets.some((o) => Number(o.id) === Number(outletId));
      if (!isAllowed) return;
      const current = readContext() || {};
      const next = { ...current, active_outlet_id: outletId, scope_mode: "single_branch" };
      writeContext(next);
      setCtx(next);
      setOpen(false);
    },
    [outlets],
  );

  const switchToAll = useCallback(() => {
    if (!hasPerm("all_access")) return;
    const current = readContext() || {};
    const next = { ...current, active_outlet_id: null, scope_mode: "all_branches" };
    writeContext(next);
    setCtx(next);
    setOpen(false);
  }, [hasPerm]);

  const goToContextSelect = useCallback(() => {
    setOpen(false);
    navigate("/context-select");
  }, [navigate]);

  if (!ctx) return null;

  const currentOutlet = ctx.active_outlet_id
    ? outlets.find((o) => o.id === ctx.active_outlet_id)
    : null;
  const label = ctx.scope_mode === "all_branches"
    ? "All Branches"
    : currentOutlet?.name || `Outlet #${ctx.active_outlet_id}`;
  const isAdmin = hasPerm("all_access");

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="ui-focus-ring flex items-center gap-1.5 rounded-md border border-(--ui-border) px-2 py-1.5 text-xs text-(--ui-text) hover:bg-(--ui-muted-surface)"
      >
        {ctx.scope_mode === "all_branches" ? (
          <Building2 size={13} className="text-(--ui-text-muted)" />
        ) : (
          <MapPin size={13} className="text-(--ui-text-muted)" />
        )}
        <span className="max-w-30 truncate">{label}</span>
        <ChevronDown size={12} className="text-(--ui-text-muted)" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-md border border-(--ui-border) bg-white shadow-lg">
          <div className="p-1.5">
            {isAdmin && (
              <button
                onClick={switchToAll}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-(--ui-muted-surface) ${ctx.scope_mode === "all_branches" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-(--ui-text)"}`}
              >
                <Building2 size={12} />
                All Branches
              </button>
            )}
            {outlets.map((o) => (
              <button
                key={o.id}
                onClick={() => switchOutlet(o.id)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-(--ui-muted-surface) ${ctx.active_outlet_id === o.id && ctx.scope_mode !== "all_branches" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-(--ui-text)"}`}
              >
                <MapPin size={12} />
                <span className="truncate">{o.name}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-(--ui-border) p-1.5">
            <button
              onClick={goToContextSelect}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
            >
              Change context...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
