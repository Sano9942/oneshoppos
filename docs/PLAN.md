# OneShopPOS - Software Development Plan

## Project Overview

OneShopPOS is a custom Point of Sale (POS) software designed to handle daily business operations, sales tracking, and inventory management.

## 1. Core Features (Minimum Viable Product)

- [x] Product & Inventory Management (Handle ~5,000 items, track stock levels to prevent overselling)
- [x] Sales & Checkout System (Ring up sales, calculate totals)
- [x] Barcode Scanning Support (Fast checkout using standard USB barcode scanners)
- [x] Receipt Printing (Generate and print physical receipts for customers)
- [x] Single User Account (No need to separate Admin vs. Cashier roles for the MVP)

## 2. Technology Stack Options (Selected)

We will build a **Web Application** that runs perfectly natively on your Windows desktop. We will use the **Frappe Framework** as an inspiration for the design and database structure (i.e., clean tables, simple "Doctype" like data handling), but we will build it using lightweight tools so you don't have to install slow Linux virtual machines or Docker on your Windows PC!

**Selected Tech Stack:**

- **Frontend (The User Interface):** HTML, CSS, JavaScript (using React via Vite for a super fast, app-like feel). We will make it look extremely modern and premium, just like Frappe/ERPNext.
- **Backend (The Data Engine):** Node.js with Express.
- **Database:** SQLite. This is perfect! It saves all 5,000 products into a single file right on your computer, meaning it's incredibly fast, requires zero setup, and works 100% offline.

## 3. Next Steps

1. Decide on the Exact Features: What do you want the POS to do on day one?
2. Choose the Tech Stack.
3. Design the Database (Items, Users, Receipts).
4. Build the user interface (UI).
5. Code the business logic and connect the database.
