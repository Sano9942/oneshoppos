const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 46: Tier 4 modules");

function runSafe(sql, okMessage) {
  db.run(sql, (err) => {
    if (err && !String(err.message || "").includes("duplicate column")) {
      console.error("Migration 46 error:", err.message);
    } else if (okMessage) {
      console.log(okMessage);
    }
  });
}

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS accounting_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      closed_by INTEGER REFERENCES employees(id),
      closed_at TEXT,
      notes TEXT
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS crm_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      source TEXT,
      stage TEXT NOT NULL DEFAULT 'new',
      priority TEXT NOT NULL DEFAULT 'medium',
      expected_value REAL DEFAULT 0,
      assigned_to INTEGER REFERENCES employees(id),
      customer_id INTEGER REFERENCES customers(id),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS crm_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
      employee_id INTEGER REFERENCES employees(id),
      type TEXT DEFAULT 'note',
      description TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS quotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_number TEXT UNIQUE,
      lead_id INTEGER REFERENCES crm_leads(id),
      customer_id INTEGER REFERENCES customers(id),
      outlet_id INTEGER REFERENCES outlets(id),
      employee_id INTEGER REFERENCES employees(id),
      status TEXT NOT NULL DEFAULT 'draft',
      discount_type TEXT DEFAULT 'fixed',
      discount_amount REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      tax_total REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      valid_until TEXT,
      notes TEXT,
      converted_sale_id INTEGER REFERENCES sales(id),
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS quotation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      quantity REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      line_total REAL DEFAULT 0
    )`
  );

  runSafe(
    "ALTER TABLE employees ADD COLUMN salary_type TEXT DEFAULT 'monthly'",
    "employees.salary_type ready"
  );
  runSafe(
    "ALTER TABLE employees ADD COLUMN hourly_rate REAL DEFAULT 0",
    "employees.hourly_rate ready"
  );
  runSafe(
    "ALTER TABLE employees ADD COLUMN monthly_salary REAL DEFAULT 0",
    "employees.monthly_salary ready"
  );
  runSafe(
    "ALTER TABLE employees ADD COLUMN daily_rate REAL DEFAULT 0",
    "employees.daily_rate ready"
  );
  runSafe(
    "ALTER TABLE employees ADD COLUMN joining_date TEXT",
    "employees.joining_date ready"
  );
  runSafe(
    "ALTER TABLE employees ADD COLUMN department TEXT",
    "employees.department ready"
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      type TEXT NOT NULL DEFAULT 'annual',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days REAL NOT NULL DEFAULT 1,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by INTEGER REFERENCES employees(id),
      approved_at TEXT,
      rejection_note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS payroll_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      created_by INTEGER REFERENCES employees(id),
      finalized_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS payroll_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      salary_type TEXT,
      base_rate REAL DEFAULT 0,
      total_hours REAL DEFAULT 0,
      total_days REAL DEFAULT 0,
      leave_days REAL DEFAULT 0,
      gross_pay REAL DEFAULT 0,
      deductions REAL DEFAULT 0,
      net_pay REAL DEFAULT 0,
      notes TEXT,
      UNIQUE(period_id, employee_id)
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS company_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      company_name TEXT NOT NULL DEFAULT 'My Store',
      trading_name TEXT,
      ntn TEXT,
      strn TEXT,
      address TEXT,
      city TEXT,
      country TEXT DEFAULT 'Pakistan',
      phone TEXT,
      email TEXT,
      website TEXT,
      currency_symbol TEXT DEFAULT 'PKRs',
      currency_code TEXT DEFAULT 'PKR',
      logo_url TEXT,
      fiscal_year_start TEXT DEFAULT '01-01',
      timezone TEXT DEFAULT 'Asia/Karachi',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`
  );
  db.run("INSERT OR IGNORE INTO company_profile (id) VALUES (1)");

  runSafe(
    "ALTER TABLE outlets ADD COLUMN branch_code TEXT",
    "outlets.branch_code ready"
  );
  runSafe(
    "ALTER TABLE outlets ADD COLUMN company_id INTEGER DEFAULT 1",
    "outlets.company_id ready"
  );

  db.run(
    "INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at) VALUES ('notifications', 1, 'Tier 4 notifications', datetime('now','localtime'))"
  );
  db.run(
    "INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at) VALUES ('accounting_core', 1, 'Tier 4 accounting core', datetime('now','localtime'))"
  );
  db.run(
    "INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at) VALUES ('crm_quotations', 1, 'Tier 4 CRM and quotations', datetime('now','localtime'))"
  );
  db.run(
    "INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at) VALUES ('advanced_hr', 1, 'Tier 4 advanced HR', datetime('now','localtime'))"
  );
  db.run(
    "INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at) VALUES ('multi_company', 1, 'Tier 4 company profile', datetime('now','localtime'))"
  );

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read, created_at)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage, assigned_to)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_crm_activities_lead ON crm_activities(lead_id, created_at)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status, created_at)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status, employee_id, start_date)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_payroll_lines_period ON payroll_lines(period_id, employee_id)",
    (err) => {
      if (err) {
        console.error("Migration 46 error:", err.message);
      } else {
        console.log("Migration 46 complete.");
      }
      db.close();
    }
  );
});
