# Fix 25: Zod Validation on Backend Routes

## Goal
Replace manual `if (!field)` validation in critical backend routes with Zod schemas. 29 POST/PUT endpoints across 5 files.

## Branch
Create: `fix/zod-validation` (from `main` after audit branch is merged)

## Setup

```bash
cd backend && npm install zod
```

## Critical: Zod strips unknown keys by default

**`z.object().parse()` removes keys not in the schema.** This WILL break routes that pass `req.body` through to DB queries if the schema doesn't include all fields. Use `.passthrough()` on schemas where the route accesses fields beyond what's validated:

```js
// WRONG — strips unknown fields
const schema = z.object({ name: z.string() });
schema.parse({ name: "X", extra: 1 }) // → { name: "X" }  ← extra is GONE

// RIGHT — preserves unknown fields
const schema = z.object({ name: z.string() }).passthrough();
schema.parse({ name: "X", extra: 1 }) // → { name: "X", extra: 1 }
```

**Rule: use `.passthrough()` on every schema unless you've verified the route only reads the validated fields.**

## Auth route gotchas

- `POST /api/auth/login` accepts EITHER `password` OR `pin` — the schema must allow both optional with a `.refine()` check: `z.object({ username, password: optional, pin: optional }).refine(d => d.password || d.pin, ...)`
- `POST /api/auth/mt-login` has extra `tenant_slug` field
- `POST /api/auth/forgot-password` uses `username` (employee name), not email
- `POST /api/auth/reset-password` also accepts optional `store_code` for MT mode
- `POST /api/auth/signup` has `plan` field (not just the 5 fields listed) — check the actual destructuring in the route

## Implementation

### Step 1: Create `backend/middleware/validate.js`

```js
const { ZodError } = require("zod");

/**
 * Express middleware factory — validates req.body against a Zod schema.
 * Usage: app.post("/api/foo", validate(FooSchema), handler)
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body || {});
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: err.errors[0]?.message || "Validation failed",
          details: err.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}

module.exports = { validate };
```

### Step 2: Create schemas per route file

Create `backend/schemas/` directory with one file per domain.

**Before writing any schema**: read the actual route handler and list ALL fields it reads from `req.body`. The schema must include every field OR use `.passthrough()`.

#### `backend/schemas/auth.js`
```js
const { z } = require("zod");

// POST /api/auth/login — accepts password OR pin (dual auth)
const LoginSchema = z.object({
  username: z.string().min(1, "username is required"),
  password: z.string().optional(),
  pin: z.string().optional(),
  outlet_id: z.coerce.number().int().positive().optional(),
}).passthrough().refine(
  (d) => d.password || d.pin,
  { message: "password or pin is required" }
);

// POST /api/auth/mt-login — multi-tenant login
const MtLoginSchema = z.object({
  tenant_slug: z.string().min(1, "tenant_slug is required"),
  username: z.string().min(1, "username is required"),
  password: z.string().optional(),
  pin: z.string().optional(),
}).passthrough().refine(
  (d) => d.password || d.pin,
  { message: "password or pin is required" }
);

// POST /api/auth/kiosk-login
const KioskLoginSchema = z.object({
  pin: z.string().min(1, "pin is required"),
  tenant_slug: z.string().optional(),
}).passthrough();

// POST /api/auth/forgot-password
const ForgotPasswordSchema = z.object({
  username: z.string().min(1, "username is required"),
}).passthrough();

// POST /api/auth/reset-password
const ResetPasswordSchema = z.object({
  token: z.string().min(1, "token is required"),
  new_password: z.string().min(8, "Password must be at least 8 characters"),
  store_code: z.string().optional(),
}).passthrough();

// POST /api/auth/signup (self-service)
const SignupSchema = z.object({
  store_name: z.string().min(1, "store_name is required"),
  owner_name: z.string().min(1, "owner_name is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  plan: z.string().optional(),
  pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4-8 digits").optional(),
  timezone: z.string().optional(),
}).passthrough();

module.exports = { LoginSchema, MtLoginSchema, KioskLoginSchema, ForgotPasswordSchema, ResetPasswordSchema, SignupSchema };
```

#### `backend/schemas/sales.js`
```js
const { z } = require("zod");

// POST /api/sales — cartItems uses `id` (not product_id), `price` (not unit_price)
const CartItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  price: z.number().positive(),
  quantity: z.number().int().positive(),
  variant_id: z.number().int().positive().optional().nullable(),
  discount: z.number().min(0).optional(),
  tax_rate: z.number().min(0).optional(),
}).passthrough(); // preserve gst, barcode, etc. that POS sends

const CreateSaleSchema = z.object({
  cartItems: z.array(CartItemSchema).min(1, "Cart cannot be empty"),
  outlet_id: z.coerce.number().int().positive("outlet_id is required"),
  employee_id: z.coerce.number().int().positive().optional(),
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  payment_method: z.string().default("cash"),
  amount_paid: z.number().min(0).optional(),
  discount_amount: z.number().min(0).optional(),
  discount_type: z.string().optional(),
  note: z.string().optional(),
}).passthrough(); // preserve shift_id, change, split_details, etc.

// PUT /api/sales/:id/void
const VoidSaleSchema = z.object({
  void_reason: z.string().min(1, "void_reason is required"),
}).passthrough();

module.exports = { CreateSaleSchema, VoidSaleSchema };
```

#### `backend/schemas/products.js`
```js
const { z } = require("zod");

const CreateProductSchema = z.object({
  name: z.string().min(1, "name is required"),
  price: z.coerce.number().positive("price must be greater than 0"),
}).passthrough(); // many optional fields: barcode, sku, cost_price, category_id, etc.

const BulkDeleteSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "ids array is required"),
});

const BulkStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  status: z.enum(["active", "inactive"]),
});

module.exports = { CreateProductSchema, BulkDeleteSchema, BulkStatusSchema };
```

#### `backend/schemas/employees.js`
```js
const { z } = require("zod");

// POST /api/employees — pin_code is required for new employees
const CreateEmployeeSchema = z.object({
  name: z.string().min(1, "name is required"),
  pin_code: z.string().regex(/^\d{4,10}$/, "PIN must be 4-10 digits"),
  role_id: z.coerce.number().int().positive("role_id is required"),
}).passthrough(); // email, monthly_salary, etc. are optional

// PUT /api/employees/:id/set-password
const SetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
}).passthrough();

// PUT /api/employees/:id/change-password — requires current_password OR pin
const ChangePasswordSchema = z.object({
  new_password: z.string().min(8, "Password must be at least 8 characters"),
  current_password: z.string().optional(),
  pin: z.string().optional(),
}).passthrough().refine(
  (d) => d.current_password || d.pin,
  { message: "current_password or pin is required" }
);

// PUT /api/employees/:id/change-pin
const ChangePinSchema = z.object({
  current_pin: z.string().min(4, "current_pin is required"),
  new_pin: z.string().regex(/^\d{4,10}$/, "New PIN must be 4-10 digits"),
}).passthrough();

module.exports = { CreateEmployeeSchema, SetPasswordSchema, ChangePasswordSchema, ChangePinSchema };
```

#### `backend/schemas/billing.js`
```js
const { z } = require("zod");

const RequestUpgradeSchema = z.object({
  plan: z.enum(["pro"]),
  cycle: z.enum(["monthly", "annual"]),
  message: z.string().optional(),
}).passthrough();

const CreateCheckoutSchema = z.object({
  cycle: z.enum(["monthly", "annual"]).default("monthly"),
}).passthrough();

module.exports = { RequestUpgradeSchema, CreateCheckoutSchema };
```

### Step 3: Wire schemas into routes (one file at a time)

Pattern — replace manual checks:
```js
// Before
app.post("/api/sales", async (req, res) => {
  const { cartItems, outlet_id } = req.body;
  if (!cartItems || !cartItems.length) return res.status(400).json({ error: "..." });
  if (!outlet_id) return res.status(400).json({ error: "..." });
  // ...
});

// After
const { validate } = require("../middleware/validate");
const { CreateSaleSchema } = require("../schemas/sales");

app.post("/api/sales", validate(CreateSaleSchema), async (req, res) => {
  const { cartItems, outlet_id } = req.body;
  // Manual checks removed — Zod already validated
  // ...
});
```

### Migration order (one commit per file)
1. `billing.js` — 2 endpoints, lowest risk, good test of the pattern
2. `auth.js` — 8 endpoints, highest security value but complex dual-auth
3. `employees.js` — 10 endpoints, sensitive data
4. `products.js` — 7 endpoints
5. `sales.js` — 2 endpoints, critical business logic (do last — highest blast radius)

### Rules
- **ALWAYS use `.passthrough()`** unless you've audited every field the route reads
- **Use `z.coerce.number()`** for fields that may arrive as strings (form data, query params)
- Keep existing error messages — frontend checks exact strings like `"username and password (or pin) are required"`
- The validate middleware should return the FIRST error's message in the `error` field (not a generic "Validation failed") to match existing behavior
- Do NOT remove try/catch — Zod handles validation, route still needs DB error handling
- **Test after EVERY endpoint** — Zod is strict about types (e.g. `"1"` fails `z.number()`, use `z.coerce.number()`)
- Run the relevant test batch after each file change

### Verification per file
```bash
cd backend
npx jest tests/integration/pg-batch8-middleware.test.js --no-coverage --forceExit  # auth
npx jest tests/integration/pg-batch2-medium.test.js --no-coverage --forceExit     # sales
npx jest tests/integration/pg-batch1-crud.test.js --no-coverage --forceExit       # employees, products
npx jest tests/integration/pg-batch11-admin.test.js --no-coverage --forceExit     # billing (admin-side)
```

### Final verification
```bash
# All 419 tests must pass
for batch in pg-batch1-crud pg-batch2-medium pg-batch3-complex pg-batch4-reports pg-batch5-tier4 pg-batch6-shopify pg-batch7-order-service pg-batch8-middleware pg-batch9-audit-fixes pg-tenant-isolation pg-batch10-wave2 pg-batch11-admin; do
  npx jest "tests/integration/${batch}.test.js" --no-coverage --forceExit 2>&1 | grep "Tests:"
done
```
