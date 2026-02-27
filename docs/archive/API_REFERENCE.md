# OneShopPOS API and Route Reference

Last Audited: 2026-02-27

Source of truth:
- Backend APIs: `backend/routes/registerAllRoutes.js`, `backend/routes/tier4.js`
- Frontend routes: `frontend/src/App.jsx`

---

## Backend API Groups (Highlights)

Mature groups include:
- `integrations/*`
- `reports/*`
- `products/*`
- `customers/*`
- `orders/*`
- `hr/*`
- `crm/*`
- `quotations/*`
- `accounting/*`

Tier 4 groups:
- `notifications/*`
- `company-profile/*`
- `accounting/*`
- `hr/*`
- `crm/*`
- `quotations/*`

---

## Reports API Surface (Current)

Existing reporting endpoints remain active, and the following additive endpoints are implemented:

### Profit and margin
- `GET /api/reports/profit-summary`
- `GET /api/reports/profit-by-product`
- `GET /api/reports/profit-by-outlet`
- `GET /api/reports/discount-leakage`

### Inventory health
- `GET /api/reports/dead-stock`
- `GET /api/reports/stock-aging`
- `GET /api/reports/stockout-risk`

### Exceptions
- `GET /api/reports/exceptions?type=negative_margin_sales|high_discount_orders|frequent_voids_by_employee|frequent_returns_by_product`

### Forecasting and replenishment
- `GET /api/reports/forecast-demand`
- `GET /api/reports/replenishment-smart`

### Scheduled exports and governance
- `GET /api/reports/schedules`
- `POST /api/reports/schedules`
- `PUT /api/reports/schedules/:id`
- `DELETE /api/reports/schedules/:id`
- `POST /api/reports/schedules/:id/run-now`
- `GET /api/reports/schedules/:id/runs`
- `GET /api/reports/delivery-log`
- `GET /api/reports/saved-views`
- `POST /api/reports/saved-views`
- `PUT /api/reports/saved-views/:id`
- `DELETE /api/reports/saved-views/:id`
- `GET /api/reports/governance/definitions`
- `POST /api/reports/governance/definitions`

---

## Query Contract Standardization

New report endpoints support a consistent optional query envelope:
- `date_from`, `date_to`
- `outlet_id`
- `employee_id`
- `category_id`
- `limit`, `offset`
- `sort`, `order`

---

## Feature Flags Relevant to Reports

- `reports_enhanced_filters`
- `reports_profit_layer`
- `reports_inventory_health_plus`
- `reports_exceptions`
- `reports_scheduled_exports`

---

## Frontend Route Notes

- Reports redesign wrapper remains feature-flagged (`ui_redesign_reports`)
- Existing report routes remain backward compatible

---

## Regeneration Commands

If API or route inventory changes, refresh with local extraction scripts and route scans:

```bash
# Backend endpoint inventory (project workflow)
# Frontend route inventory
node -e "const fs=require('fs');const t=fs.readFileSync('frontend/src/App.jsx','utf8');const re=/path\s*=\s*\"([^\"]+)\"/g;const s=new Set();let m;while((m=re.exec(t)))s.add(m[1]);console.log([...s].sort().join('\n'));"
```