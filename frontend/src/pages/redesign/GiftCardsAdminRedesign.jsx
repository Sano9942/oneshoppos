import { useEffect, useState } from "react";
import { Plus, Gift, Search, Layers } from "lucide-react";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
} from "../../ui/primitives";

const STATUS_TONE = {
  active: "success",
  pre_printed: "default",
  issued: "warning",
  depleted: "danger",
};

export default function GiftCardsAdminRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { fmt } = useCurrency();
  const toast = useToast();

  const [cards, setCards] = useState([]);
  const [ranges, setRanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("cards"); // 'cards' | 'ranges'
  const [filter, setFilter] = useState({ card_type: "", activation_status: "" });

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    card_type: "digital",
    initial_value: "",
    issued_to_email: "",
  });
  const [createBusy, setCreateBusy] = useState(false);
  const [createResult, setCreateResult] = useState(null);

  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeForm, setRangeForm] = useState({
    prefix: "GC",
    range_start: "",
    range_end: "",
    face_value: "",
    notes: "",
  });
  const [rangeBusy, setRangeBusy] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const qs = [];
      if (filter.card_type) qs.push(`card_type=${filter.card_type}`);
      if (filter.activation_status) qs.push(`activation_status=${filter.activation_status}`);
      const cardQuery = qs.length ? `?${qs.join("&")}` : "";
      const [cardsData, rangesData] = await Promise.all([
        api.get(`/api/gift-cards${cardQuery}`),
        api.get("/api/gift-cards/ranges"),
      ]);
      setCards(cardsData.gift_cards || []);
      setRanges(rangesData.ranges || []);
    } catch (err) {
      toast.error(err.body?.error || "Failed to load gift cards");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!flagsLoading && flags.phase2g_gift_cards) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagsLoading, flags.phase2g_gift_cards, filter.card_type, filter.activation_status]);

  const createCard = async (e) => {
    e.preventDefault();
    const val = Number(createForm.initial_value);
    if (!Number.isFinite(val) || val <= 0) {
      toast.error("Initial value must be greater than 0");
      return;
    }
    setCreateBusy(true);
    setCreateResult(null);
    try {
      const res = await api.post("/api/gift-cards", {
        card_type: createForm.card_type,
        initial_value: val,
        issued_to_email: createForm.issued_to_email.trim() || null,
      });
      setCreateResult(res);
      await fetchAll();
      setCreateForm({ card_type: "digital", initial_value: "", issued_to_email: "" });
    } catch (err) {
      toast.error(err.body?.error || "Create failed");
    } finally {
      setCreateBusy(false);
    }
  };

  const submitRange = async (e) => {
    e.preventDefault();
    const payload = {
      prefix: rangeForm.prefix.trim(),
      range_start: Number(rangeForm.range_start),
      range_end: Number(rangeForm.range_end),
      face_value: Number(rangeForm.face_value),
      notes: rangeForm.notes.trim() || null,
    };
    if (!payload.prefix) {
      toast.error("Prefix required");
      return;
    }
    if (!Number.isInteger(payload.range_start) || !Number.isInteger(payload.range_end)) {
      toast.error("Range start/end must be integers");
      return;
    }
    if (payload.range_end < payload.range_start) {
      toast.error("Range end must be >= start");
      return;
    }
    if (!Number.isFinite(payload.face_value) || payload.face_value <= 0) {
      toast.error("Face value must be > 0");
      return;
    }
    setRangeBusy(true);
    try {
      const res = await api.post("/api/gift-cards/ranges", payload);
      toast.success(`Registered ${res.count} cards`);
      setRangeOpen(false);
      setRangeForm({ prefix: "GC", range_start: "", range_end: "", face_value: "", notes: "" });
      await fetchAll();
    } catch (err) {
      toast.error(err.body?.error || "Failed to register range");
    } finally {
      setRangeBusy(false);
    }
  };

  if (flagsLoading) {
    return (
      <PageShell title="Gift Cards">
        <SectionCard>
          <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading…</div>
        </SectionCard>
      </PageShell>
    );
  }

  if (!flags.phase2g_gift_cards) {
    return (
      <PageShell title="Gift Cards">
        <SectionCard>
          <EmptyState
            title="Gift cards are not enabled"
            body="Turn on phase2g_gift_cards in feature flags to start issuing digital or pre-printed physical gift cards."
          />
        </SectionCard>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Gift Cards"
      subtitle="Issue digital codes or register pre-printed physical card batches."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => setRangeOpen(true)}>
            <Layers size={14} className="mr-1 inline" />
            Register Range
          </Button>
          <Button tone="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} className="mr-1 inline" />
            New Card
          </Button>
        </div>
      }
    >
      <SectionCard>
        <div className="flex items-center gap-2 border-b border-(--ui-border) px-4 py-3">
          <button
            onClick={() => setTab("cards")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              tab === "cards"
                ? "bg-(--ui-primary) text-white"
                : "text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
            }`}
          >
            <Gift size={14} className="mr-1 inline" />
            Cards ({cards.length})
          </button>
          <button
            onClick={() => setTab("ranges")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              tab === "ranges"
                ? "bg-(--ui-primary) text-white"
                : "text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
            }`}
          >
            <Layers size={14} className="mr-1 inline" />
            Ranges ({ranges.length})
          </button>

          {tab === "cards" && (
            <div className="ml-auto flex items-center gap-2 text-sm">
              <select
                value={filter.card_type}
                onChange={(e) => setFilter((p) => ({ ...p, card_type: e.target.value }))}
                className="rounded-md border border-(--ui-border) bg-(--ui-surface) px-2 py-1 text-xs"
              >
                <option value="">All types</option>
                <option value="digital">Digital</option>
                <option value="physical">Physical</option>
              </select>
              <select
                value={filter.activation_status}
                onChange={(e) => setFilter((p) => ({ ...p, activation_status: e.target.value }))}
                className="rounded-md border border-(--ui-border) bg-(--ui-surface) px-2 py-1 text-xs"
              >
                <option value="">All states</option>
                <option value="active">Active</option>
                <option value="pre_printed">Pre-printed</option>
                <option value="issued">Issued</option>
                <option value="depleted">Depleted</option>
              </select>
            </div>
          )}
        </div>

        {tab === "cards" && (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-4 py-2.5 text-left">Code</th>
                  <th className="px-4 py-2.5 text-left">Type</th>
                  <th className="px-4 py-2.5 text-left">State</th>
                  <th className="px-4 py-2.5 text-right">Initial</th>
                  <th className="px-4 py-2.5 text-right">Remaining</th>
                  <th className="px-4 py-2.5 text-left">Recipient</th>
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  cards.map((c) => (
                    <tr key={c.id} className="border-t border-(--ui-border)">
                      <td className="px-4 py-2.5 font-mono text-xs tracking-wider text-(--ui-text)">
                        {c.code}
                      </td>
                      <td className="px-4 py-2.5 capitalize">{c.card_type}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={STATUS_TONE[c.activation_status] || "default"}>
                          {c.activation_status.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">{fmt(c.initial_value)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        {fmt(c.remaining_value)}
                      </td>
                      <td className="px-4 py-2.5 text-(--ui-text-muted)">
                        {c.issued_to_email || "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {loading && (
              <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading…</div>
            )}
            {!loading && cards.length === 0 && (
              <EmptyState
                title="No gift cards yet"
                body="Click New Card to issue a digital gift, or Register Range to import a pre-printed batch."
              />
            )}
          </div>
        )}

        {tab === "ranges" && (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-4 py-2.5 text-left">Prefix</th>
                  <th className="px-4 py-2.5 text-right">Start</th>
                  <th className="px-4 py-2.5 text-right">End</th>
                  <th className="px-4 py-2.5 text-right">Count</th>
                  <th className="px-4 py-2.5 text-right">Face Value</th>
                  <th className="px-4 py-2.5 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {ranges.map((r) => (
                  <tr key={r.id} className="border-t border-(--ui-border)">
                    <td className="px-4 py-2.5 font-mono font-bold">{r.prefix}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.range_start}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.range_end}</td>
                    <td className="px-4 py-2.5 text-right">
                      {r.range_end - r.range_start + 1}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {fmt(r.face_value)}
                    </td>
                    <td className="px-4 py-2.5 text-(--ui-text-muted)">{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ranges.length === 0 && (
              <EmptyState
                title="No physical card ranges"
                body="Register a range (prefix + start/end + face value) before activating pre-printed cards at POS."
              />
            )}
          </div>
        )}
      </SectionCard>

      {/* New card modal */}
      <Modal
        open={createOpen}
        onClose={createBusy ? undefined : () => { setCreateOpen(false); setCreateResult(null); }}
        title="New Gift Card"
        size="md"
      >
        {createResult ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
              <p className="text-sm text-emerald-700 mb-2">Gift card created!</p>
              <p className="font-mono text-xl font-bold text-emerald-900 tracking-widest">
                {createResult.code}
              </p>
              <p className="text-sm text-emerald-700 mt-1">
                Balance: <strong>{fmt(createResult.initial_value)}</strong>
              </p>
            </div>
            <ModalFooter>
              <Button onClick={() => { setCreateOpen(false); setCreateResult(null); }}>
                Close
              </Button>
              <Button tone="primary" onClick={() => setCreateResult(null)}>
                Create another
              </Button>
            </ModalFooter>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={createCard}>
            <div>
              <label className="text-[10px] font-medium text-(--ui-text-muted)">Type</label>
              <select
                value={createForm.card_type}
                onChange={(e) => setCreateForm((p) => ({ ...p, card_type: e.target.value }))}
                className="w-full rounded-md border border-(--ui-border) bg-(--ui-surface) px-2 py-1.5 text-sm"
              >
                <option value="digital">Digital (auto-generated code)</option>
                <option value="physical">Physical (single)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-(--ui-text-muted)">Initial Value</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="500"
                value={createForm.initial_value}
                onChange={(e) => setCreateForm((p) => ({ ...p, initial_value: e.target.value }))}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-(--ui-text-muted)">Recipient email (optional)</label>
              <Input
                type="email"
                placeholder="customer@example.com"
                value={createForm.issued_to_email}
                onChange={(e) => setCreateForm((p) => ({ ...p, issued_to_email: e.target.value }))}
              />
            </div>
            <ModalFooter>
              <Button type="button" onClick={() => setCreateOpen(false)} disabled={createBusy}>
                Cancel
              </Button>
              <Button tone="primary" type="submit" disabled={createBusy}>
                {createBusy ? "Creating…" : "Create"}
              </Button>
            </ModalFooter>
          </form>
        )}
      </Modal>

      {/* Register range modal */}
      <Modal
        open={rangeOpen}
        onClose={rangeBusy ? undefined : () => setRangeOpen(false)}
        title="Register Physical Card Range"
        size="md"
      >
        <form className="space-y-3" onSubmit={submitRange}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium text-(--ui-text-muted)">Prefix</label>
              <Input
                value={rangeForm.prefix}
                onChange={(e) => setRangeForm((p) => ({ ...p, prefix: e.target.value }))}
                placeholder="GC"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-(--ui-text-muted)">Face Value</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={rangeForm.face_value}
                onChange={(e) => setRangeForm((p) => ({ ...p, face_value: e.target.value }))}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium text-(--ui-text-muted)">Range Start</label>
              <Input
                type="number"
                min="0"
                value={rangeForm.range_start}
                onChange={(e) => setRangeForm((p) => ({ ...p, range_start: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-(--ui-text-muted)">Range End</label>
              <Input
                type="number"
                min="0"
                value={rangeForm.range_end}
                onChange={(e) => setRangeForm((p) => ({ ...p, range_end: e.target.value }))}
                required
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-medium text-(--ui-text-muted)">Notes</label>
            <Input
              value={rangeForm.notes}
              onChange={(e) => setRangeForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="e.g. Batch from July supplier shipment"
            />
          </div>
          <p className="text-xs text-(--ui-text-muted)">
            Cards in this range will be bootstrapped to <code>gift_cards</code> rows the
            first time a POS cashier scans them (at which point they flip to{" "}
            <strong>active</strong> with the configured face value).
          </p>
          <ModalFooter>
            <Button type="button" onClick={() => setRangeOpen(false)} disabled={rangeBusy}>
              Cancel
            </Button>
            <Button tone="primary" type="submit" disabled={rangeBusy}>
              {rangeBusy ? "Registering…" : "Register Range"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </PageShell>
  );
}
