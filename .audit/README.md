# SanoPOS Evidence-Based Audit

Started: 2026-07-03 (Asia/Karachi)

Scope: full repository, safe local runtime checks, and read-only production/deployment verification.

Baseline commit: `04851540b9c2f1eebc19359079f8bdb9398b546d`

This directory is ignored by Git (`.gitignore:88`) and contains resumable audit evidence only. Application code and configuration are not modified by the audit.

## Current state

- Baseline captured; pre-existing working-tree changes preserved.
- Repository inventory: 1,499 files (591 frontend, 577 backend, 312 docs, 19 other).
- Local PostgreSQL preflight: `psql` unavailable, Docker unavailable, and no listener detected on port 5432.
- Node: v22.22.2; npm: 11.11.0; Python: 3.13.5.
- Formal Codex Security Deep Scan recovered but paused at capability preflight: active host exposes 3 usable worker slots; workflow requires 6.

