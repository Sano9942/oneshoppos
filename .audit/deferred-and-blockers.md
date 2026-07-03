# Deferred and Unverified Areas

## SEC-PREFLIGHT-001 — Formal Deep Security Scan capacity

- Status: deferred, resumable
- Exact blocker: the active Codex host exposes four total concurrency slots (three usable delegated-worker slots); the required formal workflow needs at least six usable slots.
- Attempted remediation: enabled native multi-agent v2 and goals, removed legacy thread configuration if present, and configured nine threads per session in the user Codex configuration. The restarted host continued to report a four-slot runtime cap.
- Preserved scan: Codex Security scan `a79eb9dd-1ef7-4184-b344-e0d700203976`, phase `preflight`, status `running`.
- Consequence: no weaker security workflow will be represented as the requested formal deep scan. Other audit phases continue independently.

## DB-PREFLIGHT-001 — Disposable local PostgreSQL unavailable

- Status: deferred pending local PostgreSQL capability
- Evidence: `psql` command unavailable, Docker command unavailable, and no listener found on localhost port 5432.
- Consequence: database-mutating integration scenarios cannot run locally. Static query/schema analysis and non-DB checks may continue.

