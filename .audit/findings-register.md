# Complete Findings Register

Severity was centrally calibrated from source evidence. Detailed evidence, conditions, verification, counterevidence, impact, remediation, and regression tests are in the linked domain registers.

## Backend (9)

| ID | Severity | Confidence | Title |
|---|---|---|---|
| BE-001 | High | High | Billing webhook can permanently acknowledge a partially applied payment |
| BE-002 | High | High | A failed tenant migration does not fail deployment |
| BE-003 | High | High | Checked-out tenant clients leak session `search_path` back into the shared pool |
| BE-004 | Medium | High | WhatsApp webhooks acknowledge messages that cannot be tenant-routed |
| BE-005 | Medium | High | Password-reset verification is unthrottled O(N) bcrypt work |
| BE-006 | Medium | High | Public setup status discloses administrator name and email |
| BE-007 | Medium | High | Plan caps are check-then-act and fail open |
| BE-008 | High | High | FBR jobs can be lost before reaching the durable queue |
| BE-009 | Medium | High | Token revocation checks fail open on query error |

Full evidence: `backend/findings.md`.

## Frontend and UX (10)

| ID | Severity | Confidence | Title |
|---|---|---|---|
| F-01 | High | High | Offline queue is not tenant-scoped |
| F-02 | High | High | Field offline records have no valid reconnect drain |
| F-03 | Medium | High | Receipt-logo upload stores the request URL instead of the asset URL |
| F-04 | Medium | High | Clinical document upload reports success for HTTP failures |
| F-05 | High | High | Shared dark-mode Input/Select controls are nearly unreadable |
| F-06 | Medium | High | Modal semantics and focus containment are inconsistent |
| F-07 | Medium | High | POS Escape shortcut closes only three modal states |
| F-08 | Medium | Medium-high | Direct restaurant POS route omits the primary feature gate |
| F-09 | Low | High | Breadcrumb/loading semantics omit accessible names/status announcements |
| F-10 | Low | High | API parity npm scripts point to a deleted scanner |

F-01 was recalibrated from Critical to High because exploitation requires a shared browser, tenant switch, and colliding tenant-local employee identity; the cross-tenant confidentiality/integrity impact remains serious.

Full evidence: `frontend/findings.md`.

## Deployment and reliability (5)

| ID | Severity | Confidence | Title |
|---|---|---|---|
| DR-001 | High | High | Railway health probe can pass while Postgres/workers are unavailable |
| DR-002 | Medium | High | Service lacks graceful shutdown despite pg-boss support |
| DR-003 | Medium | High | Rate limits and alert thresholds are process-local |
| DR-004 | High | High | Full backup can report success on ephemeral container storage |
| DR-005 | Medium | High | Full backup buffers unbounded memory and verification does not restore |

Full evidence: `deployment/reliability-findings.md`.

## Totals

- High: 9
- Medium: 13
- Low: 2
- Critical: 0

Dependency scanner alerts are kept in `dependency-advisories.md` and are not promoted to confirmed application findings without reachability validation.

