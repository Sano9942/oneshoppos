# Performance and Maintainability Report

## Build evidence

- Frontend production build passed: 3,279 modules transformed.
- Largest emitted JavaScript chunks: reports 447 KiB, `xlsx` 419.1 KiB, Recharts 412.9 KiB, main index 294.9 KiB, Endless Aisle 134.9 KiB. These are uncompressed file sizes; route splitting is present, so they are prioritization evidence rather than a confirmed user-performance defect.
- Main emitted CSS: 126.1 KiB.

## Largest active source files

| File | Lines |
|---|---:|
| `backend/migrate-pg.js` | 7,324 |
| `backend/routes/sales.js` | 2,219 |
| `frontend/src/pages/redesign/CustomersRedesign.jsx` | 2,107 |
| `backend/routes/tier4/accounting.js` | 1,806 |
| `backend/routes/products.js` | 1,796 |
| `frontend/src/pages/redesign/TreatmentPlansRedesign.jsx` | 1,591 |
| `frontend/src/pages/redesign/PurchaseOrdersRedesign.jsx` | 1,572 |
| `backend/routes/reports/sales.js` | 1,554 |
| `backend/routes/reports/inventory.js` | 1,526 |
| `frontend/src/pages/redesign/FulfillmentRedesign.jsx` | 1,526 |

Large files are not defects by themselves, but they increase review and regression risk. Refactoring should be driven by cohesive transaction/service boundaries and test seams, not line count alone.

## Maintainability/tooling findings

- Full frontend lint fails with 944 problems (825 errors, 119 warnings), spanning application and test code. This is a broken quality gate, not proof that every reported item is a product defect.
- Backend and frontend type checks pass.
- API parity scripts in both packages reference absent `tools/api-parity-audit.js`; see F-10.
- React unit output contains repeated `act(...)` warnings in POS and loyalty tests. Tests pass, but warnings can mask real async-state assertions.
- Two backend unit expectations have drifted from implementation; neither is currently classified as an application defect.

