import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Input } from "../../ui/primitives";
import { fmtUtcDate, fmtUtcDateTime } from "../../utils/dates";

/**
 * V07 gym — front-desk member workspace (/members).
 *
 * The staff-side of member check-in: look up a member by card code or phone,
 * see the FULL status (plan/expiry, payment-failed flag, pack balance, unsigned
 * waiver, today's class) so the desk can act — collect a failed payment, get a
 * waiver signed — then check them in. Plus today's live check-in feed + count.
 *
 * The verdict + all the actionable flags come from the same deriveMemberStatus
 * the kiosk and portal use.
 */

const VERDICT = {
  allow: { label: "Active", cls: "bg-emerald-600" },
  warn: { label: "Attention", cls: "bg-amber-500" },
  deny: { label: "Blocked", cls: "bg-red-600" },
};

function StatusBanner({ m }) {
  const v = VERDICT[m.verdict] || VERDICT.deny;
  return (
    <div className={`rounded-xl ${v.cls} text-white px-5 py-4`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold">{m.customer?.name}</div>
          <div className="opacity-90 text-sm">{m.message}</div>
        </div>
        <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">
          {m.status_label || v.label}
        </span>
      </div>
    </div>
  );
}

export default function MembersRedesign() {
  const { success, error } = useToast();
  const [query, setQuery] = useState("");
  const [member, setMember] = useState(null);
  const [looking, setLooking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feed, setFeed] = useState({ checkins: [], count: 0 });

  const loadFeed = useCallback(async () => {
    try {
      const r = await api.get("/api/members/checkins/today");
      setFeed(r || { checkins: [], count: 0 });
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => { loadFeed(); }, [loadFeed]);

  const lookup = async () => {
    const q = query.trim();
    if (!q) return;
    setLooking(true);
    setMember(null);
    try {
      // All-digits could be a member code (8) or a phone (11) — send both and
      // let the server try member_code first, then phone.
      const digits = /^\d+$/.test(q);
      const body = digits ? { member_code: q, phone: q } : { phone: q };
      const r = await api.post("/api/members/lookup", body);
      if (r.found === false) {
        error("No member found for that code or phone.");
      } else {
        setMember(r);
      }
    } catch (e) {
      error(e.message || "Lookup failed");
    } finally {
      setLooking(false);
    }
  };

  const checkIn = async () => {
    if (!member?.customer) return;
    setChecking(true);
    try {
      const body = member.customer.member_code
        ? { member_code: member.customer.member_code }
        : { customer_id: member.customer.id };
      const r = await api.post("/api/members/check-in", body);
      success(r.class_marked ? "Checked in — class attendance marked" : "Checked in");
      setMember({ found: true, ...r });
      loadFeed();
    } catch (e) {
      error(e.message || "Check-in failed");
    } finally {
      setChecking(false);
    }
  };

  return (
    <PageShell title="Members" subtitle="Front-desk check-in & membership status">
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* ── Lookup + status ── */}
        <div className="space-y-4">
          <SectionCard>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookup()}
                placeholder="Member code or phone"
                className="flex-1"
              />
              <Button tone="primary" onClick={lookup} disabled={looking}>
                {looking ? "Looking…" : "Look up"}
              </Button>
            </div>
          </SectionCard>

          {member?.customer && (
            <SectionCard>
              <StatusBanner m={member} />

              {/* Actionable flags */}
              <div className="mt-4 space-y-2">
                {member.payment_failed && (
                  <Flag tone="amber">
                    Payment failed{member.dunning ? ` (attempt ${member.dunning.attempts})` : ""} —
                    collect before entry.
                  </Flag>
                )}
                {member.unsigned_waiver && (
                  <Flag tone="amber">Liability waiver not signed — have the member sign it.</Flag>
                )}
                {member.packages?.credits_remaining > 0 && (
                  <Flag tone="slate">
                    Class pass: <b>{member.packages.credits_remaining}</b> credit
                    {member.packages.credits_remaining === 1 ? "" : "s"} remaining
                  </Flag>
                )}
                {member.class_today && (
                  <Flag tone="slate">
                    Booked today: <b>{member.class_today.title}</b>
                    {member.class_today.already_checked_in ? " · already checked in" : ""}
                  </Flag>
                )}
              </div>

              {/* Detail grid */}
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
                <Detail k="Plan" v={member.plan_name || "—"} />
                <Detail k="Expiry" v={member.expiry_date ? fmtUtcDate(member.expiry_date) : "—"} />
                <Detail k="Member code" v={member.customer.member_code || "—"} />
                <Detail k="Phone" v={member.customer.phone || "—"} />
              </dl>

              <div className="mt-4">
                <Button
                  tone={member.verdict === "deny" ? "danger" : "primary"}
                  onClick={checkIn}
                  disabled={checking}
                  className="w-full"
                >
                  {checking ? "Recording…" : member.verdict === "deny" ? "Record check-in anyway" : "Check in"}
                </Button>
              </div>
            </SectionCard>
          )}
        </div>

        {/* ── Today's feed ── */}
        <SectionCard>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-(--ui-text)">Today</h3>
            <span className="rounded-full bg-(--ui-primary) text-white text-xs font-semibold px-2.5 py-1">
              {feed.count} check-in{feed.count === 1 ? "" : "s"}
            </span>
          </div>
          {feed.checkins.length === 0 ? (
            <p className="text-(--ui-text-muted) text-sm">No check-ins yet today.</p>
          ) : (
            <ul className="divide-y divide-(--ui-border)">
              {feed.checkins.map((c) => (
                <li key={c.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-(--ui-text)">{c.member_name}</div>
                    <div className="text-xs text-(--ui-text-muted)">
                      {fmtUtcDateTime(c.created_at)}
                      {c.class_title ? ` · ${c.class_title}` : ""}
                    </div>
                  </div>
                  <span className="text-xs text-(--ui-text-muted) capitalize">{c.status || c.method}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </PageShell>
  );
}

function Detail({ k, v }) {
  return (
    <>
      <dt className="text-(--ui-text-muted)">{k}</dt>
      <dd className="text-(--ui-text) font-medium text-right">{v}</dd>
    </>
  );
}

function Flag({ tone, children }) {
  const cls =
    tone === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-(--ui-bg) border-(--ui-border) text-(--ui-text)";
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
