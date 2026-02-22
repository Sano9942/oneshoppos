# Professional Software Engineering Process

To ensure the highest quality for OneShopPOS, we will adopt a professional software house methodology. Every phase of the project will be executed and reviewed from the perspective of specialized engineering roles.

## The Engineering Roles

### 1. The Systems Architect / Lead Planner

- **Responsibility:** Designs the overall structure of the application. Selects the technology stack, designs the database schema, and ensures the system can handle the required scale (e.g., 5,000 products).
- **Review Duties:** Approves the initial plans, database designs, and API contracts before any code is written.

### 2. The Backend Engineer (Data & Logic)

- **Responsibility:** Builds the Node.js/Express server. Writes the SQL queries for the SQLite database. Ensures fast data retrieval and safe transactions to prevent overselling.
- **Review Duties:** Reviews data integrity, checks for SQL injection vulnerabilities, and ensures APIs are returning correct HTTP status codes.

### 3. The Frontend Engineer (UI/UX)

- **Responsibility:** Builds the React interface. Ensures the POS is lightning fast, aesthetic, and intuitive for a cashier to use alongside a barcode scanner.
- **Review Duties:** Reviews UI responsiveness, error handling on the client side (e.g., item not found), and overall user experience.

### 4. The Quality Assurance (QA) Engineer

- **Responsibility:** The final gatekeeper. Tests the application continuously. Simulates edge cases (e.g., scanning multiple items rapidly, printing offline).
- **Review Duties:** Runs manual and automated tests. A task cannot be checked off the `task.md` list until the QA Engineer officially signs off.

---

## The Step-by-Step Review Protocol

For every single task on our checklist, we will strictly follow this protocol:

1. **Planning (Architect):** Define exactly what is being built in this specific step.
2. **Execution (Backend/Frontend):** Write the code to fulfill the requirements.
3. **Internal Review (Specialist):** The engineer reviews their own code for best practices and performance.
4. **QA Testing (QA Engineer):** We will actively test the new feature (e.g., using test scripts or manual verification) to find bugs.
5. **Sign-off:** Only if steps 1-4 pass without critical errors do we check the item off our `task.md` checklist and move to the next step. If an error is found, we loop back to step 2.

---

## Technical Architecture Plan

As the **Systems Architect**, here is the proposed architecture for Phase 1.

### 1. Database Schema (SQLite)

We will use three clean, simplified tables (inspired by Frappe DocTypes) to handle all pos operations locally.

#### Table: `products`

- `id` (INTEGER, Primary Key)
- `barcode` (TEXT, Unique, Indexed for fast scanning)
- `name` (TEXT)
- `price` (REAL)
- `stock` (INTEGER) - Prevents overselling.

#### Table: `sales` (The Receipts)

- `id` (INTEGER, Primary Key)
- `total_amount` (REAL)
- `payment_method` (TEXT) - e.g., 'Cash' or 'Card'
- `timestamp` (DATETIME)

#### Table: `sale_items` (Line items on the receipt)

- `id` (INTEGER, Primary Key)
- `sale_id` (INTEGER, Foreign Key referencing `sales`)
- `product_id` (INTEGER, Foreign Key referencing `products`)
- `quantity` (INTEGER)
- `price_at_sale` (REAL) - Locks in the price in case product price changes later.

### 2. API Endpoints (Backend to Frontend)

The frontend UI will communicate with the Node.js backend using these clean REST APIs:

**Inventory (Products)**

- `GET /api/products` - Load the inventory table.
- `GET /api/products/scan/:barcode` - Instant lookup when a barcode is scanned. Returns 404 if not found.
- `POST /api/products` - Add a new item.
- `PUT /api/products/:id` - Update stock/price.
- `DELETE /api/products/:id` - Remove item.

**Point of Sale (Checkout)**

- `POST /api/sales` - Submit a completed cart.
  - _System Logic:_ This API will receive the cart, automatically subtract `quantity` from the `products` table stock, and insert records into `sales` and `sale_items`. Returns the exact receipt data.

### 3. UI Wireframe & Layout Plan

Inspired by Frappe/ERPNext's clean interface, the React frontend will follow a modern dual-pane layout:

#### A. Left Sidebar (Navigation)

- **POS Terminal:** The main checkout screen.
- **Inventory:** The screen to manage the 5,000 products.
- **Sales History:** View past receipts.

#### B. Main Workspace - POS Terminal (The most critical screen)

- **Top Bar:** A large input field that is _always automatically focused_ so the user can just scan a barcode with the USB scanner without touching the mouse.
- **Left 70%:** The current Cart. Displays items scanned, quantity, unit price, and a delete button per row.
- **Right 30%:** The Checkout Panel. Shows Subtotal, Tax (if any), Total Amount. Contains a large, green "Pay & Print Receipt" button.

#### C. Main Workspace - Inventory

- A clean, searchable, tabular data grid showing the products.
- Includes buttons to "Add Item" or edit existing items easily. Uses pagination so the browser doesn't crash when loading 5,000 items.
