# OneShopPOS API and Route Reference

Last Audited: 2026-02-25

Source of truth:
- Backend APIs: `backend/index.js`
- Frontend routes: `frontend/src/App.jsx`

---

## Backend API Summary

- Total `/api/*` endpoints: 229

Top groups by first segment:
- `integrations`: 25
- `reports`: 20
- `products`: 12
- `customers`: 8
- `orders`: 8
- `hr`: 7
- `crm`: 7
- `quotations`: 7
- `purchase-orders`: 7
- `accounting`: 6

Tier 4 groups:
- `notifications`: 4
- `company-profile`: 3
- `accounting`: 6
- `hr`: 7
- `crm`: 7
- `quotations`: 7

---

## Tier 4 Backend Endpoints

### Notifications
- `GET /api/notifications`
- `GET /api/notifications/count`
- `PUT /api/notifications/:id/read`
- `PUT /api/notifications/read-all`

### Company Profile
- `GET /api/company-profile`
- `PUT /api/company-profile`
- `POST /api/company-profile/logo`

### Accounting
- `GET /api/accounting/pnl`
- `GET /api/accounting/cashflow`
- `GET /api/accounting/ap`
- `GET /api/accounting/periods`
- `POST /api/accounting/periods`
- `PUT /api/accounting/periods/:id`

### HR
- `GET /api/hr/leave`
- `POST /api/hr/leave`
- `PUT /api/hr/leave/:id/status`
- `GET /api/hr/payroll/periods`
- `POST /api/hr/payroll/periods`
- `POST /api/hr/payroll/periods/:id/generate`
- `GET /api/hr/payroll/periods/:id/lines`

### CRM and Quotations
- `GET /api/crm/leads`
- `POST /api/crm/leads`
- `PUT /api/crm/leads/:id`
- `DELETE /api/crm/leads/:id`
- `POST /api/crm/leads/:id/activities`
- `GET /api/crm/leads/:id/activities`
- `POST /api/crm/leads/:id/convert`
- `GET /api/quotations`
- `POST /api/quotations`
- `GET /api/quotations/:id`
- `PUT /api/quotations/:id`
- `PUT /api/quotations/:id/status`
- `DELETE /api/quotations/:id`
- `POST /api/quotations/:id/convert`

---

## Frontend Route Summary

- Total declared routes: 63

Tier 4 routes:
- `/accounting`
- `/crm`
- `/quotations`
- `/hr/leave`
- `/hr/payroll`
- `/company-settings`

Tier 2 placeholders still present:
- `/lookup`
- `/custom-fields`
- `/partners`
- `/shopcast`

---

## Regeneration Commands

If API or route counts change, refresh using:

```bash
# Backend endpoint extract (writes backend/_endpoint_list.txt)
# Use the local extraction script/workflow used during docs update

# Frontend route extract
node -e "const fs=require('fs');const t=fs.readFileSync('frontend/src/App.jsx','utf8');const re=/path\s*=\s*\"([^\"]+)\"/g;const s=new Set();let m;while((m=re.exec(t)))s.add(m[1]);console.log(s.size);console.log([...s].sort().join('\n'));"
```
