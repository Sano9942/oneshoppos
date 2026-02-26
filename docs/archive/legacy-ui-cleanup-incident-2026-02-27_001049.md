# Legacy UI Cleanup Incident Forensics

- Date: 2026-02-27 00:10:49 +05:00
- Scope: interrupted legacy page cleanup during redesign cutover

## 1) Forensic Checkpoint Snapshot

### git status --short
```text
 M frontend/src/App.jsx
 D frontend/src/components/AppLayout.jsx
 D frontend/src/components/AppLayoutSwitch.jsx
 M frontend/src/hooks/useFeatureFlags.js
 M frontend/src/pages/Accounting.jsx
 M frontend/src/pages/AccountingRoute.jsx
 D frontend/src/pages/ActionHistory.jsx
 M frontend/src/pages/ActionHistoryRoute.jsx
 D frontend/src/pages/Administrator.jsx
 M frontend/src/pages/AdministratorRoute.jsx
 D frontend/src/pages/AttributeSets.jsx
 M frontend/src/pages/AttributeSetsRoute.jsx
 D frontend/src/pages/BackupRestore.jsx
 M frontend/src/pages/BackupRestoreRoute.jsx
 D frontend/src/pages/Brands.jsx
 M frontend/src/pages/BrandsRoute.jsx
 D frontend/src/pages/CRM.jsx
 M frontend/src/pages/CRMRoute.jsx
 D frontend/src/pages/CashManagement.jsx
 M frontend/src/pages/CashManagementRoute.jsx
 D frontend/src/pages/Categories.jsx
 M frontend/src/pages/CategoriesRoute.jsx
 D frontend/src/pages/CompanySettings.jsx
 M frontend/src/pages/CompanySettingsRoute.jsx
 D frontend/src/pages/Customers.jsx
 M frontend/src/pages/CustomersRoute.jsx
 D frontend/src/pages/Dashboard.jsx
 M frontend/src/pages/DashboardRoute.jsx
 D frontend/src/pages/Employees.jsx
 M frontend/src/pages/EmployeesRoute.jsx
 D frontend/src/pages/Expenses.jsx
 M frontend/src/pages/ExpensesRoute.jsx
 D frontend/src/pages/HRManagement.jsx
 M frontend/src/pages/HRManagementRoute.jsx
 D frontend/src/pages/Inventory.jsx
 M frontend/src/pages/InventoryRoute.jsx
 D frontend/src/pages/Orders.jsx
 M frontend/src/pages/OrdersRoute.jsx
 D frontend/src/pages/Outlets.jsx
 M frontend/src/pages/OutletsRoute.jsx
 D frontend/src/pages/POS.jsx
 M frontend/src/pages/POSRoute.jsx
 D frontend/src/pages/Promotions.jsx
 M frontend/src/pages/PromotionsRoute.jsx
 D frontend/src/pages/PurchaseOrders.jsx
 M frontend/src/pages/PurchaseOrdersRoute.jsx
 D frontend/src/pages/Quotations.jsx
 M frontend/src/pages/QuotationsRoute.jsx
 M frontend/src/pages/Reports.jsx
 M frontend/src/pages/ReportsRoute.jsx
 D frontend/src/pages/ReturnedStock.jsx
 M frontend/src/pages/ReturnedStockRoute.jsx
 D frontend/src/pages/Returns.jsx
 M frontend/src/pages/ReturnsRoute.jsx
 D frontend/src/pages/SalesHistory.jsx
 M frontend/src/pages/SalesHistoryRoute.jsx
 M frontend/src/pages/ShopifyIntegration.jsx
 M frontend/src/pages/ShopifyIntegrationRoute.jsx
 D frontend/src/pages/StockAdjustments.jsx
 M frontend/src/pages/StockAdjustmentsRoute.jsx
 D frontend/src/pages/SupplierPayables.jsx
 M frontend/src/pages/SupplierPayablesRoute.jsx
 D frontend/src/pages/Suppliers.jsx
 M frontend/src/pages/SuppliersRoute.jsx
 D frontend/src/pages/Taxes.jsx
 M frontend/src/pages/TaxesRoute.jsx
 D frontend/src/pages/Transfers.jsx
 M frontend/src/pages/TransfersRoute.jsx
```

### git diff --name-status
```text
M	frontend/src/App.jsx
D	frontend/src/components/AppLayout.jsx
D	frontend/src/components/AppLayoutSwitch.jsx
M	frontend/src/hooks/useFeatureFlags.js
M	frontend/src/pages/AccountingRoute.jsx
D	frontend/src/pages/ActionHistory.jsx
M	frontend/src/pages/ActionHistoryRoute.jsx
D	frontend/src/pages/Administrator.jsx
M	frontend/src/pages/AdministratorRoute.jsx
D	frontend/src/pages/AttributeSets.jsx
M	frontend/src/pages/AttributeSetsRoute.jsx
D	frontend/src/pages/BackupRestore.jsx
M	frontend/src/pages/BackupRestoreRoute.jsx
D	frontend/src/pages/Brands.jsx
M	frontend/src/pages/BrandsRoute.jsx
D	frontend/src/pages/CRM.jsx
M	frontend/src/pages/CRMRoute.jsx
D	frontend/src/pages/CashManagement.jsx
M	frontend/src/pages/CashManagementRoute.jsx
D	frontend/src/pages/Categories.jsx
M	frontend/src/pages/CategoriesRoute.jsx
D	frontend/src/pages/CompanySettings.jsx
M	frontend/src/pages/CompanySettingsRoute.jsx
D	frontend/src/pages/Customers.jsx
M	frontend/src/pages/CustomersRoute.jsx
D	frontend/src/pages/Dashboard.jsx
M	frontend/src/pages/DashboardRoute.jsx
D	frontend/src/pages/Employees.jsx
M	frontend/src/pages/EmployeesRoute.jsx
D	frontend/src/pages/Expenses.jsx
M	frontend/src/pages/ExpensesRoute.jsx
D	frontend/src/pages/HRManagement.jsx
M	frontend/src/pages/HRManagementRoute.jsx
D	frontend/src/pages/Inventory.jsx
M	frontend/src/pages/InventoryRoute.jsx
D	frontend/src/pages/Orders.jsx
M	frontend/src/pages/OrdersRoute.jsx
D	frontend/src/pages/Outlets.jsx
M	frontend/src/pages/OutletsRoute.jsx
D	frontend/src/pages/POS.jsx
M	frontend/src/pages/POSRoute.jsx
D	frontend/src/pages/Promotions.jsx
M	frontend/src/pages/PromotionsRoute.jsx
D	frontend/src/pages/PurchaseOrders.jsx
M	frontend/src/pages/PurchaseOrdersRoute.jsx
D	frontend/src/pages/Quotations.jsx
M	frontend/src/pages/QuotationsRoute.jsx
M	frontend/src/pages/Reports.jsx
M	frontend/src/pages/ReportsRoute.jsx
D	frontend/src/pages/ReturnedStock.jsx
M	frontend/src/pages/ReturnedStockRoute.jsx
D	frontend/src/pages/Returns.jsx
M	frontend/src/pages/ReturnsRoute.jsx
D	frontend/src/pages/SalesHistory.jsx
M	frontend/src/pages/SalesHistoryRoute.jsx
M	frontend/src/pages/ShopifyIntegration.jsx
M	frontend/src/pages/ShopifyIntegrationRoute.jsx
D	frontend/src/pages/StockAdjustments.jsx
M	frontend/src/pages/StockAdjustmentsRoute.jsx
D	frontend/src/pages/SupplierPayables.jsx
M	frontend/src/pages/SupplierPayablesRoute.jsx
D	frontend/src/pages/Suppliers.jsx
M	frontend/src/pages/SuppliersRoute.jsx
D	frontend/src/pages/Taxes.jsx
M	frontend/src/pages/TaxesRoute.jsx
D	frontend/src/pages/Transfers.jsx
M	frontend/src/pages/TransfersRoute.jsx
```

### git diff --stat
```text
 frontend/src/App.jsx                           |    4 +-
 frontend/src/components/AppLayout.jsx          |  465 -------
 frontend/src/components/AppLayoutSwitch.jsx    |   11 -
 frontend/src/hooks/useFeatureFlags.js          |   37 -
 frontend/src/pages/AccountingRoute.jsx         |    7 +-
 frontend/src/pages/ActionHistory.jsx           |  151 --
 frontend/src/pages/ActionHistoryRoute.jsx      |    7 +-
 frontend/src/pages/Administrator.jsx           |  426 ------
 frontend/src/pages/AdministratorRoute.jsx      |    7 +-
 frontend/src/pages/AttributeSets.jsx           |  451 ------
 frontend/src/pages/AttributeSetsRoute.jsx      |    7 +-
 frontend/src/pages/BackupRestore.jsx           |  236 ----
 frontend/src/pages/BackupRestoreRoute.jsx      |    7 +-
 frontend/src/pages/Brands.jsx                  |  278 ----
 frontend/src/pages/BrandsRoute.jsx             |    7 +-
 frontend/src/pages/CRM.jsx                     |  162 ---
 frontend/src/pages/CRMRoute.jsx                |    7 +-
 frontend/src/pages/CashManagement.jsx          |  674 ---------
 frontend/src/pages/CashManagementRoute.jsx     |   11 +-
 frontend/src/pages/Categories.jsx              |  249 ----
 frontend/src/pages/CategoriesRoute.jsx         |    7 +-
 frontend/src/pages/CompanySettings.jsx         |  147 --
 frontend/src/pages/CompanySettingsRoute.jsx    |    7 +-
 frontend/src/pages/Customers.jsx               |  756 ----------
 frontend/src/pages/CustomersRoute.jsx          |    7 +-
 frontend/src/pages/Dashboard.jsx               |  540 --------
 frontend/src/pages/DashboardRoute.jsx          |    7 +-
 frontend/src/pages/Employees.jsx               |  361 -----
 frontend/src/pages/EmployeesRoute.jsx          |    7 +-
 frontend/src/pages/Expenses.jsx                |  415 ------
 frontend/src/pages/ExpensesRoute.jsx           |    7 +-
 frontend/src/pages/HRManagement.jsx            |  200 ---
 frontend/src/pages/HRManagementRoute.jsx       |    7 +-
 frontend/src/pages/Inventory.jsx               | 1717 -----------------------
 frontend/src/pages/InventoryRoute.jsx          |   12 +-
 frontend/src/pages/Orders.jsx                  |  617 ---------
 frontend/src/pages/OrdersRoute.jsx             |    7 +-
 frontend/src/pages/Outlets.jsx                 |  298 ----
 frontend/src/pages/OutletsRoute.jsx            |    7 +-
 frontend/src/pages/POS.jsx                     | 1746 ------------------------
 frontend/src/pages/POSRoute.jsx                |    7 +-
 frontend/src/pages/Promotions.jsx              |  291 ----
 frontend/src/pages/PromotionsRoute.jsx         |    7 +-
 frontend/src/pages/PurchaseOrders.jsx          |  823 -----------
 frontend/src/pages/PurchaseOrdersRoute.jsx     |    7 +-
 frontend/src/pages/Quotations.jsx              |  251 ----
 frontend/src/pages/QuotationsRoute.jsx         |    7 +-
 frontend/src/pages/Reports.jsx                 |  122 +-
 frontend/src/pages/ReportsRoute.jsx            |   13 +-
 frontend/src/pages/ReturnedStock.jsx           |  550 --------
 frontend/src/pages/ReturnedStockRoute.jsx      |    7 +-
 frontend/src/pages/Returns.jsx                 |  638 ---------
 frontend/src/pages/ReturnsRoute.jsx            |    7 +-
 frontend/src/pages/SalesHistory.jsx            |  736 ----------
 frontend/src/pages/SalesHistoryRoute.jsx       |   11 +-
 frontend/src/pages/ShopifyIntegration.jsx      |    6 +-
 frontend/src/pages/ShopifyIntegrationRoute.jsx |    7 +-
 frontend/src/pages/StockAdjustments.jsx        |  335 -----
 frontend/src/pages/StockAdjustmentsRoute.jsx   |    7 +-
 frontend/src/pages/SupplierPayables.jsx        |  361 -----
 frontend/src/pages/SupplierPayablesRoute.jsx   |    7 +-
 frontend/src/pages/Suppliers.jsx               |  373 -----
 frontend/src/pages/SuppliersRoute.jsx          |    7 +-
 frontend/src/pages/Taxes.jsx                   |  269 ----
 frontend/src/pages/TaxesRoute.jsx              |    7 +-
 frontend/src/pages/Transfers.jsx               |  428 ------
 frontend/src/pages/TransfersRoute.jsx          |    7 +-
 67 files changed, 99 insertions(+), 15268 deletions(-)
```

## 2) Interruption Timeline Context

### git reflog --date=iso -n 80
```text
cf0801a HEAD@{2026-02-26 23:07:48 +0500}: commit: version1.3stable
615713d HEAD@{2026-02-26 22:21:06 +0500}: commit: version1.2
c1061eb HEAD@{2026-02-26 20:21:03 +0500}: commit: version1.1
ddb93b7 HEAD@{2026-02-26 19:57:29 +0500}: commit: done
8054daf HEAD@{2026-02-26 19:39:01 +0500}: commit: new
48b0f5e HEAD@{2026-02-26 16:04:34 +0500}: commit: shopify updates
11ed8d7 HEAD@{2026-02-26 08:42:01 +0500}: commit: shopify almost done
e7265c6 HEAD@{2026-02-26 04:05:24 +0500}: commit: 5.1 5.4 completed
e08be2b HEAD@{2026-02-26 03:35:38 +0500}: commit: 5.1 5.4 remaining
a5083ca HEAD@{2026-02-26 03:19:26 +0500}: commit: updated tier 4
49336a1 HEAD@{2026-02-25 06:33:37 +0500}: commit: latest fixes to app
cba937b HEAD@{2026-02-25 05:41:21 +0500}: commit: latest
169d698 HEAD@{2026-02-25 04:01:35 +0500}: commit: shopify integration
f7ed6d9 HEAD@{2026-02-24 23:15:17 +0500}: commit: permision and login issue clear
483ba8c HEAD@{2026-02-24 22:01:31 +0500}: commit: codex login done
7f5ed70 HEAD@{2026-02-24 17:23:19 +0500}: commit: phase 12 done
8dd9772 HEAD@{2026-02-24 16:32:54 +0500}: commit: phase 11 done
15712c1 HEAD@{2026-02-24 15:54:40 +0500}: commit: phase 10 done
3406d11 HEAD@{2026-02-24 15:42:22 +0500}: commit: phase 7 complete
695fba4 HEAD@{2026-02-24 06:18:44 +0500}: commit: latest1
b5a20b0 HEAD@{2026-02-24 05:10:46 +0500}: commit: new app with features
08b95c2 HEAD@{2026-02-24 05:03:45 +0500}: commit: latest appwith new fixes
c00afca HEAD@{2026-02-24 03:12:05 +0500}: commit: latest app with fixes
45a7e2a HEAD@{2026-02-24 02:30:29 +0500}: commit: latest updates to app
f83e0f4 HEAD@{2026-02-23 07:30:45 +0500}: commit: updating our App
c9876f2 HEAD@{2026-02-23 05:50:07 +0500}: commit: attendence feature etc build
dc2c6a1 HEAD@{2026-02-23 05:07:34 +0500}: commit: reports completed
9c02d9f HEAD@{2026-02-23 01:18:18 +0500}: commit: feat: implement multi-outlet stock architecture
affae55 HEAD@{2026-02-22 17:52:50 +0500}: commit: docs: add xstak erp expansion roadmap and phase 1 tasks
780fb71 HEAD@{2026-02-22 17:49:04 +0500}: commit: feat: complete pos refactor with taxes, categories, advanced payments and sidebar layout
4f68378 HEAD@{2026-02-22 06:28:37 +0500}: Branch: renamed refs/heads/master to refs/heads/main
4f68378 HEAD@{2026-02-22 06:23:52 +0500}: commit (initial): Initial commit: OneShopPOS with Reports Dashboard
```

### git log --oneline --decorate --graph -n 30
```text
* cf0801a (HEAD -> main, origin/main, origin/HEAD) version1.3stable
* 615713d version1.2
* c1061eb version1.1
* ddb93b7 done
* 8054daf new
* 48b0f5e shopify updates
* 11ed8d7 shopify almost done
* e7265c6 5.1 5.4 completed
* e08be2b 5.1 5.4 remaining
* a5083ca updated tier 4
* 49336a1 latest fixes to app
* cba937b latest
* 169d698 shopify integration
* f7ed6d9 permision and login issue clear
* 483ba8c codex  login done
* 7f5ed70 phase 12 done
* 8dd9772 phase 11 done
* 15712c1 phase 10 done
* 3406d11 phase 7 complete
* 695fba4 latest1
* b5a20b0 new app with features
* 08b95c2 latest appwith new fixes
* c00afca latest app with fixes
* 45a7e2a latest updates to app
* f83e0f4 updating our App
* c9876f2 attendence feature etc build
* dc2c6a1 reports completed
* 9c02d9f feat: implement multi-outlet stock architecture
* affae55 docs: add xstak erp expansion roadmap and phase 1 tasks
* 780fb71 feat: complete pos refactor with taxes, categories, advanced payments and sidebar layout
```

## 3) Cleanup Intent vs Actual State

### deleted_candidate_pages (git diff --name-only --diff-filter=D -- frontend/src/pages)
```text
frontend/src/pages/ActionHistory.jsx
frontend/src/pages/Administrator.jsx
frontend/src/pages/AttributeSets.jsx
frontend/src/pages/BackupRestore.jsx
frontend/src/pages/Brands.jsx
frontend/src/pages/CashManagement.jsx
frontend/src/pages/Categories.jsx
frontend/src/pages/CompanySettings.jsx
frontend/src/pages/CRM.jsx
frontend/src/pages/Customers.jsx
frontend/src/pages/Dashboard.jsx
frontend/src/pages/Employees.jsx
frontend/src/pages/Expenses.jsx
frontend/src/pages/HRManagement.jsx
frontend/src/pages/Inventory.jsx
frontend/src/pages/Orders.jsx
frontend/src/pages/Outlets.jsx
frontend/src/pages/POS.jsx
frontend/src/pages/Promotions.jsx
frontend/src/pages/PurchaseOrders.jsx
frontend/src/pages/Quotations.jsx
frontend/src/pages/ReturnedStock.jsx
frontend/src/pages/Returns.jsx
frontend/src/pages/SalesHistory.jsx
frontend/src/pages/StockAdjustments.jsx
frontend/src/pages/SupplierPayables.jsx
frontend/src/pages/Suppliers.jsx
frontend/src/pages/Taxes.jsx
frontend/src/pages/Transfers.jsx
```

### retained_logic_dependencies (redesign imports via ../)
```text
frontend/src/pages/redesign\AccountingRedesign.jsx:9:import Accounting from "../Accounting";
frontend/src/pages/redesign\ReportsRedesign.jsx:10:import Reports, { ReportTabStandalone } from "../Reports";
frontend/src/pages/redesign\SalesHistoryRedesign.jsx:13:import InvoiceView from "../InvoiceView";
frontend/src/pages/redesign\ShopifyIntegrationRedesign.jsx:11:import ShopifyIntegration from "../ShopifyIntegration";
```

### Import safety check: deleted pages still imported?
```text
OK: no deleted candidate page is imported via ./<Page> or ../<Page> in frontend/src
```

### Explicit retained dependency checks
```text
frontend/src/pages/redesign/AccountingRedesign.jsx -> ../Accounting
frontend/src/pages/redesign/ReportsRedesign.jsx -> ../Reports
frontend/src/pages/redesign/SalesHistoryRedesign.jsx -> ../InvoiceView
frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx -> ../ShopifyIntegration
```

## 4) Runtime Confidence Gates

### npm run build (frontend)
```text

> frontend@0.0.0 build
> vite build

[36mvite v7.3.1 [32mbuilding client environment for production...[36m[39m
transforming...
[32m?[39m 2459 modules transformed.
rendering chunks...
computing gzip size...
[2mdist/[22m[32mindex.html                 [39m[1m[2m    0.56 kB[22m[1m[22m[2m ¦ gzip:   0.33 kB[22m
[2mdist/[22m[35massets/index-CPRGwn-v.css  [39m[1m[2m   63.97 kB[22m[1m[22m[2m ¦ gzip:  11.62 kB[22m
[2mdist/[22m[36massets/index-NSwZnWoS.js   [39m[1m[33m1,088.34 kB[39m[22m[2m ¦ gzip: 281.67 kB[22m
node.exe : [33m
At C:\Program Files\nodejs\npm.ps1:29 char:3
+   & $NODE_EXE $NPM_CLI_JS $args
+   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ([33m:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: 
https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m? built in 11.21s[39m
```

### npm run lint (frontend)
```text

> frontend@0.0.0 lint
> eslint .


D:\newprojects\oneshoppos\frontend\src\pages\redesign\AttributeSetsRedesign.jsx
  170:47  error  Unnecessary escape character: \"  no-useless-escape
  170:60  error  Unnecessary escape character: \"  no-useless-escape

D:\newprojects\oneshoppos\frontend\src\pages\redesign\BrandsRedesign.jsx
  92:39  error  Unnecessary escape character: \"  no-useless-escape
  92:52  error  Unnecessary escape character: \"  no-useless-escape

D:\newprojects\oneshoppos\frontend\src\pages\redesign\CategoriesRedesign.jsx
  92:42  error  Unnecessary escape character: \"  no-useless-escape
  92:55  error  Unnecessary escape character: \"  no-useless-escape

D:\newprojects\oneshoppos\frontend\src\pages\redesign\CustomersRedesign.jsx
  133:17  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')

D:\newprojects\oneshoppos\frontend\src\pages\redesign\DashboardRedesign.jsx
  72:5  error  Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

  70 |   useEffect(() => {
  71 |     let mounted = true;
> 72 |     setLoading(true);
     |     ^^^^^^^^^^ Avoid calling setState() directly within an effect
  73 |     Promise.all([
  74 |       fetch(`${API}/api/reports/dashboard`, { headers: authHeaders() }).then((r) => r.json()),
  75 |       fetch(`${API}/api/sales?limit=10`, { headers: authHeaders() })  react-hooks/set-state-in-effect

D:\newprojects\oneshoppos\frontend\src\pages\redesign\OrdersRedesign.jsx
  130:6  warning  React Hook useEffect has a missing dependency: 'loadOrders'. Either include it or remove the dependency array  react-hooks/exhaustive-deps
  135:7  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')

D:\newprojects\oneshoppos\frontend\src\pages\redesign\ReturnsRedesign.jsx
  74:6  warning  React Hook useCallback has a missing dependency: 'authHeaders'. Either include it or remove the dependency array  react-hooks/exhaustive-deps
  94:6  warning  React Hook useEffect has a missing dependency: 'loadBootstrap'. Either include it or remove the dependency array  react-hooks/exhaustive-deps

D:\newprojects\oneshoppos\frontend\src\pages\redesign\SalesHistoryRedesign.jsx
  166:67  error  Unnecessary escape character: \"  no-useless-escape
  166:85  error  Unnecessary escape character: \"  no-useless-escape
  174:54  error  Unnecessary escape character: \"  no-useless-escape
  174:72  error  Unnecessary escape character: \"  no-useless-escape

D:\newprojects\oneshoppos\frontend\src\pages\redesign\TaxesRedesign.jsx
  94:37  error  Unnecessary escape character: \"  no-useless-escape
  94:50  error  Unnecessary escape character: \"  no-useless-escape

? 18 problems (13 errors, 5 warnings)
  0 errors and 2 warnings potentially fixable with the `--fix` option.
```

### Manual route smoke status
- Pending manual verification in browser for: /dashboard, /inventory, /reports, /accounting, /sales-history, /integrations/shopify
- Attempted automated preview-route probe was blocked by tool policy in this session; no repo state mutation occurred.

## 5) Root Cause Assessment (Current)
1. Legacy route-surface files were bulk-deleted while some redesign wrappers still depended on selected legacy logic files.
2. Session interruption likely occurred mid-delete/mid-restore, leaving a partially applied tree.
3. Current state is compile-safe with retained logic dependencies restored and route wrappers redesign-only.

