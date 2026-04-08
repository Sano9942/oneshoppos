# SanoPOS User Manual

> **Version**: 1.0 | **Last Updated**: March 2026
> **App URL**: https://oneshoppos.vercel.app

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Dashboard](#2-dashboard)
3. [Point of Sale (POS)](#3-point-of-sale-pos)
4. [Cash Management](#4-cash-management)
5. [Orders](#5-orders)
6. [Customers](#6-customers)
7. [Returns & Exchanges](#7-returns--exchanges)
8. [Sales History](#8-sales-history)
9. [Products](#9-products)
10. [Categories](#10-categories)
11. [Brands](#11-brands)
12. [Taxes](#12-taxes)
13. [Attribute Sets](#13-attribute-sets)
14. [Promotions](#14-promotions)
15. [Purchase Orders](#15-purchase-orders)
16. [Stock Adjustments](#16-stock-adjustments)
17. [Stock Transfers](#17-stock-transfers)
18. [Returned Stock (Supplier Returns)](#18-returned-stock-supplier-returns)
19. [Suppliers](#19-suppliers)
20. [Expenses](#20-expenses)
21. [Approvals](#21-approvals)
22. [Reports](#22-reports)
23. [Accounting](#23-accounting)
24. [Kiosk (Employee Clock-In Terminal)](#24-kiosk-employee-clock-in-terminal)
25. [Attendance](#25-attendance)
26. [Employees](#26-employees)
27. [Outlets (Branches)](#27-outlets-branches)
28. [Company Settings](#28-company-settings)
29. [Roles & Permissions (Administrator)](#29-roles--permissions-administrator)
30. [Receipt Templates](#30-receipt-templates)
31. [Barcode Templates](#31-barcode-templates)
32. [Printer Settings](#32-printer-settings)
33. [Shopify Integration](#33-shopify-integration)
34. [Backup & Restore](#34-backup--restore)
35. [Action History (Audit Trail)](#35-action-history-audit-trail)
36. [Appendix A: Permission Levels](#appendix-a-permission-levels)
37. [Appendix B: Feature Flags](#appendix-b-feature-flags)
38. [Appendix C: Keyboard Shortcuts & Tips](#appendix-c-keyboard-shortcuts--tips)

---

## 1. Getting Started

### Logging In

1. Open the app in your browser
2. Enter your **Employee ID or Email** and your **PIN code**
3. Click **Login**

### Selecting Your Branch

After login, you'll be asked to select which branch (outlet) you're working at today. If your store has only one branch, this step is automatic.

- Choose your branch from the list
- Click **Continue**

You're now on the Dashboard and ready to start your day.

### Your First Day Checklist

Here's what a typical day looks like in SanoPOS:

1. **Log in** and select your branch
2. **Open a shift** in the POS (required before making sales)
3. **Clock in** via the Kiosk (required before checkout)
4. **Start selling** — use the POS to ring up sales
5. At end of day: **Close the shift** with cash denomination count
6. **Review** your day on the Dashboard and Reports

---

## 2. Dashboard

**Navigation**: Sidebar > Overview > Dashboard

The Dashboard is your command center. It shows you everything happening in your store at a glance.

### What You'll See

- **KPI Cards** — Today's sales total, number of transactions, average order value, and comparison to yesterday
- **Operational Readiness** — Shows if your shift is open, how many employees are clocked in, and any issues that need attention
- **Quick Actions** — Shortcuts to common tasks (Open POS, View Reports, etc.)
- **Needs Attention** — Alerts for low stock items, outlets without open shifts, and other issues
- **Sales Trends** — Chart showing sales over time
- **Top Categories** — Which product categories are selling the most
- **Low Stock Alerts** — Products that are running low and need reordering
- **Staff Today** — Who's currently clocked in, on break, or clocked out
- **Recent Sales** — The latest transactions with quick reprint access

### Auto-Refresh

The Dashboard automatically refreshes every 60 seconds. You can also click the refresh button manually to get the latest data immediately.

---

## 3. Point of Sale (POS)

**Navigation**: Sidebar > Commerce > POS (opens in a new tab)

The POS is where you ring up sales. It opens in a separate browser tab so you can keep it running all day.

### Opening a Shift

Before you can make any sales, you must open a cash shift:

1. When you first enter POS, you'll see the **Open Shift** screen
2. Enter your opening cash amount using the denomination buttons (Rs 5000, Rs 1000, Rs 500, Rs 100, Rs 50, Rs 20, Rs 10)
3. Click **Open Shift**
4. You're ready to sell

### Making a Sale

1. **Find products** — Type in the search bar or scan a barcode
2. **Add to cart** — Click a product to add it. Click again to increase quantity
3. **Adjust quantities** — Use the +/- buttons on each cart item
4. **Apply discounts** (optional):
   - Click the **Discount** button
   - Choose **Percentage (%)** or **Fixed Amount**
   - Enter the value and click **Apply**
5. **Add a note** (optional) — Click the note icon to add a transaction note
6. **Checkout**:
   - Click **Checkout**
   - Select payment method: **Cash**, **Card**, or **Split Payment**
   - For cash: enter the amount tendered to see the change due
   - For split: enter the cash portion, the remainder goes to card
   - Click **Complete Sale**
7. **Receipt** — A receipt popup appears. You can print it or close it

### Barcode Scanning

If you have a USB barcode scanner connected, simply scan any product barcode. The POS automatically detects the scan and adds the product to your cart.

### Parked Sales

Need to set a sale aside and come back to it later?

1. Add items to cart
2. Click **Park Sale**
3. The sale is saved and your cart is cleared
4. To retrieve it: click the **Parked Sales** button, find your sale, and click **Resume**

### Recent Sales

Click the **Recent Sales** panel on the right side to see your latest transactions. From here you can:

- **Reprint** any receipt
- **Email** a receipt to a customer
- **Start a Return or Exchange**

### Closing a Shift

At the end of your day:

1. Click the **Close Shift** button (or the shift indicator)
2. Count your cash using the denomination buttons (Rs 5000, Rs 1000, Rs 500, etc.)
3. The system calculates your expected cash and shows any variance
4. Click **Close Shift**
5. The shift summary is saved for your records

### Important Rules

- You **must have an open shift** to make sales
- You **must be clocked in** (via Kiosk) to complete checkout
- If your shift is closed, you'll need to open a new one to continue selling

---

## 4. Cash Management

**Navigation**: Sidebar > Commerce > Cash Management

Cash Management gives you a detailed view of your cash shifts.

### What You Can Do

- **View all shifts** — See every shift with opening/closing times, employee name, and cash totals
- **See denomination breakdowns** — View exactly what bills were counted at opening and closing
- **Track cash variance** — Compare expected cash (from sales) vs. actual cash (from counting)
- **Export to CSV** — Download shift data for your records

### Opening a Shift from Cash Management

You can also open a new shift from this page:

1. Click **Open Shift**
2. Enter your opening cash denominations
3. Click **Open**

---

## 5. Orders

**Navigation**: Sidebar > Commerce > Orders

The Orders page manages web orders (from Shopify or manual order entry).

- View all orders with status tracking
- Filter by date, status, or customer
- Process and fulfill orders

---

## 6. Customers

**Navigation**: Sidebar > Commerce > Customers

Manage your customer database.

### What You Can Do

- **Add customers** — Name, phone, email, address
- **View customer history** — See all purchases, returns, and account balance
- **Search customers** — Find by name, phone, or email
- **Customer detail panel** — Click any customer to see their full profile and transaction history
- **Store credit/wallet** — Track customer store credit balances (from returns/exchanges)

---

## 7. Returns & Exchanges

**Navigation**: Sidebar > Commerce > Returns (or from POS Recent Sales)

### Processing a Return

**From POS (easiest):**
1. Open the **Recent Sales** panel in POS
2. Find the sale you want to return
3. Click **Return/Exchange**
4. Select which items to return (all or specific items)
5. Choose refund method: **Cash** or **Store Credit**
6. Click **Process Return**

**From Returns page:**
1. Go to Returns page
2. Search for the invoice number
3. Follow the return wizard

### Processing an Exchange

1. Start a return (as above)
2. Instead of refund, select **Exchange**
3. Add the new items the customer wants
4. The system calculates the price difference:
   - If the new items cost more: customer pays the difference
   - If less: customer gets store credit for the difference
5. A new invoice is generated for the exchange

### What Gets Updated

- Stock is automatically adjusted (returned items go back into inventory)
- The original sale is marked with the return
- A return record is created for your records
- Customer wallet/store credit is updated if applicable

---

## 8. Sales History

**Navigation**: Sidebar > Commerce > Sales History

View your complete transaction history.

### Features

- **Search** by invoice number, customer name, or product
- **Filter** by date range, payment method, employee, or outlet
- **View details** — Click any sale to see the full breakdown (items, quantities, prices, discounts, payment method)
- **Reprint receipts** — Generate a receipt for any past sale
- **Export to CSV** — Download your sales data

---

## 9. Products

**Navigation**: Sidebar > Inventory > Products

This is where you manage your entire product catalog.

### Adding a Simple Product

1. Click **Add Product**
2. Fill in the details:
   - **Name** — Product name (required)
   - **SKU** — Stock Keeping Unit (unique identifier)
   - **Barcode** — For barcode scanning in POS
   - **Category** — Select from your category tree (leaf categories only)
   - **Brand** — Select or leave blank
   - **Price** — Selling price (required, must be greater than 0)
   - **Cost** — Purchase cost (for profit calculations)
   - **Stock** — Initial stock quantity
   - **Tax** — Select applicable tax rule
3. Click **Save**

### Adding a Product with Variants

For products that come in different sizes, colors, etc.:

1. Click **Add Product**
2. Fill in the base product details
3. Toggle **Has Variants** on
4. Add variants:
   - Each variant needs a name (e.g., "Red - Large"), SKU, price, and stock
   - You can add as many variants as needed
5. Click **Save**

Each variant tracks its own stock and can have its own price.

### Bulk Import via CSV

For adding many products at once:

1. Click **Import CSV**
2. Download the **CSV Template** to see the required format
3. Fill in your product data in the CSV file
4. Upload the file
5. Review the import results — the system shows which products were added and any errors

### Managing Products

- **Edit** — Click any product to modify its details
- **Delete** — Remove products you no longer sell
- **Search & Filter** — Find products by name, SKU, barcode, category, or brand
- **Stock view** — See current stock levels by outlet

---

## 10. Categories

**Navigation**: Sidebar > Inventory > Categories

Organize your products into a hierarchical category tree.

### How It Works

Categories are organized in a tree structure. For example:
- Electronics
  - Phones
  - Accessories
    - Cases
    - Chargers
- Food & Beverage
  - Snacks
  - Drinks

**Important**: Products can only be assigned to **leaf categories** (categories with no children). In the example above, you can assign products to "Phones", "Cases", "Chargers", "Snacks", or "Drinks" — but NOT to "Electronics" or "Accessories" directly.

### Managing Categories

- **Add** — Click "Add Category", enter name, and optionally select a parent category
- **Edit** — Click any category to rename it or change its parent
- **Delete** — Remove empty categories (categories with products cannot be deleted)
- **Reorder** — Drag and drop to reorganize

---

## 11. Brands

**Navigation**: Sidebar > Inventory > Brands

Manage your product brands.

- **Add brands** — Name and optional description
- **Assign to products** — When creating/editing a product, select the brand
- **Filter by brand** — Use brands to filter products and reports

---

## 12. Taxes

**Navigation**: Sidebar > Inventory > Taxes

Configure tax rules for your products.

- **Add tax rules** — Name, rate (%), and whether it's inclusive or exclusive
- **Assign to products** — Each product can have one tax rule
- **Tax is calculated automatically** at checkout in POS

---

## 13. Attribute Sets

**Navigation**: Sidebar > Inventory > Attribute Sets

Define attributes for product variants (size, color, material, etc.).

- **Create attribute sets** — e.g., "Size" with values "S, M, L, XL"
- **Use in variants** — When creating product variants, select attributes
- Helps standardize variant naming across your catalog

---

## 14. Promotions

**Navigation**: Sidebar > Inventory > Promotions

Create discounts and promotional offers.

### Promotion Types

- **Percent** — Percentage discount (e.g., 10% off)
- **Fixed** — Fixed amount discount (e.g., Rs 50 off)
- **Threshold Percent** — Percentage discount when cart exceeds a minimum amount
- **Threshold Fixed** — Fixed discount when cart exceeds a minimum amount
- **BXGY (Buy X Get Y)** — Buy a certain quantity, get items free or discounted

### Creating a Promotion

1. Click **Add Promotion**
2. Enter name and description
3. Select type (percent, fixed, threshold_percent, threshold_fixed, bxgy)
4. Set the discount value
5. Optionally set start and end dates
6. Assign to specific categories or products
7. Click **Save**

Promotions are automatically applied at checkout in POS when conditions are met.

---

## 15. Purchase Orders

**Navigation**: Sidebar > Stock Control > Purchase Orders

Order stock from your suppliers.

### Creating a Purchase Order

1. Click **Create PO**
2. Select a **supplier**
3. Add products and quantities
4. Review the total
5. Click **Save** (creates as draft) or **Submit**

### PO Workflow

1. **Draft** — PO is created but not yet sent to supplier
2. **Ordered** — PO has been sent/confirmed with supplier
3. **Received** — Create a GRN (Goods Received Note) when stock arrives
4. **Invoiced** — Attach the supplier's invoice

### Credit Limit Warning

If a supplier has a credit limit set, the system warns you (but still allows the order) when the total would exceed their limit.

---

## 16. Stock Adjustments

**Navigation**: Sidebar > Stock Control > Stock Adjustments

Manually adjust stock quantities for any reason.

### When to Use

- **Damaged goods** — Remove broken/expired items from stock
- **Stocktake** — Correct stock after a physical count
- **Theft/shrinkage** — Record missing items
- **Found items** — Add items discovered during audit

### How to Adjust

1. Click **New Adjustment**
2. Select the **outlet** (branch)
3. Select the **product**
4. Enter the **quantity** (positive to add, negative to subtract)
5. Select a **reason**
6. Click **Save**

All adjustments are recorded with date, employee, and reason for audit purposes.

---

## 17. Stock Transfers

**Navigation**: Sidebar > Stock Control > Transfers

Move stock between your branches/outlets.

### Creating a Transfer

1. Click **New Transfer**
2. Select **source outlet** (where stock is coming from)
3. Select **destination outlet** (where stock is going to)
4. Add products and quantities
5. Click **Save**

Stock is immediately deducted from the source and added to the destination.

---

## 18. Returned Stock (Supplier Returns)

**Navigation**: Sidebar > Stock Control > Returned Stock

Track goods you send back to suppliers (defective items, wrong shipments, etc.).

- Record which products are being returned and why
- Track the status of supplier returns
- Maintain a history of all returns to each supplier

---

## 19. Suppliers

**Navigation**: Sidebar > Procurement > Suppliers

Manage your supplier directory.

### Supplier Information

- **Contact details** — Name, phone, email, address
- **Payment terms** — Credit period and credit limit
- **Products** — Which products they supply
- **Transaction history** — Purchase orders and invoices

---

## 20. Expenses

**Navigation**: Sidebar > Procurement > Expenses

Record your business expenses.

### Adding an Expense

1. Click **Add Expense**
2. Enter the amount, category (Rent, Utilities, Salary, etc.), and description
3. Optionally attach a receipt/invoice image
4. Click **Save**

Expenses appear in your Accounting reports (Profit & Loss, Cash Flow).

---

## 21. Approvals

**Navigation**: Sidebar > Procurement > Approvals

Review and approve pending requests.

- **Pending** — Items waiting for your approval
- **Approved** — Previously approved items
- **Rejected** — Items you've declined

Use the filter tabs to switch between views.

---

## 22. Reports

**Navigation**: Sidebar > Insights > Reports

SanoPOS has a comprehensive reporting suite with **67 report tabs** across 8 categories.

### How to Use Reports

1. Select a **report category** from the tab bar (Sales, Customers, Inventory, etc.)
2. Select the specific **report tab** within that category
3. Use **filters** to narrow your data:
   - **Date range** — Today, yesterday, this week, this month, or custom range
   - **Outlet** — Select one or multiple outlets (checkbox popover)
   - **Category, Brand, Supplier** — Filter by product groupings
   - **Employee/Shift** — Filter by who made the sale or which shift
4. Click **Apply Filters**
5. **Export** — Click the CSV export button to download the data

### Report Categories

#### Sales Reports
- **Overview** — High-level sales summary with KPIs
- **Daily Operations** — Day-by-day sales breakdown
- **Comparative Trends** — Compare periods (this week vs. last week, etc.)
- **Sales Heatmap** — See which hours/days are busiest
- **Revenue Leaks** — Identify discounts, voids, and refunds eating into revenue
- **Product Mix** — Which products contribute most to sales
- **Item Wise / Category Wise** — Detailed sales by product or category
- **Cashier Wise** — Sales performance by employee
- **Shift Summary / Shift Sales** — Sales grouped by shift
- **Cash Flow / Cash Audit** — Cash movement and reconciliation
- **Denominations** — Cash denomination breakdown by shift
- **Session Z-Report** — End-of-day summary report

#### Customer Reports
- **Customer Details** — Full customer directory with purchase history
- **Customer Wise** — Sales breakdown by customer
- **RFM Analysis** — Recency, Frequency, Monetary segmentation
- **Customer Retention** — Track repeat customers
- **Capture Rate** — New vs. returning customer ratio

#### Inventory Reports
- **Merchandising Workspace** — Product performance overview
- **Product Performance** — Best and worst sellers
- **Sales & Stock** — Correlation between sales velocity and stock levels
- **On Hand** — Current stock levels across all outlets
- **Dead Stock** — Products not selling
- **Stock Aging** — How long products have been sitting on shelves
- **Stockout Risk** — Products about to run out
- **Replenishment** — Suggested reorder quantities

#### Operations Reports
- **Outlet Comparison** — Compare performance across branches
- **Inventory Loss** — Track shrinkage and losses
- **Wastage** — Damaged/expired goods
- **Product Movement** — Stock transfers and adjustments
- **STR (Stock Turn Ratio)** — Inventory efficiency

#### Procurement Reports
- **Total Purchases** — Spending overview
- **Supplier Wise** — Purchases by supplier
- **PO Workflow** — Purchase order status tracking

#### Finance Reports
- **Settlement Overview** — Payment method breakdown (cash, card, credit)
- **GST Output / GST Type Summary** — Tax reporting

#### HR Reports
- **Attendance** — Employee attendance records
- **Labor Performance** — Sales per employee
- **Loss Prevention** — Flagged transactions and anomalies

#### Governance Reports
- **Audit Controls** — System audit compliance
- **Discount Leakage** — Excessive or unauthorized discounts
- **Exceptions** — Unusual transactions that need review

---

## 23. Accounting

**Navigation**: Sidebar > Insights > Accounting

Financial statements for your business.

### Available Reports

- **Profit & Loss (P&L)**:
  - Gross Sales
  - Less: Discounts, Returns
  - = Net Revenue
  - Less: Cost of Goods Sold (COGS)
  - = Gross Profit
  - Less: Operating Expenses (from Expenses page)
  - = Net Profit

- **Cash Flow Statement**:
  - Inflows (from sales — cash + card)
  - Outflows (expenses, supplier payments)
  - Net Cash Flow

---

## 24. Kiosk (Employee Clock-In Terminal)

**Navigation**: Sidebar > Operations > Kiosk (opens in a new tab)

The Kiosk is a standalone screen for employee clock-in/out. It's designed to be left open on a tablet or dedicated screen at the store entrance.

### How Employees Use It

1. Enter your **4-digit PIN**
2. The system shows your name and current status
3. **Clock In** — Start your work session
4. **Start Break** — Go on lunch or other break
5. **End Break** — Return from break
6. **Clock Out** — End your work session

### Important

- Employees must be **assigned to the outlet** to use the kiosk (this happens automatically when the employee is created)
- A **shift must be open** at the outlet for kiosk to work
- Clock-in status is **required for POS checkout** — employees who haven't clocked in cannot complete sales

---

## 25. Attendance

**Navigation**: Sidebar > Operations > Attendance

View and manage employee attendance records.

### What You'll See

- **Today's attendance** — Who's clocked in, on break, or clocked out
- **Attendance history** — Past records by date range
- **Session details** — Clock-in time, break times, clock-out time, total hours worked

### Attendance Configuration

For each employee, you can configure:
- **Work hours** — Expected daily hours
- **Leave allowance** — Annual leave days
- **Overtime rules** — When overtime kicks in

---

## 26. Employees

**Navigation**: Sidebar > Setup > Employees

Manage your staff roster.

### Adding an Employee

1. Click **Add Employee**
2. Enter details:
   - **Name** (required)
   - **Email**
   - **Phone**
   - **PIN Code** — 4-digit code for login and kiosk (required)
   - **Role** — Cashier, Manager, or Administrator
   - **Salary** — Monthly, hourly, or daily rate
3. Click **Save**

The employee is automatically assigned to all active outlets and can immediately log in and use the kiosk.

### Roles

- **Cashier** — Can use POS, view sales history, process returns. Limited access to settings and reports.
- **Manager** — All Cashier permissions plus inventory management, purchase orders, suppliers, and full reports access.
- **Administrator** — Full access to everything including employee management, company settings, roles, backup/restore, and system configuration.

See [Appendix A](#appendix-a-permission-levels) for detailed permission breakdown.

---

## 27. Outlets (Branches)

**Navigation**: Sidebar > Setup > Outlets

Manage your store locations.

### Adding an Outlet

1. Click **Add Outlet**
2. Enter details:
   - **Name** — Branch name (e.g., "Main Store", "Mall Branch")
   - **Branch Code** — Short code for identification
   - **Address, Phone**
3. Click **Save**

### Multi-Outlet Operations

If you have multiple outlets:
- Each outlet has its own stock levels
- Sales are tracked per outlet
- Reports can filter by outlet or compare outlets
- Employees can be assigned to specific outlets
- Stock can be transferred between outlets

---

## 28. Company Settings

**Navigation**: Sidebar > Setup > Company Settings

Configure your business profile and system-wide settings.

### Company Profile

- **Company Name** — Your business name (appears on receipts)
- **Trading Name** — Display name
- **Logo** — Upload your logo (appears on receipts)
- **Address, Phone, Email** — Business contact information
- **Tax Registration Number** — For tax compliance

### Timezone

- Set your **IANA timezone** (e.g., "Asia/Karachi")
- This affects all date filtering in reports and dashboard

### Currency

- Set your **currency** (e.g., "PKR")
- Appears on all prices, reports, and receipts

### Dashboard Targets

- **Monthly Sales Target** — Target for the progress bar on Dashboard
- **Margin Threshold** — Minimum acceptable profit margin (below this = exception)
- **Refund Threshold** — Maximum acceptable refund rate (above this = exception)
- **Void Threshold** — Maximum acceptable void rate (above this = exception)

---

## 29. Roles & Permissions (Administrator)

**Navigation**: Sidebar > Admin > Administrator

View and manage user roles and permissions.

### Default Roles

| Role | Permissions |
|------|------------|
| Administrator | Full access to all features (`all_access`) |
| Manager | Manage inventory, orders, view reports, manage employees attendance |
| Cashier | POS access, sales history, basic returns |

### Customizing Permissions

1. Click on a role to see its current permissions
2. Toggle individual permissions on/off
3. Save changes

Available permissions include: `all_access`, `manage_inventory`, `manage_orders`, `view_reports`, `manage_employees`, `process_returns`, `manage_promotions`, and more.

---

## 30. Receipt Templates

**Navigation**: Sidebar > Setup > Receipt Templates

Customize how your receipts look.

### Template Settings

- **Header Text** — Text displayed at the top of the receipt (e.g., "Thank you for shopping with us!")
- **Footer Text** — Text at the bottom (e.g., "No refunds after 7 days")
- **Show Barcode** — Toggle barcode/QR code on receipt
- **Logo** — Your company logo (from Company Settings)

### What Appears on Receipts

- Company name and contact info
- Invoice number and date/time
- Cashier name
- Items with quantities and prices
- Subtotal, discounts, taxes
- Total and payment method
- Change due (for cash payments)
- Custom header and footer text
- Barcode (if enabled)

---

## 31. Barcode Templates

**Navigation**: Sidebar > Setup > Barcode Templates

Create and manage barcode label templates for printing.

- **Template types** — Code128, QR Code, and other formats
- **Label layout** — Size, margins, and arrangement
- **Content** — Choose what information appears on the label (product name, SKU, price, barcode)
- **Print preview** — See how labels will look before printing

---

## 32. Printer Settings

**Navigation**: Sidebar > Setup > Printer Settings

Configure your thermal receipt printer and email settings.

### Printer Configuration

- **Connection type**: USB or TCP/IP (network printer)
- **Paper width**: 80mm (standard) or 58mm (compact)
- **Test print**: Send a test receipt to verify the connection

If no hardware printer is configured, receipts open in a browser popup that you can print using your browser's print function (Ctrl+P).

### Email Settings

Configure SMTP for sending email receipts:
- **SMTP Host** — e.g., smtp.gmail.com
- **Port** — e.g., 587
- **Username** — Your email address
- **Password** — App password (for Gmail: generate at myaccount.google.com)
- **From Name** — Display name on emails
- **Test Email** — Send a test to verify configuration

Once configured, you can email receipts to customers directly from POS.

---

## 33. Shopify Integration

**Navigation**: Sidebar > Setup > Shopify Integration

Connect your Shopify online store with SanoPOS.

### What It Does

- **Import products** from Shopify into SanoPOS
- **Sync inventory** — Push stock levels from SanoPOS to Shopify
- **Pull web orders** — Download Shopify orders into SanoPOS
- **Map locations** — Connect Shopify locations to SanoPOS outlets
- **Webhook sync** — Automatic real-time order sync

### Setup

1. Enter your Shopify store URL and API credentials
2. Verify the connection
3. Map your Shopify locations to SanoPOS outlets
4. Import products
5. Set up webhooks for automatic order sync

### Important Notes

- SKU and barcode leading zeros are preserved during import
- Products can be imported by SKU only (no need to match all fields)
- Shopify product metadata is tracked to prevent data conflicts

---

## 34. Backup & Restore

**Navigation**: Sidebar > Admin > Backup & Restore

Protect your data with backups.

### Download Backup

1. Click **Download Backup**
2. A complete copy of your database is downloaded as a file
3. Store it safely (external drive, cloud storage, etc.)

**Recommendation**: Download a backup at least once a week, or before making major changes.

### Restore from Backup

1. Click **Restore from File**
2. Select a previously downloaded backup file
3. Confirm the restore
4. The system replaces the current database with the backup

**Warning**: Restoring a backup will overwrite ALL current data. Any sales, products, or changes made after the backup was taken will be lost.

---

## 35. Action History (Audit Trail)

**Navigation**: Sidebar > Admin > Action History

View a log of all actions taken in the system.

- **Who** did what
- **When** they did it
- **What** was changed (create, edit, delete)
- **Search** by action type, employee, or date range

This is useful for accountability and troubleshooting.

---

## Appendix A: Permission Levels

| Permission | Cashier | Manager | Administrator |
|------------|:-------:|:-------:|:-------------:|
| POS (make sales) | Yes | Yes | Yes |
| View Sales History | Yes | Yes | Yes |
| Process Returns | Yes | Yes | Yes |
| View Customers | Yes | Yes | Yes |
| Manage Products | No | Yes | Yes |
| Manage Categories | No | Yes | Yes |
| Manage Inventory (adjustments, transfers) | No | Yes | Yes |
| Purchase Orders | No | Yes | Yes |
| Manage Suppliers | No | Yes | Yes |
| View Reports | Limited | Yes | Yes |
| View Attendance | No | Yes | Yes |
| Manage Promotions | No | Yes | Yes |
| Manage Employees | No | No | Yes |
| Manage Outlets | No | No | Yes |
| Company Settings | No | No | Yes |
| Roles & Permissions | No | No | Yes |
| Printer Settings | No | No | Yes |
| Backup & Restore | No | No | Yes |
| Action History | No | No | Yes |

---

## Appendix B: Feature Flags

Some features are controlled by feature flags. If you don't see a feature, it may be disabled. Contact your administrator to enable:

| Feature | Flag | Description |
|---------|------|-------------|
| Company Settings page | `multi_company` | Company profile management |
| Accounting page | `accounting_core` | P&L and cash flow statements |
| Backup & Restore | `backup_restore` | Database backup and restore |
| Supplier Payables | `supplier_payables` | Supplier invoice tracking |
| CRM & Quotations | `crm_quotations` | Customer relationship management |
| Advanced HR | `advanced_hr` | Payroll and leave management |
| Context Selection | `context_selection_required` | Force branch selection after login |

---

## Appendix C: Keyboard Shortcuts & Tips

### POS Tips

- **Barcode scanner**: Just scan — the POS detects rapid keystrokes automatically
- **Quick search**: Start typing a product name in the search bar
- **Multiple payment methods**: Use Split Payment to accept both cash and card in one transaction

### General Tips

- **Browser bookmarks**: Bookmark the POS tab so you can open it quickly each morning
- **Multiple tabs**: POS and Kiosk open in separate tabs — keep them running all day
- **Receipt printing**: If you don't have a thermal printer, receipts open in a popup. Use Ctrl+P to print via your regular printer
- **Data export**: Almost every report and list can be exported to CSV for use in Excel
- **Dashboard refresh**: The dashboard auto-refreshes every 60 seconds, but you can click the refresh button anytime

### Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot checkout — employee not clocked in" | Go to the Kiosk tab and clock in with your PIN |
| "No active shift" | Open a shift in POS or Cash Management before making sales |
| Can't find a feature in the sidebar | Your role may not have permission — contact your Administrator |
| Product stock shows 0 after adding | Make sure you entered stock quantity when creating the product |
| Receipt not printing | Check Printer Settings page, or use browser print (Ctrl+P) as fallback |
| Report shows no data | Check your date range and outlet filter settings |

---

*For technical support, contact your system administrator.*
