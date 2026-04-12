# Pages — Claude Guide

- **60 `*Route.jsx` thin wrappers** — never edit these, they just import and re-export from `redesign/`
- **All active page implementations** live in `redesign/` subdirectory as `*Redesign.jsx`
- **Special non-wrapper pages** (at this level):
  - `LandingPage.jsx` — public landing page with competitive positioning, pricing, login
  - `SignupPage.jsx` — public self-service signup (`/signup`)
  - `ResetPassword.jsx` — public password reset (`/reset-password?token=xxx&tenant=slug`)
  - `ReceiptPublicPage.jsx` — public shareable receipt (`/receipt/:invoiceNumber`)
  - `Reports.jsx` — **NOT legacy** — active reports orchestrator (delegates to `pages/reports/` modules)
  - `SetupWizard.jsx`, `ContextSelect.jsx`, `AccessDenied.jsx`, `PlaceholderPage.jsx`, `CustomerDisplayPage.jsx`, `InvoiceView.jsx` — functional non-wrapper pages
  - `Accounting.jsx`, `Approvals.jsx`, `Attendance.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx` — legacy pages imported by their `*Redesign.jsx` counterparts (do not delete, do not edit directly)
- **Subdirectories**: `redesign/` (active pages), `pos/` (POS module), `admin/` (super-admin), `reports/` (report tabs), `dashboard/` (widgets), `shopify/` (integration tabs), `storefront/` (tenant storefront), `public/` (unauthenticated public pages)
