# Open Questions

Things that were **not** verified, and questions only the owner can answer. Kept separate from the findings so nobody mistakes an open question for a conclusion.

---

## A — Unverified, and each is a single lookup

These block nothing but sharpen several findings. All are dashboard or CLI checks, no code.

| # | Question | Why it matters | Where to check |
|---|---|---|---|
| ~~A1~~ | ~~**Is `R2_PUBLIC_URL` set on Railway?**~~ **CLOSED 2026-07-29 — it is UNSET.** Two independent sources agree: the platform-architecture report §11 (2026-07-29) and project memory (verified 2026-07-25). **You are fail-closed on confidentiality — nothing sensitive is publicly readable.** But this promotes the other half to a confirmed defect: `field-selfies/`, `clinical/`, `consents/` and `booking-guests/` (CNIC/passport) are outside the proxy's three-prefix allowlist, so they **404**, while `utils/r2.js:71` writes those URLs into the DB and the owner UI renders them directly (`field/FieldVisitsRedesign.jsx:194-197`). **Field-rep selfies and clinical attachments are silently broken in production today.** Re-verify only if the variable is ever set — doing so un-mounts the proxy entirely and exposes every key including `backups/full-backup-*.dump` | closed |
| ~~A2~~ | ~~**Is `INTEGRATION_SECRET_KEY` set in production?**~~ **CLOSED 2026-07-29 — it IS set**, 64 chars (correct shape for a 32-byte hex key), verified against live Railway env. **The silent-plaintext fallback at `services/crypto.js:26` is not firing in production** — integration, courier and marketplace credentials are genuinely AES-256-GCM encrypted. This does **not** retire the code fix: the fallback is still a live footgun for any future environment (local, staging, a re-provisioned Railway service) where the key is absent, and it fails silently. Downgraded from "possible credential exposure" to "hardening" — see action plan. The historical-audit half is also cheaper now: any unprefixed `integration_settings` rows would predate the key being set, not be ongoing | closed |
| **A3** | R2 bucket settings — public-access mode, server-side encryption, lifecycle/TTL rules | Backups and clinical media live there. Nothing in code asserts encryption; nothing expires | Cloudflare dashboard |
| **A4** | Do Supabase automated backups cover `tenant_*` schemas identically to `public`? | It is the **only** functioning automated backup — the in-repo backup job never runs in production (`boot/workers.js:159-161` gates it behind `!DATABASE_URL`) | Supabase dashboard |

~~**A1 is the highest-value hour in this entire assessment.**~~ ~~**A2 is now the highest-value remaining lookup.**~~ **Both closed 2026-07-29, both favourably.**

The pattern in both answers is worth naming: the two most alarming *possible* findings in this assessment — publicly readable backups and plaintext credentials — were both **guesses about environment state**, and both guesses were wrong in the good direction. A1 turned out to expose a real functional defect instead (broken media in the owner UI); A2 turned out to be clean, leaving only a hardening item. **A3 and A4 are now the highest-value remaining lookups** — and unlike A1/A2 they concern *backups*, where a wrong assumption is unrecoverable rather than merely embarrassing. A4 especially: Supabase's automated backup is the only functioning one, since the in-repo backup job never runs in production.

---

## B — Scope not covered by this engagement

Stated so nobody assumes silence means clean:

- **Load and concurrency behaviour.** Nothing was load-tested, by this engagement or the previous one. Every concurrency defence — `FOR UPDATE` gates, advisory locks, the GiST exclusion constraint (which may silently not exist), the two-phase credit gate — is *reasoned* correct and never *demonstrated* correct. With eight competing stock writers, this is the largest untested surface in the system.
- **Domain-rule accuracy against Pakistani tax and labour regulation.** Business logic was assessed for structural correctness only. Whether the FBR payloads, tax cascades or attendance rules are *legally* right was not assessed and would need a domain expert.
- **The vision/invoice-photo AI path** (`services/ai.js`). Only `routes/insights-ai.js` was checked for PII leakage (it sends aggregates only — clean). The image path was not.
- **Full FK-cascade audit** across the ~50 tables referencing `customers(id)`. Sampled only; the soft-delete-only finding makes cascade behaviour largely moot for the live path.
- **Penetration testing.** No active exploitation was attempted against anything.

---

## C — Questions for the owner

These are the ones that change what happens next. Nobody else can answer them.

1. **Which single merchant could you call this week?** Someone who already knows and trusts you. A name, not a category.
2. **What specifically are you afraid they'll say?** *(Asked during the engagement; not yet answered.)* This is usually the real backlog, and it is almost never the same as the audit's list.
3. **What does "free" mean for the design partner, and for how long?** Decide before the call, not during it.
4. **What would make you abandon this?** Worth writing down now, while it is abstract. A pre-committed stop condition is much easier to evaluate honestly than one invented in the moment.
5. **Is there any second pair of hands available at all** — a co-founder, a contractor for a few hours a week, even someone to hold credentials? Bus factor is 1 with every production secret in one gitignored file on one machine. This is the largest *business* risk in the assessment and the only one with no technical mitigation.

---

## D — Things that would change the plan if they turned out otherwise

Recorded so a future session can spot a changed premise rather than re-deriving from scratch:

- **If a real merchant signs up and transacts** → the four P0s stop being pre-launch cleanup and become live incidents. The zero-blast-radius argument in `01-assessment.md` expires the day the first real sale is rung.
- **If capacity changes to full-time** → the D1 sequencing decision could be revisited; at 40 hrs/week the fix-first path becomes ~6 months rather than ~2 years.
- **If the owner reverses D2 and agrees to narrow scope** → the remediation timeline drops by roughly two thirds, and ADR-002 already describes exactly how to do it without deleting any code.
- **If a UK/EU customer appears before the field-rep rebuild** → stop. See D7 in `02-decisions-and-rationale.md`.
