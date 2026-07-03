# Overall Coverage Ledger

The per-file CSV ledgers enumerate backend, frontend, and all remaining repository-visible files. Hidden/local configuration and wildcard exclusions make the ledger row count larger than the initial `rg --files` count of 1,499.

| Scope | Reviewed | Deferred | Not applicable |
|---|---:|---:|---:|
| Backend ledger | 25 | 550 | 101 |
| Frontend ledger | 38 | 528 | 28 |
| Root/docs/monitoring/other | 2 | 161 | 168 |
| Total rows | 65 | 1,239 | 297 |

“Deferred” means inventoried but not manually reviewed sufficiently for a behavioral conclusion. It is not counted as coverage. This audit therefore has strong targeted depth but does not yet meet a literal every-file substantive-review standard.

Files:

- `backend/file-coverage-ledger.csv`
- `frontend/file-coverage-ledger.csv`
- `other-file-coverage-ledger.csv`

