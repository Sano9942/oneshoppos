# Documentation Drift Appendix

Documentation was used only for navigation. These discrepancies were independently verified against the current tree.

| Documented claim | Actual evidence | Classification |
|---|---|---|
| Root `AGENTS.md` points to `backend/AGENTS.md` and `frontend/AGENTS.md`. | Neither file exists; the tree uses directory-scoped `CLAUDE.md` files. | Navigation drift |
| `backend/schema-pg.sql` has 271 tables. | Static extraction found 288 unique table names and 289 `CREATE TABLE` statements. | Inventory drift |
| Migration runner is v1-v84. | 94 unique migrations span v1-v98, with intentional gaps 40-43. | Version drift |
| `backend/index.js` is 319 lines. | Current file is 330 lines. | Size drift |
| `registerAllRoutes.js` is 674 lines. | Current file is 696 lines. | Size drift |
| AI insights are described as “Codex AI chat.” | Implementation directly uses `@anthropic-ai/sdk` and `ANTHROPIC_API_KEY` (`insights-ai.js:22,90-91`). | Product/provider naming drift |

The working tree already contains a large, pre-existing documentation refresh. This audit did not modify or validate those edits wholesale and did not run `/audit-docs`.

