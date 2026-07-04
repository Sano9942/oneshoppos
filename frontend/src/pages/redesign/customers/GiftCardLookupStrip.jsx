import { useState } from "react";
import { Gift, Search } from "lucide-react";
import { api } from "../../../api";
import { useCurrency } from "../../../contexts/CurrencyContext";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { Button, Input, SectionCard } from "../../../ui/primitives";

/**
 * Phase 2-G Wave 2 (2-G.2) — small gift-card balance lookup strip.
 *
 * Sits at the top of the Customers page so any staff member can
 * check a card balance while on the phone with a customer, without
 * navigating to /gift-cards. Flag-gated by phase2g_gift_cards —
 * renders null when off so pre-wave-2 merchants see zero change.
 *
 * Intentionally does NOT call useAuth: auth headers are injected by
 * AuthProvider's global fetch interceptor, so `api.*` calls from a
 * component rendered below <AuthProvider> already carry credentials.
 * Skipping useAuth keeps the strip renderable in test harnesses that
 * stub CurrencyContext/PresetContext/api but don't wrap the tree in
 * AuthProvider (see tests/unit/customers-clinical-subjects.test.jsx).
 */
export default function GiftCardLookupStrip() {
  const { flags, loading } = useFeatureFlags();
  const { fmt } = useCurrency();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  if (loading || !flags.phase2g_gift_cards) return null;

  const lookup = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const data = await api.get(`/api/gift-cards/${encodeURIComponent(c)}/balance`);
      setResult(data);
    } catch (err) {
      setError(err.body?.error || "Gift card not found");
    } finally {
      setBusy(false);
    }
  };

  const statusTone = {
    active: "bg-(--ui-success-bg) border-transparent text-(--ui-success-fg)",
    depleted: "bg-(--ui-danger-bg) border-transparent text-(--ui-danger-fg)",
    pre_printed: "bg-(--ui-muted-surface) border-transparent text-(--ui-text-muted)",
    issued: "bg-(--ui-warning-bg) border-transparent text-(--ui-warning-fg)",
  };

  return (
    <SectionCard className="mb-3 p-3">
      <form className="flex items-center gap-2 flex-wrap" onSubmit={lookup}>
        <div className="flex items-center gap-2 text-sm font-semibold text-(--ui-text)">
          <Gift size={16} className="text-(--ui-text-muted)" />
          Gift Card Balance
        </div>
        <Input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setResult(null);
            setError("");
          }}
          placeholder="Scan or paste code"
          className="font-mono flex-1 min-w-48 max-w-80"
        />
        <Button tone="primary" type="submit" disabled={busy || !code.trim()}>
          <Search size={14} className="mr-1 inline" />
          {busy ? "Checking…" : "Check"}
        </Button>

        {result && (
          <div
            className={`flex items-center gap-3 rounded-md border px-3 py-1.5 text-xs ${
              statusTone[result.activation_status] || statusTone.pre_printed
            }`}
          >
            <span className="font-mono font-bold tracking-wider">{result.code}</span>
            <span>
              Balance <strong className="font-semibold">{fmt(result.remaining_value)}</strong>
              {" "} / {fmt(result.initial_value)}
            </span>
            <span className="capitalize">{String(result.activation_status).replace("_", " ")}</span>
          </div>
        )}
        {error && (
          <div className="rounded-md bg-(--ui-danger-bg) px-3 py-1.5 text-xs text-(--ui-danger-fg)">
            {error}
          </div>
        )}
      </form>
    </SectionCard>
  );
}
