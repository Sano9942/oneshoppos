# Open Questions

Things that were **not** verified, and questions only the owner can answer. Kept separate from the findings so nobody mistakes an open question for a conclusion.

---

## A — Unverified, and each is a single lookup

These block nothing but sharpen several findings. All are dashboard or CLI checks, no code.

| # | Question | Why it matters | Where to check |
|---|---|---|---|
| ~~A1~~ | ~~**Is `R2_PUBLIC_URL` set on Railway?**~~ **CLOSED 2026-07-29 — it is UNSET.** Two independent sources agree: the platform-architecture report §11 (2026-07-29) and project memory (verified 2026-07-25). **You are fail-closed on confidentiality — nothing sensitive is publicly readable.** But this promotes the other half to a confirmed defect: `field-selfies/`, `clinical/`, `consents/` and `booking-guests/` (CNIC/passport) are outside the proxy's three-prefix allowlist, so they **404**, while `utils/r2.js:71` writes those URLs into the DB and the owner UI renders them directly (`field/FieldVisitsRedesign.jsx:194-197`). **Field-rep selfies and clinical attachments are silently broken in production today.** Re-verify only if the variable is ever set — doing so un-mounts the proxy entirely and exposes every key including `backups/full-backup-*.dump` | closed |
| ~~A2~~ | ~~**Is `INTEGRATION_SECRET_KEY` set in production?**~~ **CLOSED 2026-07-29 — it IS set**, 64 chars (correct shape for a 32-byte hex key), verified against live Railway env. **The silent-plaintext fallback at `services/crypto.js:26` is not firing in production** — integration, courier and marketplace credentials are genuinely AES-256-GCM encrypted. This does **not** retire the code fix: the fallback is still a live footgun for any future environment (local, staging, a re-provisioned Railway service) where the key is absent, and it fails silently. Downgraded from "possible credential exposure" to "hardening" — see action plan. The historical-audit half is also cheaper now: any unprefixed `integration_settings` rows would predate the key being set, not be ongoing | closed |
| ~~A3~~ | ~~R2 bucket settings~~ **PARTIALLY CLOSED 2026-07-29 — the exposure half is answered, the config half is not reachable with the credentials that exist.** **No custom domain is bound to the bucket**: all 13 DNS records on the `sanopos.com` zone were enumerated via the Cloudflare API and none resolve to R2. **The Railway R2 credentials are object-scoped, not admin-scoped** — `GetBucketLifecycleConfiguration`, `GetBucketEncryption`, `GetBucketCors` and `GetBucketVersioning` all return `AccessDenied`, which is the correct least-privilege posture and also why lifecycle/TTL could not be read. Encryption needs no assertion in code: R2 encrypts at rest with AES-256 unconditionally and it cannot be disabled. **Bucket inventory (read via ListObjectsV2): 8 objects, 0.1 MiB total** — `field-selfies/` 4, `products/` 3, `company/` 1; `backups/`, `clinical/`, `consents/`, `booking-guests/` and `support/` are all **empty**. Still unknown, and needing either the dashboard or an account-scoped token with R2 admin read: whether the managed `pub-*.r2.dev` dev URL is switched on, and whether any lifecycle rule exists | partially closed |
| ~~A4~~ | ~~Do Supabase automated backups cover `tenant_*` schemas identically to `public`?~~ **CLOSED 2026-07-29 — YES, unconditionally.** All 7 retained dailies report `is_physical_backup: true` / `COMPLETED` (Management API `/database/backups`, taken ~22:04 UTC daily). A physical backup is a WAL-G snapshot of the database directory, so schema selectivity is not merely absent, it is **not expressible** — `tenant_*` is covered byte-for-byte identically to `public`. Postgres is `17.6.1.084`, well past the `15.8.1.079` physical-backup cutover; org plan confirmed `pro`. **But the same lookup falsified a claim this repo makes in two places: `pitr_enabled` is `false`.** PITR is a paid add-on and it is not on, so the real RPO is **up to 24 hours, not seconds** (`walg_enabled: true` names the tool, not the feature). Two further constraints worth holding: restore is **whole-project only** — recovering one corrupted tenant means rolling all 29 back to that snapshot — and deleting the project destroys the backups with it | closed |

~~**A1 is the highest-value hour in this entire assessment.**~~ ~~**A2 is now the highest-value remaining lookup.**~~ ~~**A3 and A4 are now the highest-value remaining lookups.**~~ **All four closed 2026-07-29** (A3 partially — see its row).

The pattern in the first two answers was worth naming: the two most alarming *possible* findings in this assessment — publicly readable backups and plaintext credentials — were both **guesses about environment state**, and both guesses were wrong in the good direction. A1 turned out to expose a real functional defect instead (broken media in the owner UI); A2 turned out to be clean, leaving only a hardening item.

**A3 and A4 broke the pattern, and in a more useful way: the guess was right, and the *documentation* was wrong.** A4's actual question came back clean — physical backups cover every tenant schema, and could not do otherwise. What it caught instead was `pitr_enabled: false` against a `CLAUDE.md` and a memory file that both asserted 7-day PITR. Nobody had guessed wrong about that; it had simply been written down once and never checked. The failure mode here is not an unverified assumption, it is a **verified-once claim that silently stopped being true** — or was never true — and that is harder to catch, because it reads as settled. Both files were corrected in the same commit as this row.

Two live consequences follow from these answers, neither of which is a code defect:

- **Nothing automatic backs up R2.** Database backups exclude object storage by design, and the in-repo `pg_dump`-to-R2 path has plainly never run in production — `backups/` holds zero objects, against a writer at `routes/admin/system.js:357` that keys on `backups/full-backup-*.dump`. Today that is close to harmless (8 objects, 0.1 MiB, and the clinical/consent prefixes are empty); it stops being harmless the first time a merchant uploads anything.
- **The recovery story is coarser than assumed.** 24-hour RPO and an all-tenants-or-nothing restore is a defensible posture at PKR 0 collected and 0 external merchants. It is worth deciding *deliberately* — enable the PITR add-on, or accept the 24 hours — rather than discovering it during an incident, having read "7-day PITR" in the project guide.

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
