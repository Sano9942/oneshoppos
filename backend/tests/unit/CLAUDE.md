# Unit Tests — Claude Guide

- **4 files**, Vitest with ESM imports (`import { describe, it, expect, vi }`), no DB/network
- **`middleware.test.js`** — tests `validate` (Zod), `requirePerm`, `requireAnyPerm` with mocked req/res
- **`services.test.js`** — tests `alerting.js` service (module-level state, require-cache manipulation for isolation)
- **`tz.test.js`** — tests `toUtcStart`, `toUtcEnd`, `toLocalDateStr`, `getUtcOffsetMinutes`, `isValidTz`
- **`utils.test.js`** — tests `email-templates.js` `wrapEmailHtml` and `TEMPLATES`
- **Run**: `npx vitest run backend/tests/unit/`
- **Pattern**: Pure function testing with `vi.fn()` / `vi.mock()` / `vi.spyOn()`. No supertest, no Express
