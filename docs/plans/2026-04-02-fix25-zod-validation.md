# Fix 25: Zod Validation on Backend Routes

## Goal
Replace manual `if (!field)` validation in critical backend routes with Zod schemas. 29 POST/PUT endpoints across 5 files.

## Branch
Create: `fix/zod-validation` (from `main` after audit branch is merged)

## Setup

```bash
cd backend && npm install zod
```

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
      req.body = schema.parse(req.body);
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

Create `backend/schemas/` directory with one file per domain:

#### `backend/schemas/auth.js`
```js
const { z } = require("zod");

const LoginSchema = z.object({
  username: z.string().min(1, "username is required"),
  password: z.string().min(1, "password is required"),
  outlet_id: z.number().int().positive().optional(),
});

const KioskLoginSchema = z.object({
  pin_code: z.string().min(4).max(10),
  outlet_id: z.number().int().positive().optional(),
});

const ForgotPasswordSchema = z.object({
  username: z.string().min(1, "username is required"),
});

const ResetPasswordSchema = z.object({
  token: z.string().min(1, "token is required"),
  new_password: z.string().min(8, "Password must be at least 8 characters"),
});

const SignupSchema = z.object({
  store_name: z.string().min(1, "store_name is required"),
  owner_name: z.string().min(1, "owner_name is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4-8 digits").optional(),
  timezone: z.string().optional(),
});

module.exports = { LoginSchema, KioskLoginSchema, ForgotPasswordSchema, ResetPasswordSchema, SignupSchema };
```

#### `backend/schemas/sales.js`
```js
const { z } = require("zod");

const CartItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  price: z.number().positive(),
  quantity: z.number().int().positive(),
  variant_id: z.number().int().positive().optional().nullable(),
  discount: z.number().min(0).optional(),
  tax_rate: z.number().min(0).optional(),
});

const CreateSaleSchema = z.object({
  cartItems: z.array(CartItemSchema).min(1, "Cart cannot be empty"),
  outlet_id: z.number().int().positive("outlet_id is required"),
  employee_id: z.number().int().positive().optional(),
  customer_id: z.number().int().positive().optional().nullable(),
  payment_method: z.enum(["cash", "card", "wallet", "split"]).default("cash"),
  amount_paid: z.number().min(0).optional(),
  discount_amount: z.number().min(0).optional(),
  discount_type: z.enum(["fixed", "percentage"]).optional(),
  note: z.string().optional(),
});

const VoidSaleSchema = z.object({
  void_reason: z.string().min(1, "void_reason is required"),
});

module.exports = { CreateSaleSchema, VoidSaleSchema };
```

#### `backend/schemas/products.js`
```js
const { z } = require("zod");

const CreateProductSchema = z.object({
  name: z.string().min(1, "name is required"),
  price: z.number().positive("price must be greater than 0"),
  barcode: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  cost_price: z.number().min(0).optional().nullable(),
  category_id: z.number().int().positive().optional().nullable(),
  brand_id: z.number().int().positive().optional().nullable(),
  tax_id: z.number().int().positive().optional().nullable(),
  supplier_id: z.number().int().positive().optional().nullable(),
  stock: z.number().int().min(0).optional(),
  gst: z.number().min(0).optional(),
  unit: z.string().optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
});

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

const CreateEmployeeSchema = z.object({
  name: z.string().min(1, "name is required"),
  pin_code: z.string().regex(/^\d{4,10}$/, "PIN must be 4-10 digits"),
  role_id: z.number().int().positive(),
  email: z.string().email().optional().nullable(),
  monthly_salary: z.number().min(0).optional().nullable(),
});

const SetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1).optional(),
  pin: z.string().optional(),
  new_password: z.string().min(8, "Password must be at least 8 characters"),
});

const ChangePinSchema = z.object({
  current_pin: z.string().min(4),
  new_pin: z.string().regex(/^\d{4,10}$/, "New PIN must be 4-10 digits"),
});

module.exports = { CreateEmployeeSchema, SetPasswordSchema, ChangePasswordSchema, ChangePinSchema };
```

#### `backend/schemas/billing.js`
```js
const { z } = require("zod");

const RequestUpgradeSchema = z.object({
  plan: z.enum(["pro"]),
  cycle: z.enum(["monthly", "annual"]),
  message: z.string().optional(),
});

const CreateCheckoutSchema = z.object({
  cycle: z.enum(["monthly", "annual"]).default("monthly"),
});

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
1. `auth.js` — 8 endpoints, highest security value
2. `sales.js` — 2 endpoints, critical business logic
3. `employees.js` — 10 endpoints, sensitive data
4. `products.js` — 7 endpoints
5. `billing.js` — 2 endpoints

### Rules
- Keep existing error messages where possible — frontend may check exact strings
- Use `.optional()` for fields that existing code handles as undefined
- Use `.nullable()` for fields that can be explicitly null
- Do NOT remove try/catch — Zod handles validation, route still needs DB error handling
- Run `npx jest tests/integration/pg-batch*.test.js` after each file

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
