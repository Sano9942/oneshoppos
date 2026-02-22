# OneShopPOS Project Action Plan

## Phase 1: Planning and Architecture (Completed)

- [x] Define professional roles and review process.
- [x] Finalize Database Schema (Products, Sales, Receipts).
- [x] Define API Endpoints (Backend-to-Frontend communication).
- [x] Create UI wireframe/layout plan.

## Phase 2: Foundation & Backend Setup (Completed)

- [x] Initialize Node.js/Express backend environment.
- [x] Set up SQLite database connection and table creation scripts.
- [x] Implement Product Management API (Create, Read, Update, Delete for 5,000 items).
- [x] Implement Sales/Checkout API.
- [x] **QA Review:** Test backend endpoints with mock data (Barcode scanner simulation).

## Phase 3: Frontend Development (Completed)

- [x] Initialize React (Vite) frontend environment.
- [x] Build core UI layout (Sidebar, Main Content Area).
- [x] Build Point of Sale (POS) View (Cart, Barcode Input, Total Calculation).
- [x] Build Inventory Management View.
- [x] Connect Frontend to Backend APIs.
- [x] **QA Review:** Test end-to-end functionality (Add item -> Scan in POS -> Checkout).

## Phase 4: Hardware Integration & Polish (Completed)

- [x] Implement receipt printing logic (formatting text for thermal printers).
- [x] Optimize UI for speed and responsiveness (handling 5k items quickly).
- [x] **QA Review:** Final system-wide testing.

## Phase 5: Deployment & Documentation (Completed)

- [x] Create startup script (e.g., simple `.bat` file to run everything).
- [x] Write user manual for the operator.

## Phase 6: Core Expansions (Current)

- [x] Add Cost Price and Optional GST fields to the `products` table and backend REST API.
- [x] Add Cost Price and GST input boxes to the Inventory 'Add New Item' modal.

## Phase 8: Future ERP Expansions (Planned for Tomorrow)

- [ ] **Purchase Orders & Suppliers**: Manage supply chain and inventory intake.
- [ ] **Multi-User Authentication**: Add a login screen, role-based access, and Shift Management.
- [ ] **Customer Loyalty (CRM)**: Track customer phone numbers and purchase history.
- [ ] **Advanced Payments**: Allow Credit Card, Cash, and Split Tenders at checkout.
- [ ] **Automated Backups**: Script an auto-zip of the `oneshop.db` to Google Drive at 2:00 AM.
