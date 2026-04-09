# Phase 4 — New Verticals Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand SanoPOS into restaurant mode, appointment booking, and service-business workspace — all built on existing repo primitives.

**Architecture:** Extend `draft_orders` for restaurant checks, `employees`/`scheduled_shifts` for booking availability, and `quotations`/`customer_invoices`/`customer_subscriptions` for service project billing. All public surfaces reuse a shared tenant resolver extracted from storefront. DB-backed polling for v1 realtime (no websockets).

**Tech Stack:** Node.js + Express v5, PostgreSQL, React 19 + Vite 7 + Tailwind v4, Zod validation, pg-boss workers, Jest integration tests.

---

## Execution Order

| # | Task | Phase | Depends On |
|---|------|-------|------------|
| 1 | Shared foundations | All | — |
| 2 | Restaurant schema (v22) | 4A | Task 1 |
| 3 | Public tenant context extraction | All | Task 1 |
| 4 | Restaurant domain services | 4A | Task 2 |
| 5 | Restaurant backend routes | 4A | Task 4 |
| 6 | KDS backend routes | 4A | Task 4 |
| 7 | Restaurant frontend pages | 4A | Task 5, 6 |
| 8 | QR ordering public surface | 4A | Task 5, 3 |
| 9 | Restaurant integration tests | 4A | Task 5, 6 |
| 10 | Appointment schema (v23) | 4B | Task 9 done |
| 11 | Booking domain services | 4B | Task 10 |
| 12 | Booking backend routes | 4B | Task 11 |
| 13 | Public booking routes | 4B | Task 11, 3 |
| 14 | Booking frontend pages | 4B | Task 12, 13 |
| 15 | Booking integration tests | 4B | Task 12, 13 |
| 16 | Service workspace schema (v24) | 4C | Task 15 done |
| 17 | Project & contract domain services | 4C | Task 16 |
| 18 | Service workspace backend routes | 4C | Task 17 |
| 19 | Service workspace frontend pages | 4C | Task 18 |
| 20 | Service workspace integration tests | 4C | Task 18 |
| 21 | Permissions, audit, and docs update | All | Tasks 5, 12, 18 |

---

## Task 1: Shared Foundations

**Files:**
- Modify: `backend/middleware/feature-flags.js`
- Modify: `backend/routes/registerAllRoutes.js`
- Modify: `backend/middleware/permissions.js`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`
- Create: `backend/services/phase4-polling.js`

### Step 1: Add Phase 4 feature flag defaults

In `backend/middleware/feature-flags.js`, add to `DEFAULT_FEATURE_FLAGS` after the Phase 3 flags:

```javascript
// Phase 4 — New Verticals
phase4_restaurant: false,
phase4_restaurant_qr: false,
phase4_restaurant_kds: false,
phase4_restaurant_preauth: false,
phase4_appointments: false,
phase4_appointments_waitlists: false,
phase4_appointments_classes: false,
phase4_google_calendar_sync: false,
phase4_service_projects: false,
phase4_service_contracts: false,
phase4_contract_ai: false,
```

### Step 2: Add Phase 4 permission areas

In `backend/middleware/permissions.js`, add to `DEFAULT_ROLE_PERMISSIONS.Manager` array:

```javascript
"manage_restaurant",
"manage_kds",
"manage_bookings",
"manage_projects",
"manage_contracts",
```

Add PERMISSION_RULES entries:

```javascript
{
  methods: ["GET", "POST", "PUT", "DELETE"],
  path: /^\/api\/restaurant(\/|$)/,
  anyPerms: ["manage_restaurant"],
},
{
  methods: ["GET", "POST", "PUT"],
  path: /^\/api\/kds(\/|$)/,
  anyPerms: ["manage_kds"],
},
{
  methods: ["GET", "POST", "PUT", "DELETE"],
  path: /^\/api\/booking-services(\/|$)/,
  anyPerms: ["manage_bookings"],
},
{
  methods: ["GET", "POST", "PUT", "DELETE"],
  path: /^\/api\/appointments(\/|$)/,
  anyPerms: ["manage_bookings"],
},
{
  methods: ["GET", "POST", "PUT", "DELETE"],
  path: /^\/api\/projects(\/|$)/,
  anyPerms: ["manage_projects"],
},
{
  methods: ["GET", "POST", "PUT", "DELETE"],
  path: /^\/api\/contracts(\/|$)/,
  anyPerms: ["manage_contracts"],
},
```

### Step 3: Create polling helper

Create `backend/services/phase4-polling.js`:

```javascript
/**
 * Shared polling helper for Phase 4 surfaces (KDS, floor plan, booking calendar).
 * Returns rows changed since a given timestamp for a specified table.
 */

async function getChangesSince(db, table, since, outletId = null) {
  const params = [since];
  let where = "WHERE updated_at > $1";
  if (outletId) {
    params.push(outletId);
    where += ` AND outlet_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT * FROM ${table} ${where} ORDER BY updated_at ASC`,
    params
  );
  return rows;
}

module.exports = { getChangesSince };
```

### Step 4: Add route stubs to registerAllRoutes.js

In `backend/routes/registerAllRoutes.js`, after the Phase 3 route registrations, add:

```javascript
// Phase 4 — New Verticals
require("./restaurant")(app, deps);
require("./kds")(app, deps);
require("./bookings")(app, deps);
require("./public-bookings")(app, deps);
require("./projects")(app, deps);
require("./contracts")(app, deps);
```

### Step 5: Add frontend route placeholders

In `frontend/src/routes/appRoutes.jsx`, add lazy imports at top:

```javascript
const RestaurantFloorRoute = lazy(() => import("../pages/RestaurantFloorRoute"));
const RestaurantChecksRoute = lazy(() => import("../pages/RestaurantChecksRoute"));
const KDSRoute = lazy(() => import("../pages/KDSRoute"));
const KioskOrderingRoute = lazy(() => import("../pages/KioskOrderingRoute"));
const AppointmentServicesRoute = lazy(() => import("../pages/AppointmentServicesRoute"));
const AppointmentsCalendarRoute = lazy(() => import("../pages/AppointmentsCalendarRoute"));
const AppointmentsRoute = lazy(() => import("../pages/AppointmentsRoute"));
const ProjectsRoute = lazy(() => import("../pages/ProjectsRoute"));
const ContractsRoute = lazy(() => import("../pages/ContractsRoute"));
```

Add routes inside the app layout Route:

```javascript
{/* Phase 4 — Restaurant */}
<Route path="/restaurant/floor" element={perm("manage_restaurant", wrap(RestaurantFloorRoute))} />
<Route path="/restaurant/checks" element={perm("manage_restaurant", wrap(RestaurantChecksRoute))} />
<Route path="/kds" element={perm("manage_kds", wrap(KDSRoute))} />
<Route path="/kiosk" element={wrap(KioskOrderingRoute)} />

{/* Phase 4 — Appointments */}
<Route path="/appointments/services" element={perm("manage_bookings", wrap(AppointmentServicesRoute))} />
<Route path="/appointments/calendar" element={perm("manage_bookings", wrap(AppointmentsCalendarRoute))} />
<Route path="/appointments/bookings" element={perm("manage_bookings", wrap(AppointmentsRoute))} />

{/* Phase 4 — Service Workspace */}
<Route path="/projects" element={perm("manage_projects", wrap(ProjectsRoute))} />
<Route path="/contracts" element={perm("manage_contracts", wrap(ContractsRoute))} />
```

### Step 6: Add nav items

In `frontend/src/ui/nav-config.js`, add a new section:

```javascript
{
  label: "Restaurant",
  items: [
    { name: "Floor Plan", path: "/restaurant/floor", icon: LayoutGrid, requiredPerm: "manage_restaurant", requiredFlag: "phase4_restaurant" },
    { name: "Checks", path: "/restaurant/checks", icon: Receipt, requiredPerm: "manage_restaurant", requiredFlag: "phase4_restaurant" },
    { name: "KDS", path: "/kds", icon: ChefHat, requiredPerm: "manage_kds", requiredFlag: "phase4_restaurant_kds" },
  ],
},
{
  label: "Appointments",
  items: [
    { name: "Services", path: "/appointments/services", icon: Scissors, requiredPerm: "manage_bookings", requiredFlag: "phase4_appointments" },
    { name: "Calendar", path: "/appointments/calendar", icon: CalendarDays, requiredPerm: "manage_bookings", requiredFlag: "phase4_appointments" },
    { name: "Bookings", path: "/appointments/bookings", icon: CalendarCheck, requiredPerm: "manage_bookings", requiredFlag: "phase4_appointments" },
  ],
},
{
  label: "Service Work",
  items: [
    { name: "Projects", path: "/projects", icon: FolderKanban, requiredPerm: "manage_projects", requiredFlag: "phase4_service_projects" },
    { name: "Contracts", path: "/contracts", icon: FileSignature, requiredPerm: "manage_contracts", requiredFlag: "phase4_service_contracts" },
  ],
},
```

Import the lucide icons at the top of nav-config.js:

```javascript
import { LayoutGrid, Receipt, ChefHat, Scissors, CalendarDays, CalendarCheck, FolderKanban, FileSignature } from "lucide-react";
```

### Step 7: Add breadcrumb labels

In `frontend/src/ui/Breadcrumbs.jsx`, add to `LABELS`:

```javascript
restaurant: "Restaurant",
floor: "Floor Plan",
checks: "Checks",
kds: "KDS",
kiosk: "Kiosk",
appointments: "Appointments",
services: "Services",
calendar: "Calendar",
bookings: "Bookings",
projects: "Projects",
contracts: "Contracts",
```

### Step 8: Create placeholder route wrappers

Create each of these 2-line route wrapper files in `frontend/src/pages/`:

**`RestaurantFloorRoute.jsx`:**
```javascript
import RestaurantFloorRedesign from './redesign/RestaurantFloorRedesign';
export default function RestaurantFloorRoute() { return <RestaurantFloorRedesign />; }
```

**`RestaurantChecksRoute.jsx`:**
```javascript
import RestaurantChecksRedesign from './redesign/RestaurantChecksRedesign';
export default function RestaurantChecksRoute() { return <RestaurantChecksRedesign />; }
```

**`KDSRoute.jsx`:**
```javascript
import KDSRedesign from './redesign/KDSRedesign';
export default function KDSRoute() { return <KDSRedesign />; }
```

**`KioskOrderingRoute.jsx`:**
```javascript
import KioskOrderingRedesign from './redesign/KioskOrderingRedesign';
export default function KioskOrderingRoute() { return <KioskOrderingRedesign />; }
```

**`AppointmentServicesRoute.jsx`:**
```javascript
import AppointmentServicesRedesign from './redesign/AppointmentServicesRedesign';
export default function AppointmentServicesRoute() { return <AppointmentServicesRedesign />; }
```

**`AppointmentsCalendarRoute.jsx`:**
```javascript
import AppointmentsCalendarRedesign from './redesign/AppointmentsCalendarRedesign';
export default function AppointmentsCalendarRoute() { return <AppointmentsCalendarRedesign />; }
```

**`AppointmentsRoute.jsx`:**
```javascript
import AppointmentsRedesign from './redesign/AppointmentsRedesign';
export default function AppointmentsRoute() { return <AppointmentsRedesign />; }
```

**`ProjectsRoute.jsx`:**
```javascript
import ProjectsRedesign from './redesign/ProjectsRedesign';
export default function ProjectsRoute() { return <ProjectsRedesign />; }
```

**`ContractsRoute.jsx`:**
```javascript
import ContractsRedesign from './redesign/ContractsRedesign';
export default function ContractsRoute() { return <ContractsRedesign />; }
```

### Step 9: Commit

```bash
git add backend/middleware/feature-flags.js backend/middleware/permissions.js backend/services/phase4-polling.js backend/routes/registerAllRoutes.js frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js frontend/src/ui/Breadcrumbs.jsx frontend/src/pages/*Route.jsx
git commit -m "feat(phase4): add shared foundations — flags, permissions, nav, route stubs, polling helper"
```

---

## Task 2: Restaurant Schema (Migration v22)

**Files:**
- Modify: `backend/schema-pg.sql`
- Modify: `backend/migrate-pg.js`

### Step 1: Add restaurant tables to schema-pg.sql

Append after the Phase 3 tables (after `subscription_runs` indexes):

```sql
-- ═══════════════════════════════════════════════════════════════
-- Phase 4A — Restaurant Mode
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS restaurant_floor_plans (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  layout_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_floor_sections (
  id SERIAL PRIMARY KEY,
  floor_plan_id INTEGER NOT NULL REFERENCES restaurant_floor_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id SERIAL PRIMARY KEY,
  floor_plan_id INTEGER NOT NULL REFERENCES restaurant_floor_plans(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES restaurant_floor_sections(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  shape TEXT DEFAULT 'square' CHECK (shape IN ('square','round','rectangle')),
  pos_x INTEGER DEFAULT 0,
  pos_y INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_floor ON restaurant_tables(floor_plan_id);

CREATE TABLE IF NOT EXISTS restaurant_table_sessions (
  id SERIAL PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES restaurant_tables(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  server_id INTEGER REFERENCES employees(id),
  guest_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'seated' CHECK (status IN ('seated','ordering','served','check_requested','closed')),
  seated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_table ON restaurant_table_sessions(table_id) WHERE status != 'closed';
CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_outlet ON restaurant_table_sessions(outlet_id, status);

CREATE TABLE IF NOT EXISTS restaurant_check_seats (
  id SERIAL PRIMARY KEY,
  table_session_id INTEGER NOT NULL REFERENCES restaurant_table_sessions(id) ON DELETE CASCADE,
  draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_check_seats_unique ON restaurant_check_seats(table_session_id, seat_number);

CREATE TABLE IF NOT EXISTS restaurant_check_adjustments (
  id SERIAL PRIMARY KEY,
  draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('service_charge','gratuity','rounding','discount')),
  label TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_percentage BOOLEAN DEFAULT FALSE,
  percentage_value NUMERIC(6,4),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_check_adjustments_order ON restaurant_check_adjustments(draft_order_id);

CREATE TABLE IF NOT EXISTS restaurant_course_fires (
  id SERIAL PRIMARY KEY,
  draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
  course_name TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','fired','completed')),
  fired_at TIMESTAMPTZ,
  fired_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_course_fires_order ON restaurant_course_fires(draft_order_id);

CREATE TABLE IF NOT EXISTS restaurant_tabs (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_by INTEGER REFERENCES employees(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restaurant_tabs_outlet ON restaurant_tabs(outlet_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS restaurant_preauth_holds (
  id SERIAL PRIMARY KEY,
  tab_id INTEGER NOT NULL REFERENCES restaurant_tabs(id) ON DELETE CASCADE,
  gateway_ref TEXT,
  amount NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','captured','voided','expired')),
  provider TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kds_stations (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  name TEXT NOT NULL,
  station_role TEXT NOT NULL DEFAULT 'prep' CHECK (station_role IN ('prep','expo')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kds_stations_outlet ON kds_stations(outlet_id);

CREATE TABLE IF NOT EXISTS kds_station_routes (
  id SERIAL PRIMARY KEY,
  station_id INTEGER NOT NULL REFERENCES kds_stations(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id),
  match_all BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kds_tickets (
  id SERIAL PRIMARY KEY,
  station_id INTEGER NOT NULL REFERENCES kds_stations(id),
  draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id),
  table_label TEXT,
  seat_label TEXT,
  course_name TEXT DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','ready','bumped')),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kds_tickets_station_status ON kds_tickets(station_id, status);
CREATE INDEX IF NOT EXISTS idx_kds_tickets_order ON kds_tickets(draft_order_id);

CREATE TABLE IF NOT EXISTS kds_ticket_events (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','started','ready','bumped','recalled')),
  actor_id INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kds_ticket_events_ticket ON kds_ticket_events(ticket_id);
```

### Step 2: Extend draft_orders in schema-pg.sql

Add columns to the `draft_orders` CREATE TABLE definition:

```sql
-- Add after existing columns in draft_orders
ALTER TABLE draft_orders
  ADD COLUMN IF NOT EXISTS order_context TEXT DEFAULT 'retail' CHECK (order_context IN ('retail','dine_in','takeout','delivery','bar')),
  ADD COLUMN IF NOT EXISTS table_id INTEGER REFERENCES restaurant_tables(id),
  ADD COLUMN IF NOT EXISTS table_session_id INTEGER REFERENCES restaurant_table_sessions(id),
  ADD COLUMN IF NOT EXISTS tab_id INTEGER REFERENCES restaurant_tabs(id),
  ADD COLUMN IF NOT EXISTS seat_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dining_option TEXT CHECK (dining_option IN ('dine_in','takeout','delivery')),
  ADD COLUMN IF NOT EXISTS source_token_id TEXT;
```

### Step 3: Add migration v22 to migrate-pg.js

Add after the v21 migration object:

```javascript
{
  version: 22,
  description: "Phase 4A — restaurant mode: floor plans, tables, sessions, seats, tabs, coursing, KDS, draft_orders context extension",
  up: async (client) => {
    // Floor plans
    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_floor_plans (
        id SERIAL PRIMARY KEY,
        outlet_id INTEGER NOT NULL REFERENCES outlets(id),
        name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        layout_json JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_floor_sections (
        id SERIAL PRIMARY KEY,
        floor_plan_id INTEGER NOT NULL REFERENCES restaurant_floor_plans(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_tables (
        id SERIAL PRIMARY KEY,
        floor_plan_id INTEGER NOT NULL REFERENCES restaurant_floor_plans(id) ON DELETE CASCADE,
        section_id INTEGER REFERENCES restaurant_floor_sections(id) ON DELETE SET NULL,
        label TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 4,
        shape TEXT DEFAULT 'square' CHECK (shape IN ('square','round','rectangle')),
        pos_x INTEGER DEFAULT 0,
        pos_y INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_tables_floor ON restaurant_tables(floor_plan_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_table_sessions (
        id SERIAL PRIMARY KEY,
        table_id INTEGER NOT NULL REFERENCES restaurant_tables(id),
        outlet_id INTEGER NOT NULL REFERENCES outlets(id),
        server_id INTEGER REFERENCES employees(id),
        guest_count INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'seated' CHECK (status IN ('seated','ordering','served','check_requested','closed')),
        seated_at TIMESTAMPTZ DEFAULT NOW(),
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_table ON restaurant_table_sessions(table_id) WHERE status != 'closed'`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_outlet ON restaurant_table_sessions(outlet_id, status)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_check_seats (
        id SERIAL PRIMARY KEY,
        table_session_id INTEGER NOT NULL REFERENCES restaurant_table_sessions(id) ON DELETE CASCADE,
        draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
        seat_number INTEGER NOT NULL,
        label TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_check_seats_unique ON restaurant_check_seats(table_session_id, seat_number)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_check_adjustments (
        id SERIAL PRIMARY KEY,
        draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
        adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('service_charge','gratuity','rounding','discount')),
        label TEXT,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        is_percentage BOOLEAN DEFAULT FALSE,
        percentage_value NUMERIC(6,4),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_check_adjustments_order ON restaurant_check_adjustments(draft_order_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_course_fires (
        id SERIAL PRIMARY KEY,
        draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
        course_name TEXT NOT NULL DEFAULT 'main',
        status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','fired','completed')),
        fired_at TIMESTAMPTZ,
        fired_by INTEGER REFERENCES employees(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_course_fires_order ON restaurant_course_fires(draft_order_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_tabs (
        id SERIAL PRIMARY KEY,
        outlet_id INTEGER NOT NULL REFERENCES outlets(id),
        customer_id INTEGER REFERENCES customers(id),
        customer_name TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        opened_by INTEGER REFERENCES employees(id),
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_tabs_outlet ON restaurant_tabs(outlet_id) WHERE status = 'open'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurant_preauth_holds (
        id SERIAL PRIMARY KEY,
        tab_id INTEGER NOT NULL REFERENCES restaurant_tabs(id) ON DELETE CASCADE,
        gateway_ref TEXT,
        amount NUMERIC(12,2),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','captured','voided','expired')),
        provider TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // KDS
    await client.query(`
      CREATE TABLE IF NOT EXISTS kds_stations (
        id SERIAL PRIMARY KEY,
        outlet_id INTEGER NOT NULL REFERENCES outlets(id),
        name TEXT NOT NULL,
        station_role TEXT NOT NULL DEFAULT 'prep' CHECK (station_role IN ('prep','expo')),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kds_stations_outlet ON kds_stations(outlet_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS kds_station_routes (
        id SERIAL PRIMARY KEY,
        station_id INTEGER NOT NULL REFERENCES kds_stations(id) ON DELETE CASCADE,
        category_id INTEGER REFERENCES categories(id),
        match_all BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS kds_tickets (
        id SERIAL PRIMARY KEY,
        station_id INTEGER NOT NULL REFERENCES kds_stations(id),
        draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id),
        table_label TEXT,
        seat_label TEXT,
        course_name TEXT DEFAULT 'main',
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','ready','bumped')),
        priority INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kds_tickets_station_status ON kds_tickets(station_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kds_tickets_order ON kds_tickets(draft_order_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS kds_ticket_events (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (event_type IN ('created','started','ready','bumped','recalled')),
        actor_id INTEGER REFERENCES employees(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kds_ticket_events_ticket ON kds_ticket_events(ticket_id)`);

    // Extend draft_orders
    await client.query(`
      ALTER TABLE draft_orders
        ADD COLUMN IF NOT EXISTS order_context TEXT DEFAULT 'retail',
        ADD COLUMN IF NOT EXISTS table_id INTEGER REFERENCES restaurant_tables(id),
        ADD COLUMN IF NOT EXISTS table_session_id INTEGER REFERENCES restaurant_table_sessions(id),
        ADD COLUMN IF NOT EXISTS tab_id INTEGER REFERENCES restaurant_tabs(id),
        ADD COLUMN IF NOT EXISTS seat_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS dining_option TEXT,
        ADD COLUMN IF NOT EXISTS source_token_id TEXT
    `);

    // Extend draft_order_items with seat assignment
    await client.query(`
      ALTER TABLE draft_order_items
        ADD COLUMN IF NOT EXISTS seat_number INTEGER,
        ADD COLUMN IF NOT EXISTS course_name TEXT DEFAULT 'main',
        ADD COLUMN IF NOT EXISTS kitchen_status TEXT DEFAULT 'pending'
    `);

    // Seed feature flags
    await client.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_restaurant', false),
        ('phase4_restaurant_qr', false),
        ('phase4_restaurant_kds', false),
        ('phase4_restaurant_preauth', false)
      ON CONFLICT (key) DO NOTHING
    `);
  },
},
```

### Step 4: Run migration test

```bash
npx jest backend/tests/integration/pg-schema.test.js
```

### Step 5: Commit

```bash
git add backend/schema-pg.sql backend/migrate-pg.js
git commit -m "feat(phase4): add migration v22 — restaurant schema, KDS, draft_orders context extension"
```

---

## Task 3: Public Tenant Context Extraction

**Files:**
- Create: `backend/services/public-tenant-context.js`
- Modify: `backend/routes/storefront.js`

### Step 1: Create the shared resolver

Create `backend/services/public-tenant-context.js`:

```javascript
/**
 * Shared public tenant resolver — extracted from storefront.js.
 * Used by storefront, QR ordering, public bookings.
 */

const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";

async function resolvePublicTenantDb(req, deps) {
  if (!IS_MULTI_TENANT) return { db: deps.db };

  const tenantSlug = req.query.tenant || req.headers["x-tenant-slug"];
  if (!tenantSlug) {
    return { error: "tenant query param or x-tenant-slug header is required", status: 400 };
  }

  const masterDb = require("../master-db-pg");
  const tenantDbMgr = deps.tenantDbManager || require("../tenant-db-manager-pg");

  const {
    rows: [tenant],
  } = await masterDb.query(
    "SELECT id, slug, status FROM tenants WHERE slug = $1 AND status = 'active'",
    [String(tenantSlug).trim()]
  );
  if (!tenant) {
    return { error: "Store not found", status: 404 };
  }

  const db = await tenantDbMgr.getDb(tenant.id);
  return { db, tenant };
}

module.exports = { resolvePublicTenantDb };
```

### Step 2: Refactor storefront.js to use shared resolver

In `backend/routes/storefront.js`:

1. Remove the inline `resolveStorefrontDb` function (lines 14-38)
2. Add import at top: `const { resolvePublicTenantDb } = require("../services/public-tenant-context");`
3. Replace all calls to `resolveStorefrontDb(req)` with `resolvePublicTenantDb(req, deps)`

The `deps` parameter is already available as the second parameter of the module function.

### Step 3: Verify storefront still works

```bash
npx jest backend/tests/integration/pg-batch7-order-service.test.js
```

### Step 4: Commit

```bash
git add backend/services/public-tenant-context.js backend/routes/storefront.js
git commit -m "refactor: extract resolvePublicTenantDb from storefront into shared service"
```

---

## Task 4: Restaurant Domain Services

**Files:**
- Create: `backend/services/restaurant-floor.js`
- Create: `backend/services/restaurant-checks.js`
- Create: `backend/services/restaurant-kds.js`
- Create: `backend/schemas/restaurant.js`

### Step 1: Create Zod schemas

Create `backend/schemas/restaurant.js`:

```javascript
const { z } = require("zod");

const createFloorPlanSchema = z.object({
  name: z.string().min(1),
  outlet_id: z.number().int().positive(),
  layout_json: z.any().optional(),
});

const updateFloorPlanSchema = z.object({
  name: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  layout_json: z.any().optional(),
});

const createTableSchema = z.object({
  floor_plan_id: z.number().int().positive(),
  section_id: z.number().int().positive().optional(),
  label: z.string().min(1),
  capacity: z.number().int().positive().default(4),
  shape: z.enum(["square", "round", "rectangle"]).default("square"),
  pos_x: z.number().int().default(0),
  pos_y: z.number().int().default(0),
});

const updateTableSchema = z.object({
  label: z.string().min(1).optional(),
  section_id: z.number().int().positive().optional().nullable(),
  capacity: z.number().int().positive().optional(),
  shape: z.enum(["square", "round", "rectangle"]).optional(),
  pos_x: z.number().int().optional(),
  pos_y: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

const createSessionSchema = z.object({
  table_id: z.number().int().positive(),
  server_id: z.number().int().positive().optional(),
  guest_count: z.number().int().positive().default(1),
});

const createCheckSchema = z.object({
  table_session_id: z.number().int().positive().optional(),
  tab_id: z.number().int().positive().optional(),
  order_context: z.enum(["dine_in", "takeout", "delivery", "bar"]).default("dine_in"),
  dining_option: z.enum(["dine_in", "takeout", "delivery"]).optional(),
  outlet_id: z.number().int().positive(),
  seat_count: z.number().int().min(0).default(0),
});

const splitCheckSchema = z.object({
  split_type: z.enum(["by_item", "by_seat", "equal"]),
  parts: z.number().int().min(2).optional(),
  item_assignments: z.array(z.object({
    item_id: z.number().int().positive(),
    target_check_index: z.number().int().min(0),
  })).optional(),
});

const fireCourseSchema = z.object({
  course_name: z.string().min(1),
});

const createTabSchema = z.object({
  outlet_id: z.number().int().positive(),
  customer_id: z.number().int().positive().optional(),
  customer_name: z.string().optional(),
});

const createKdsStationSchema = z.object({
  outlet_id: z.number().int().positive(),
  name: z.string().min(1),
  station_role: z.enum(["prep", "expo"]).default("prep"),
});

const updateKdsStationSchema = z.object({
  name: z.string().min(1).optional(),
  station_role: z.enum(["prep", "expo"]).optional(),
  is_active: z.boolean().optional(),
});

module.exports = {
  createFloorPlanSchema, updateFloorPlanSchema,
  createTableSchema, updateTableSchema,
  createSessionSchema, createCheckSchema,
  splitCheckSchema, fireCourseSchema,
  createTabSchema,
  createKdsStationSchema, updateKdsStationSchema,
};
```

### Step 2: Create floor service

Create `backend/services/restaurant-floor.js`:

```javascript
/**
 * Restaurant floor plan and table session service.
 */

async function getFloorPlans(db, outletId) {
  const { rows } = await db.query(
    `SELECT fp.*, 
       (SELECT COUNT(*)::int FROM restaurant_tables rt WHERE rt.floor_plan_id = fp.id AND rt.is_active = true) AS table_count
     FROM restaurant_floor_plans fp
     WHERE fp.outlet_id = $1
     ORDER BY fp.name`,
    [outletId]
  );
  return rows;
}

async function getFloorPlanWithTables(db, planId) {
  const { rows: [plan] } = await db.query(
    "SELECT * FROM restaurant_floor_plans WHERE id = $1",
    [planId]
  );
  if (!plan) return null;

  const { rows: sections } = await db.query(
    "SELECT * FROM restaurant_floor_sections WHERE floor_plan_id = $1 ORDER BY sort_order",
    [planId]
  );

  const { rows: tables } = await db.query(
    `SELECT rt.*,
       ts.id AS session_id, ts.status AS session_status, ts.guest_count, ts.server_id,
       ts.seated_at, e.name AS server_name
     FROM restaurant_tables rt
     LEFT JOIN restaurant_table_sessions ts ON ts.table_id = rt.id AND ts.status != 'closed'
     LEFT JOIN employees e ON e.id = ts.server_id
     WHERE rt.floor_plan_id = $1
     ORDER BY rt.label`,
    [planId]
  );

  return { ...plan, sections, tables };
}

async function createFloorPlan(db, data) {
  const { rows: [plan] } = await db.query(
    `INSERT INTO restaurant_floor_plans (outlet_id, name, layout_json)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.outlet_id, data.name, JSON.stringify(data.layout_json || {})]
  );
  return plan;
}

async function updateFloorPlan(db, id, data) {
  const sets = [];
  const params = [];
  let idx = 0;

  if (data.name !== undefined) { idx++; sets.push(`name = $${idx}`); params.push(data.name); }
  if (data.is_active !== undefined) { idx++; sets.push(`is_active = $${idx}`); params.push(data.is_active); }
  if (data.layout_json !== undefined) { idx++; sets.push(`layout_json = $${idx}`); params.push(JSON.stringify(data.layout_json)); }

  if (!sets.length) return null;
  idx++; params.push(id);
  sets.push("updated_at = NOW()");

  const { rows: [plan] } = await db.query(
    `UPDATE restaurant_floor_plans SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return plan;
}

async function openTableSession(db, data) {
  // Check no active session on table
  const { rows: existing } = await db.query(
    "SELECT id FROM restaurant_table_sessions WHERE table_id = $1 AND status != 'closed'",
    [data.table_id]
  );
  if (existing.length) throw Object.assign(new Error("Table already has an active session"), { statusCode: 409 });

  // Get table's outlet
  const { rows: [table] } = await db.query(
    "SELECT rt.*, fp.outlet_id FROM restaurant_tables rt JOIN restaurant_floor_plans fp ON fp.id = rt.floor_plan_id WHERE rt.id = $1",
    [data.table_id]
  );
  if (!table) throw Object.assign(new Error("Table not found"), { statusCode: 404 });

  const { rows: [session] } = await db.query(
    `INSERT INTO restaurant_table_sessions (table_id, outlet_id, server_id, guest_count)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.table_id, table.outlet_id, data.server_id || null, data.guest_count || 1]
  );
  return session;
}

async function updateTableSession(db, id, data) {
  const sets = [];
  const params = [];
  let idx = 0;

  if (data.status !== undefined) {
    idx++; sets.push(`status = $${idx}`); params.push(data.status);
    if (data.status === "closed") sets.push("closed_at = NOW()");
  }
  if (data.server_id !== undefined) { idx++; sets.push(`server_id = $${idx}`); params.push(data.server_id); }
  if (data.guest_count !== undefined) { idx++; sets.push(`guest_count = $${idx}`); params.push(data.guest_count); }

  if (!sets.length) return null;
  idx++; params.push(id);
  sets.push("updated_at = NOW()");

  const { rows: [session] } = await db.query(
    `UPDATE restaurant_table_sessions SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return session;
}

module.exports = {
  getFloorPlans, getFloorPlanWithTables,
  createFloorPlan, updateFloorPlan,
  openTableSession, updateTableSession,
};
```

### Step 3: Create checks service

Create `backend/services/restaurant-checks.js`:

```javascript
/**
 * Restaurant checks — seats, splits, coursing, tabs.
 * Checks are draft_orders with order_context != 'retail'.
 */

async function createRestaurantCheck(db, data, employeeId) {
  const { rows: [order] } = await db.query(
    `INSERT INTO draft_orders (outlet_id, created_by, order_context, table_id, table_session_id, tab_id, seat_count, dining_option, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open') RETURNING *`,
    [data.outlet_id, employeeId, data.order_context || "dine_in",
     data.table_id || null, data.table_session_id || null,
     data.tab_id || null, data.seat_count || 0,
     data.dining_option || null]
  );
  return order;
}

async function getOpenChecks(db, outletId, filters = {}) {
  const params = [outletId];
  let where = "d.outlet_id = $1 AND d.order_context != 'retail' AND d.status IN ('open','claimed')";
  let idx = 1;

  if (filters.table_session_id) {
    idx++; where += ` AND d.table_session_id = $${idx}`; params.push(filters.table_session_id);
  }
  if (filters.tab_id) {
    idx++; where += ` AND d.tab_id = $${idx}`; params.push(filters.tab_id);
  }

  const { rows } = await db.query(
    `SELECT d.*,
       rt.label AS table_label,
       e.name AS server_name,
       (SELECT COUNT(*)::int FROM draft_order_items di WHERE di.draft_order_id = d.id) AS item_count
     FROM draft_orders d
     LEFT JOIN restaurant_tables rt ON rt.id = d.table_id
     LEFT JOIN employees e ON e.id = d.created_by
     WHERE ${where}
     ORDER BY d.created_at DESC`,
    params
  );
  return rows;
}

async function assignSeat(db, tableSessionId, draftOrderId, seatNumber, label) {
  const { rows: [seat] } = await db.query(
    `INSERT INTO restaurant_check_seats (table_session_id, draft_order_id, seat_number, label)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (table_session_id, seat_number) DO UPDATE SET draft_order_id = $2, label = $4
     RETURNING *`,
    [tableSessionId, draftOrderId, seatNumber, label || null]
  );
  return seat;
}

async function splitCheckByItem(db, sourceDraftOrderId, itemAssignments, employeeId) {
  return await db.transaction(async (client) => {
    // Get source order
    const { rows: [source] } = await client.query(
      "SELECT * FROM draft_orders WHERE id = $1",
      [sourceDraftOrderId]
    );
    if (!source) throw Object.assign(new Error("Check not found"), { statusCode: 404 });

    // Group items by target
    const groups = {};
    for (const { item_id, target_check_index } of itemAssignments) {
      if (!groups[target_check_index]) groups[target_check_index] = [];
      groups[target_check_index].push(item_id);
    }

    const newChecks = [];
    for (const [, itemIds] of Object.entries(groups)) {
      // Create new draft order for split
      const { rows: [newOrder] } = await client.query(
        `INSERT INTO draft_orders (outlet_id, created_by, order_context, table_id, table_session_id, tab_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open') RETURNING *`,
        [source.outlet_id, employeeId, source.order_context, source.table_id, source.table_session_id, source.tab_id]
      );

      // Move items
      for (const itemId of itemIds) {
        await client.query(
          "UPDATE draft_order_items SET draft_order_id = $1 WHERE id = $2 AND draft_order_id = $3",
          [newOrder.id, itemId, sourceDraftOrderId]
        );
      }

      // Recalculate new order totals
      await recalcCheckTotals(client, newOrder.id);
      const { rows: [updated] } = await client.query("SELECT * FROM draft_orders WHERE id = $1", [newOrder.id]);
      newChecks.push(updated);
    }

    // Recalculate source totals
    await recalcCheckTotals(client, sourceDraftOrderId);

    // Distribute adjustments proportionally
    await distributeAdjustments(client, sourceDraftOrderId, newChecks.map(c => c.id));

    return newChecks;
  });
}

async function splitCheckBySeat(db, sourceDraftOrderId, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: items } = await client.query(
      "SELECT * FROM draft_order_items WHERE draft_order_id = $1",
      [sourceDraftOrderId]
    );

    // Group by seat
    const seatGroups = {};
    for (const item of items) {
      const seat = item.seat_number || 0;
      if (!seatGroups[seat]) seatGroups[seat] = [];
      seatGroups[seat].push(item);
    }

    const seats = Object.keys(seatGroups);
    if (seats.length < 2) throw Object.assign(new Error("Need items on at least 2 seats to split"), { statusCode: 400 });

    // Convert to item assignments format
    const assignments = [];
    let idx = 0;
    for (const seat of seats) {
      for (const item of seatGroups[seat]) {
        assignments.push({ item_id: item.id, target_check_index: idx });
      }
      idx++;
    }

    return splitCheckByItem(db, sourceDraftOrderId, assignments, employeeId);
  });
}

async function fireCourse(db, draftOrderId, courseName, employeeId) {
  // Update or create course fire record
  const { rows: [existing] } = await db.query(
    "SELECT id FROM restaurant_course_fires WHERE draft_order_id = $1 AND course_name = $2",
    [draftOrderId, courseName]
  );

  if (existing) {
    const { rows: [fire] } = await db.query(
      `UPDATE restaurant_course_fires SET status = 'fired', fired_at = NOW(), fired_by = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [employeeId, existing.id]
    );
    return fire;
  }

  const { rows: [fire] } = await db.query(
    `INSERT INTO restaurant_course_fires (draft_order_id, course_name, status, fired_at, fired_by)
     VALUES ($1, $2, 'fired', NOW(), $3) RETURNING *`,
    [draftOrderId, courseName, employeeId]
  );
  return fire;
}

async function openTab(db, data, employeeId) {
  const { rows: [tab] } = await db.query(
    `INSERT INTO restaurant_tabs (outlet_id, customer_id, customer_name, opened_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.outlet_id, data.customer_id || null, data.customer_name || null, employeeId]
  );
  return tab;
}

async function closeTab(db, tabId) {
  // Check all checks on this tab are completed
  const { rows: openChecks } = await db.query(
    "SELECT id FROM draft_orders WHERE tab_id = $1 AND status IN ('open','claimed')",
    [tabId]
  );
  if (openChecks.length) throw Object.assign(new Error("Cannot close tab with open checks"), { statusCode: 400 });

  const { rows: [tab] } = await db.query(
    "UPDATE restaurant_tabs SET status = 'closed', closed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
    [tabId]
  );
  return tab;
}

// --- helpers ---

async function recalcCheckTotals(client, draftOrderId) {
  await client.query(`
    UPDATE draft_orders SET
      subtotal = COALESCE((SELECT SUM(price * quantity) FROM draft_order_items WHERE draft_order_id = $1), 0),
      discount_total = COALESCE((SELECT SUM(discount * quantity) FROM draft_order_items WHERE draft_order_id = $1), 0),
      tax_total = COALESCE((SELECT SUM(price * quantity * effective_tax_rate) FROM draft_order_items WHERE draft_order_id = $1), 0),
      total = COALESCE((SELECT SUM((price - discount) * quantity * (1 + effective_tax_rate)) FROM draft_order_items WHERE draft_order_id = $1), 0),
      updated_at = NOW()
    WHERE id = $1`,
    [draftOrderId]
  );
}

async function distributeAdjustments(client, sourceId, newCheckIds) {
  const { rows: adjustments } = await client.query(
    "SELECT * FROM restaurant_check_adjustments WHERE draft_order_id = $1",
    [sourceId]
  );
  if (!adjustments.length) return;

  // Get totals for proportional distribution
  const allIds = [sourceId, ...newCheckIds];
  const totals = {};
  let grandTotal = 0;
  for (const id of allIds) {
    const { rows: [{ total }] } = await client.query("SELECT total FROM draft_orders WHERE id = $1", [id]);
    totals[id] = Number(total);
    grandTotal += Number(total);
  }
  if (grandTotal === 0) return;

  for (const adj of adjustments) {
    for (const checkId of newCheckIds) {
      const proportion = totals[checkId] / grandTotal;
      const splitAmount = Math.round(Number(adj.amount) * proportion * 100) / 100;
      await client.query(
        `INSERT INTO restaurant_check_adjustments (draft_order_id, adjustment_type, label, amount, is_percentage, percentage_value)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [checkId, adj.adjustment_type, adj.label, splitAmount, adj.is_percentage, adj.percentage_value]
      );
    }
  }
}

module.exports = {
  createRestaurantCheck, getOpenChecks,
  assignSeat, splitCheckByItem, splitCheckBySeat,
  fireCourse, openTab, closeTab,
  recalcCheckTotals,
};
```

### Step 4: Create KDS service

Create `backend/services/restaurant-kds.js`:

```javascript
/**
 * Kitchen Display System service — tickets, routing, bump.
 */

async function getStations(db, outletId) {
  const { rows } = await db.query(
    `SELECT ks.*,
       (SELECT COUNT(*)::int FROM kds_tickets kt WHERE kt.station_id = ks.id AND kt.status IN ('new','in_progress')) AS active_tickets
     FROM kds_stations ks
     WHERE ks.outlet_id = $1
     ORDER BY ks.name`,
    [outletId]
  );
  return rows;
}

async function createStation(db, data) {
  const { rows: [station] } = await db.query(
    `INSERT INTO kds_stations (outlet_id, name, station_role)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.outlet_id, data.name, data.station_role || "prep"]
  );
  return station;
}

async function updateStation(db, id, data) {
  const sets = [];
  const params = [];
  let idx = 0;
  if (data.name !== undefined) { idx++; sets.push(`name = $${idx}`); params.push(data.name); }
  if (data.station_role !== undefined) { idx++; sets.push(`station_role = $${idx}`); params.push(data.station_role); }
  if (data.is_active !== undefined) { idx++; sets.push(`is_active = $${idx}`); params.push(data.is_active); }
  if (!sets.length) return null;
  idx++; params.push(id);
  sets.push("updated_at = NOW()");
  const { rows: [station] } = await db.query(
    `UPDATE kds_stations SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return station;
}

async function sendToKitchen(db, draftOrderId) {
  // Get items and route to stations
  const { rows: items } = await db.query(
    `SELECT di.*, p.category_id, d.table_id
     FROM draft_order_items di
     JOIN draft_orders d ON d.id = di.draft_order_id
     LEFT JOIN products p ON p.id = di.product_id
     WHERE di.draft_order_id = $1 AND di.kitchen_status = 'pending'`,
    [draftOrderId]
  );
  if (!items.length) return [];

  // Get order context for table label
  const { rows: [order] } = await db.query(
    `SELECT d.*, rt.label AS table_label
     FROM draft_orders d
     LEFT JOIN restaurant_tables rt ON rt.id = d.table_id
     WHERE d.id = $1`,
    [draftOrderId]
  );

  // Get outlet's stations and routing rules
  const { rows: stations } = await db.query(
    "SELECT * FROM kds_stations WHERE outlet_id = $1 AND is_active = true",
    [order.outlet_id]
  );
  const { rows: routes } = await db.query(
    `SELECT sr.* FROM kds_station_routes sr
     JOIN kds_stations ks ON ks.id = sr.station_id
     WHERE ks.outlet_id = $1`,
    [order.outlet_id]
  );

  const tickets = [];
  for (const item of items) {
    // Find matching station by category routing, fallback to match_all
    let targetStation = null;
    for (const route of routes) {
      if (route.category_id === item.category_id) {
        targetStation = stations.find(s => s.id === route.station_id);
        break;
      }
    }
    if (!targetStation) {
      const catchAll = routes.find(r => r.match_all);
      if (catchAll) targetStation = stations.find(s => s.id === catchAll.station_id);
    }
    if (!targetStation && stations.length) targetStation = stations[0];
    if (!targetStation) continue;

    const { rows: [ticket] } = await db.query(
      `INSERT INTO kds_tickets (station_id, draft_order_id, table_label, seat_label, course_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [targetStation.id, draftOrderId, order.table_label || null, item.seat_number ? `S${item.seat_number}` : null, item.course_name || "main"]
    );

    // Log event
    await db.query(
      "INSERT INTO kds_ticket_events (ticket_id, event_type) VALUES ($1, 'created')",
      [ticket.id]
    );

    tickets.push(ticket);
  }

  // Mark items as sent
  await db.query(
    "UPDATE draft_order_items SET kitchen_status = 'sent' WHERE draft_order_id = $1 AND kitchen_status = 'pending'",
    [draftOrderId]
  );

  return tickets;
}

async function getTickets(db, stationId, statusFilter) {
  const params = [stationId];
  let where = "kt.station_id = $1";
  if (statusFilter) {
    params.push(statusFilter);
    where += ` AND kt.status = $${params.length}`;
  } else {
    where += " AND kt.status IN ('new','in_progress','ready')";
  }

  const { rows } = await db.query(
    `SELECT kt.*,
       json_agg(json_build_object(
         'id', di.id, 'product_name', di.product_name, 'quantity', di.quantity,
         'notes', di.notes, 'seat_number', di.seat_number, 'course_name', di.course_name
       )) AS items
     FROM kds_tickets kt
     LEFT JOIN draft_order_items di ON di.draft_order_id = kt.draft_order_id AND di.course_name = kt.course_name
     WHERE ${where}
     GROUP BY kt.id
     ORDER BY kt.priority DESC, kt.created_at ASC`,
    params
  );
  return rows;
}

async function bumpTicket(db, ticketId, actorId) {
  const { rows: [ticket] } = await db.query(
    "UPDATE kds_tickets SET status = 'bumped', updated_at = NOW() WHERE id = $1 RETURNING *",
    [ticketId]
  );
  if (!ticket) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });

  await db.query(
    "INSERT INTO kds_ticket_events (ticket_id, event_type, actor_id) VALUES ($1, 'bumped', $2)",
    [ticketId, actorId]
  );

  // Check if all tickets for this order are bumped → mark expo
  const { rows: remaining } = await db.query(
    "SELECT id FROM kds_tickets WHERE draft_order_id = $1 AND status IN ('new','in_progress')",
    [ticket.draft_order_id]
  );

  // Route to expo station if all prep done
  if (!remaining.length) {
    const { rows: expoStations } = await db.query(
      `SELECT ks.id FROM kds_stations ks
       JOIN kds_tickets kt ON kt.station_id = ks.id
       WHERE kt.draft_order_id = $1 AND ks.station_role = 'expo'
       LIMIT 1`,
      [ticket.draft_order_id]
    );
    // If no expo ticket exists, create one
    if (!expoStations.length) {
      const { rows: [expo] } = await db.query(
        `SELECT id FROM kds_stations WHERE outlet_id = (SELECT outlet_id FROM draft_orders WHERE id = $1) AND station_role = 'expo' AND is_active = true LIMIT 1`,
        [ticket.draft_order_id]
      );
      if (expo) {
        const { rows: [expoTicket] } = await db.query(
          `INSERT INTO kds_tickets (station_id, draft_order_id, table_label, course_name, status)
           VALUES ($1, $2, $3, $4, 'new') RETURNING *`,
          [expo.id, ticket.draft_order_id, ticket.table_label, ticket.course_name]
        );
        await db.query(
          "INSERT INTO kds_ticket_events (ticket_id, event_type) VALUES ($1, 'created')",
          [expoTicket.id]
        );
      }
    }
  }

  return ticket;
}

module.exports = { getStations, createStation, updateStation, sendToKitchen, getTickets, bumpTicket };
```

### Step 5: Commit

```bash
git add backend/schemas/restaurant.js backend/services/restaurant-floor.js backend/services/restaurant-checks.js backend/services/restaurant-kds.js
git commit -m "feat(phase4): add restaurant domain services — floor, checks, splits, coursing, KDS"
```

---

## Task 5: Restaurant Backend Routes

**Files:**
- Create: `backend/routes/restaurant.js`
- Modify: `backend/routes/registerAllRoutes.js`

### Step 1: Create restaurant routes

Create `backend/routes/restaurant.js`:

```javascript
module.exports = function registerRestaurantRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createFloorPlanSchema, updateFloorPlanSchema,
    createTableSchema, updateTableSchema,
    createSessionSchema, createCheckSchema,
    splitCheckSchema, fireCourseSchema,
    createTabSchema,
  } = require("../schemas/restaurant");
  const floor = require("../services/restaurant-floor");
  const checks = require("../services/restaurant-checks");
  const kds = require("../services/restaurant-kds");

  const gate = [requireFeature("phase4_restaurant"), requirePerm("manage_restaurant")];

  // ── Floor Plans ──────────────────────────────────────────────

  app.get("/api/restaurant/floor-plans", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outlet_id;
      if (!outletId) return res.status(400).json({ error: "outlet_id required" });
      const plans = await floor.getFloorPlans(deps.db, Number(outletId));
      res.json({ floor_plans: plans });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get("/api/restaurant/floor-plans/:id", ...gate, async (req, res) => {
    try {
      const plan = await floor.getFloorPlanWithTables(deps.db, Number(req.params.id));
      if (!plan) return res.status(404).json({ error: "Floor plan not found" });
      res.json(plan);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/floor-plans", ...gate, validate(createFloorPlanSchema), async (req, res) => {
    try {
      const plan = await floor.createFloorPlan(deps.db, req.body);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_floor_plan_created", JSON.stringify({ id: plan.id })]); } catch {}
      res.status(201).json(plan);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/restaurant/floor-plans/:id", ...gate, validate(updateFloorPlanSchema), async (req, res) => {
    try {
      const plan = await floor.updateFloorPlan(deps.db, Number(req.params.id), req.body);
      if (!plan) return res.status(404).json({ error: "Floor plan not found" });
      res.json(plan);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Tables ───────────────────────────────────────────────────

  app.get("/api/restaurant/tables", ...gate, async (req, res) => {
    try {
      const { floor_plan_id } = req.query;
      if (!floor_plan_id) return res.status(400).json({ error: "floor_plan_id required" });
      const { rows } = await deps.db.query(
        "SELECT * FROM restaurant_tables WHERE floor_plan_id = $1 ORDER BY label",
        [Number(floor_plan_id)]
      );
      res.json({ tables: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/tables", ...gate, validate(createTableSchema), async (req, res) => {
    try {
      const { rows: [table] } = await deps.db.query(
        `INSERT INTO restaurant_tables (floor_plan_id, section_id, label, capacity, shape, pos_x, pos_y)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [req.body.floor_plan_id, req.body.section_id || null, req.body.label, req.body.capacity, req.body.shape, req.body.pos_x, req.body.pos_y]
      );
      res.status(201).json(table);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/restaurant/tables/:id", ...gate, validate(updateTableSchema), async (req, res) => {
    try {
      const sets = []; const params = []; let idx = 0;
      for (const [key, val] of Object.entries(req.body)) {
        if (val !== undefined) { idx++; sets.push(`${key} = $${idx}`); params.push(val); }
      }
      if (!sets.length) return res.status(400).json({ error: "No fields to update" });
      idx++; params.push(Number(req.params.id));
      sets.push("updated_at = NOW()");
      const { rows: [table] } = await deps.db.query(
        `UPDATE restaurant_tables SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
      );
      if (!table) return res.status(404).json({ error: "Table not found" });
      res.json(table);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Table Sessions ───────────────────────────────────────────

  app.get("/api/restaurant/table-sessions", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outlet_id;
      const status = req.query.status;
      const params = [];
      let where = "1=1";
      let idx = 0;
      if (outletId) { idx++; where += ` AND ts.outlet_id = $${idx}`; params.push(Number(outletId)); }
      if (status) { idx++; where += ` AND ts.status = $${idx}`; params.push(status); }
      else { where += " AND ts.status != 'closed'"; }

      const { rows } = await deps.db.query(
        `SELECT ts.*, rt.label AS table_label, e.name AS server_name
         FROM restaurant_table_sessions ts
         JOIN restaurant_tables rt ON rt.id = ts.table_id
         LEFT JOIN employees e ON e.id = ts.server_id
         WHERE ${where}
         ORDER BY ts.seated_at DESC`,
        params
      );
      res.json({ sessions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/table-sessions", ...gate, validate(createSessionSchema), async (req, res) => {
    try {
      const session = await floor.openTableSession(deps.db, req.body);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_session_opened", JSON.stringify({ session_id: session.id, table_id: req.body.table_id })]); } catch {}
      res.status(201).json(session);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/restaurant/table-sessions/:id", ...gate, async (req, res) => {
    try {
      const session = await floor.updateTableSession(deps.db, Number(req.params.id), req.body);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json(session);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Checks (restaurant draft orders) ─────────────────────────

  app.get("/api/restaurant/checks", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outlet_id;
      if (!outletId) return res.status(400).json({ error: "outlet_id required" });
      const rows = await checks.getOpenChecks(deps.db, Number(outletId), req.query);
      res.json({ checks: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/checks", ...gate, validate(createCheckSchema), async (req, res) => {
    try {
      const order = await checks.createRestaurantCheck(deps.db, req.body, req.employee.id);
      res.status(201).json(order);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/checks/:id/send-to-kitchen", ...gate, async (req, res) => {
    try {
      const tickets = await kds.sendToKitchen(deps.db, Number(req.params.id));
      res.json({ tickets });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/checks/:id/fire-course", ...gate, validate(fireCourseSchema), async (req, res) => {
    try {
      const fire = await checks.fireCourse(deps.db, Number(req.params.id), req.body.course_name, req.employee.id);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_course_fired", JSON.stringify({ draft_order_id: Number(req.params.id), course_name: req.body.course_name })]); } catch {}
      res.json(fire);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/checks/:id/split", ...gate, validate(splitCheckSchema), async (req, res) => {
    try {
      let result;
      if (req.body.split_type === "by_seat") {
        result = await checks.splitCheckBySeat(deps.db, Number(req.params.id), req.employee.id);
      } else {
        result = await checks.splitCheckByItem(deps.db, Number(req.params.id), req.body.item_assignments || [], req.employee.id);
      }
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_check_split", JSON.stringify({ source_id: Number(req.params.id), type: req.body.split_type })]); } catch {}
      res.json({ new_checks: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Tabs ─────────────────────────────────────────────────────

  app.post("/api/restaurant/tabs", ...gate, validate(createTabSchema), async (req, res) => {
    try {
      const tab = await checks.openTab(deps.db, req.body, req.employee.id);
      res.status(201).json(tab);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/tabs/:id/close", ...gate, async (req, res) => {
    try {
      const tab = await checks.closeTab(deps.db, Number(req.params.id));
      res.json(tab);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
```

### Step 2: Commit

```bash
git add backend/routes/restaurant.js
git commit -m "feat(phase4): add restaurant backend routes — floor plans, tables, sessions, checks, tabs"
```

---

## Task 6: KDS Backend Routes

**Files:**
- Create: `backend/routes/kds.js`

### Step 1: Create KDS routes

Create `backend/routes/kds.js`:

```javascript
module.exports = function registerKdsRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createKdsStationSchema, updateKdsStationSchema } = require("../schemas/restaurant");
  const kds = require("../services/restaurant-kds");

  const gate = [requireFeature("phase4_restaurant_kds"), requirePerm("manage_kds")];

  app.get("/api/kds/stations", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outlet_id;
      if (!outletId) return res.status(400).json({ error: "outlet_id required" });
      const stations = await kds.getStations(deps.db, Number(outletId));
      res.json({ stations });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/kds/stations", ...gate, validate(createKdsStationSchema), async (req, res) => {
    try {
      const station = await kds.createStation(deps.db, req.body);
      res.status(201).json(station);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/kds/stations/:id", ...gate, validate(updateKdsStationSchema), async (req, res) => {
    try {
      const station = await kds.updateStation(deps.db, Number(req.params.id), req.body);
      if (!station) return res.status(404).json({ error: "Station not found" });
      res.json(station);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get("/api/kds/tickets", ...gate, async (req, res) => {
    try {
      const { station_id, status } = req.query;
      if (!station_id) return res.status(400).json({ error: "station_id required" });
      const tickets = await kds.getTickets(deps.db, Number(station_id), status || null);
      res.json({ tickets });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/kds/tickets/:id/bump", ...gate, async (req, res) => {
    try {
      const ticket = await kds.bumpTicket(deps.db, Number(req.params.id), req.employee.id);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "kds_ticket_bumped", JSON.stringify({ ticket_id: Number(req.params.id) })]); } catch {}
      res.json(ticket);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
```

### Step 2: Commit

```bash
git add backend/routes/kds.js
git commit -m "feat(phase4): add KDS backend routes — stations, tickets, bump"
```

---

## Task 7: Restaurant Frontend Pages

**Files:**
- Create: `frontend/src/pages/redesign/RestaurantFloorRedesign.jsx`
- Create: `frontend/src/pages/redesign/RestaurantChecksRedesign.jsx`
- Create: `frontend/src/pages/redesign/KDSRedesign.jsx`
- Create: `frontend/src/pages/redesign/KioskOrderingRedesign.jsx`

> **Implementation guidance for the engineer:** Each page should follow the exact same pattern as `CustomerInvoicesRedesign.jsx` — import hooks (`useAuth`, `useFeatureFlags`, `useToast`, `useCurrency`), check feature flag at top (`if (!flagsLoading && !flags.phase4_restaurant) return <Navigate to="/dashboard" replace />`), use `api.get`/`api.post` for data fetching, `PageShell` + `SectionCard` for layout.
>
> **For the user:** This is where your input on the **floor plan UI** would be most valuable. The floor plan board is the most UX-heavy surface in Phase 4. I'll set up the component structure and data flow, then ask you to shape the visual layout.

### Step 1: Create RestaurantFloorRedesign.jsx

This page shows the floor plan board with table states, occupancy, and session management.

```javascript
import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { LayoutGrid, Plus, Users, Clock, X } from "lucide-react";
import api from "../../api";

const STATUS_TONES = { seated: "warning", ordering: "warning", served: "success", check_requested: "danger", closed: "default" };

export default function RestaurantFloorRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [plans, setPlans] = useState([]);
  const [activePlan, setActivePlan] = useState(null);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSeatModal, setShowSeatModal] = useState(null);
  const [seatForm, setSeatForm] = useState({ guest_count: 1, server_id: "" });

  if (!flagsLoading && !flags.phase4_restaurant) return <Navigate to="/dashboard" replace />;

  // TODO: implement floor plan board with drag-and-drop table positioning,
  // session open/close, server assignment, elapsed timers
  // This is the primary UX decision surface for Phase 4A

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/restaurant/floor-plans?outlet_id=1");
      setPlans(data.floor_plans || []);
      if (data.floor_plans?.length && !activePlan) {
        setActivePlan(data.floor_plans[0].id);
      }
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  const loadFloorDetail = useCallback(async () => {
    if (!activePlan) return;
    try {
      const data = await api.get(`/restaurant/floor-plans/${activePlan}`);
      setTables(data.tables || []);
    } catch (err) { toast.error(err.message); }
  }, [activePlan]);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => { loadFloorDetail(); }, [loadFloorDetail]);

  // Auto-refresh every 10 seconds for live floor state
  useEffect(() => {
    if (!activePlan) return;
    const interval = setInterval(loadFloorDetail, 10000);
    return () => clearInterval(interval);
  }, [activePlan, loadFloorDetail]);

  const openSession = async (tableId) => {
    try {
      await api.post("/restaurant/table-sessions", { table_id: tableId, guest_count: seatForm.guest_count, server_id: seatForm.server_id || undefined });
      toast.success("Table seated");
      setShowSeatModal(null);
      loadFloorDetail();
    } catch (err) { toast.error(err.message); }
  };

  const closeSession = async (sessionId) => {
    try {
      await api.put(`/restaurant/table-sessions/${sessionId}`, { status: "closed" });
      toast.success("Session closed");
      loadFloorDetail();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <PageShell title="Floor Plan" subtitle="Restaurant table management" right={
      <Button size="sm" onClick={() => {/* TODO: create floor plan modal */}}>
        <Plus className="w-4 h-4 mr-1" /> New Plan
      </Button>
    }>
      {/* Plan selector tabs */}
      {plans.length > 1 && (
        <div className="flex gap-2 mb-4">
          {plans.map(p => (
            <button key={p.id} onClick={() => setActivePlan(p.id)}
              className={`px-3 py-1 rounded text-sm ${activePlan === p.id ? "bg-(--color-primary) text-white" : "bg-(--color-surface) text-(--color-text-secondary)"}`}>
              {p.name} ({p.table_count} tables)
            </button>
          ))}
        </div>
      )}

      {/* Table grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {tables.map(t => (
          <SectionCard key={t.id}>
            <div className="text-center">
              <div className="font-bold text-lg">{t.label}</div>
              <div className="text-xs text-(--color-text-secondary)">Cap: {t.capacity}</div>
              {t.session_id ? (
                <>
                  <Badge tone={STATUS_TONES[t.session_status]}>{t.session_status}</Badge>
                  <div className="text-xs mt-1"><Users className="w-3 h-3 inline" /> {t.guest_count} guests</div>
                  {t.server_name && <div className="text-xs">{t.server_name}</div>}
                  <Button size="xs" variant="ghost" className="mt-2" onClick={() => closeSession(t.session_id)}>Close</Button>
                </>
              ) : (
                <Button size="xs" className="mt-2" onClick={() => { setShowSeatModal(t.id); setSeatForm({ guest_count: 1, server_id: "" }); }}>
                  Seat
                </Button>
              )}
            </div>
          </SectionCard>
        ))}
      </div>

      {/* Seat modal - simplified for MVP */}
      {showSeatModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowSeatModal(null)}>
          <div className="bg-(--color-surface) rounded-lg p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-4">Seat Table</h3>
            <label className="block text-sm mb-1">Guests</label>
            <input type="number" min="1" value={seatForm.guest_count} onChange={e => setSeatForm(f => ({ ...f, guest_count: Number(e.target.value) }))} className="w-full border rounded px-2 py-1 mb-3" />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowSeatModal(null)}>Cancel</Button>
              <Button onClick={() => openSession(showSeatModal)}>Seat</Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
```

### Step 2: Create RestaurantChecksRedesign.jsx, KDSRedesign.jsx, KioskOrderingRedesign.jsx

These follow the same pattern. Each should:
- Check `flags.phase4_restaurant` (or `flags.phase4_restaurant_kds` for KDS)
- Fetch from respective API endpoints
- Use `PageShell` + `SectionCard` layout
- Auto-refresh via `setInterval` for live views

> **Engineer note:** Create minimal but functional versions. The checks page shows open checks with split/fire-course buttons. KDS page shows ticket cards with bump buttons and timers. Kiosk page is a simplified ordering flow without auth.

### Step 3: Commit

```bash
git add frontend/src/pages/redesign/RestaurantFloorRedesign.jsx frontend/src/pages/redesign/RestaurantChecksRedesign.jsx frontend/src/pages/redesign/KDSRedesign.jsx frontend/src/pages/redesign/KioskOrderingRedesign.jsx
git commit -m "feat(phase4): add restaurant frontend pages — floor board, checks, KDS, kiosk"
```

---

## Task 8: QR Ordering Public Surface

**Files:**
- Create: `backend/routes/public-restaurant.js`
- Modify: `backend/routes/registerAllRoutes.js`

### Step 1: Create public restaurant routes

Create `backend/routes/public-restaurant.js`:

```javascript
const { resolvePublicTenantDb } = require("../services/public-tenant-context");

module.exports = function registerPublicRestaurantRoutes(app, deps) {

  // GET /api/public/restaurant/menu/:token — public menu for QR
  app.get("/api/public/restaurant/menu/:token", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      // Validate token → resolves to outlet + table
      const { rows: [tokenRow] } = await db.query(
        `SELECT d.id AS draft_order_id, d.table_id, d.outlet_id, rt.label AS table_label
         FROM draft_orders d
         JOIN restaurant_tables rt ON rt.id = d.table_id
         WHERE d.source_token_id = $1 AND d.status = 'open' AND d.order_context IN ('dine_in','bar')`,
        [req.params.token]
      );

      // If no active order with this token, try resolving table by token
      // For QR, the token is typically stored on the table itself
      let outletId, tableLabel;
      if (tokenRow) {
        outletId = tokenRow.outlet_id;
        tableLabel = tokenRow.table_label;
      } else {
        // Fallback: token might be the table ID or a QR token column
        return res.status(404).json({ error: "No active session found for this QR code" });
      }

      // Fetch published menu items for outlet
      const { rows: items } = await db.query(
        `SELECT p.id, p.name, p.description, p.price, p.image_url,
                c.name AS category_name, c.id AS category_id
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = true
         ORDER BY c.sort_order, c.name, p.name`
      );

      // Get company profile for branding
      const { rows: [profile] } = await db.query(
        "SELECT company_name, logo_url, currency_symbol FROM company_profile LIMIT 1"
      );

      res.json({
        table_label: tableLabel,
        company_name: profile?.company_name || "",
        logo_url: profile?.logo_url || null,
        currency_symbol: profile?.currency_symbol || "Rs",
        items,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/restaurant/checks/:token/items — add item from QR
  app.post("/api/public/restaurant/checks/:token/items", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { product_id, quantity, notes } = req.body || {};
      if (!product_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: "product_id and quantity >= 1 required" });
      }

      // Find open order for token
      const { rows: [order] } = await db.query(
        "SELECT * FROM draft_orders WHERE source_token_id = $1 AND status = 'open'",
        [req.params.token]
      );
      if (!order) return res.status(404).json({ error: "No active check for this token" });

      // Get product
      const { rows: [product] } = await db.query(
        "SELECT id, name, price FROM products WHERE id = $1 AND is_active = true",
        [product_id]
      );
      if (!product) return res.status(404).json({ error: "Product not found" });

      // Add item
      const { rows: [item] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [order.id, product.id, product.name, quantity, product.price, notes || null]
      );

      // Recalculate totals
      const { recalcCheckTotals } = require("../services/restaurant-checks");
      await recalcCheckTotals(db, order.id);

      res.status(201).json(item);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
```

### Step 2: Register in registerAllRoutes.js

Add before the tenant middleware section (with other public routes):

```javascript
require("./public-restaurant")(app, deps);
```

### Step 3: Commit

```bash
git add backend/routes/public-restaurant.js backend/routes/registerAllRoutes.js
git commit -m "feat(phase4): add QR ordering public routes — menu and item add"
```

---

## Task 9: Restaurant Integration Tests

**Files:**
- Create: `backend/tests/integration/pg-batch13-restaurant.test.js`

### Step 1: Create test file

```javascript
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Batch 13 — Phase 4A Restaurant (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    require("../../routes/restaurant")(app, deps);
    require("../../routes/kds")(app, deps);

    // Enable feature flags
    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_restaurant', true),
        ('phase4_restaurant_kds', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);
  }, 30000);

  afterAll(async () => { if (cleanup) await cleanup(); });

  // ── Floor Plans ──────────────────────────────────────────────

  describe("Floor Plans", () => {
    let planId;

    it("POST /api/restaurant/floor-plans — creates floor plan", async () => {
      const res = await request(app)
        .post("/api/restaurant/floor-plans")
        .set("x-employee-id", "1")
        .send({ name: "Main Dining", outlet_id: 1 });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Main Dining");
      planId = res.body.id;
    });

    it("GET /api/restaurant/floor-plans — lists plans", async () => {
      const res = await request(app)
        .get("/api/restaurant/floor-plans?outlet_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.floor_plans.length).toBeGreaterThan(0);
    });

    it("GET /api/restaurant/floor-plans/:id — gets plan with tables", async () => {
      const res = await request(app)
        .get(`/api/restaurant/floor-plans/${planId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Main Dining");
      expect(res.body.tables).toBeDefined();
    });
  });

  // ── Tables ───────────────────────────────────────────────────

  describe("Tables", () => {
    let tableId;

    it("POST /api/restaurant/tables — creates table", async () => {
      const { rows: [plan] } = await db.query("SELECT id FROM restaurant_floor_plans LIMIT 1");
      const res = await request(app)
        .post("/api/restaurant/tables")
        .set("x-employee-id", "1")
        .send({ floor_plan_id: plan.id, label: "T1", capacity: 4 });
      expect(res.status).toBe(201);
      expect(res.body.label).toBe("T1");
      tableId = res.body.id;
    });

    it("PUT /api/restaurant/tables/:id — updates table", async () => {
      const res = await request(app)
        .put(`/api/restaurant/tables/${tableId}`)
        .set("x-employee-id", "1")
        .send({ capacity: 6 });
      expect(res.status).toBe(200);
      expect(res.body.capacity).toBe(6);
    });
  });

  // ── Table Sessions ───────────────────────────────────────────

  describe("Table Sessions", () => {
    let sessionId, tableId;

    beforeAll(async () => {
      const { rows: [t] } = await db.query("SELECT id FROM restaurant_tables LIMIT 1");
      tableId = t.id;
    });

    it("POST /api/restaurant/table-sessions — opens session", async () => {
      const res = await request(app)
        .post("/api/restaurant/table-sessions")
        .set("x-employee-id", "1")
        .send({ table_id: tableId, guest_count: 3 });
      expect(res.status).toBe(201);
      expect(res.body.guest_count).toBe(3);
      expect(res.body.status).toBe("seated");
      sessionId = res.body.id;
    });

    it("POST /api/restaurant/table-sessions — rejects duplicate active session", async () => {
      const res = await request(app)
        .post("/api/restaurant/table-sessions")
        .set("x-employee-id", "1")
        .send({ table_id: tableId, guest_count: 2 });
      expect(res.status).toBe(409);
    });

    it("PUT /api/restaurant/table-sessions/:id — closes session", async () => {
      const res = await request(app)
        .put(`/api/restaurant/table-sessions/${sessionId}`)
        .set("x-employee-id", "1")
        .send({ status: "closed" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("closed");
    });
  });

  // ── Checks ───────────────────────────────────────────────────

  describe("Checks", () => {
    let checkId;

    it("POST /api/restaurant/checks — creates restaurant check", async () => {
      const res = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, order_context: "dine_in" });
      expect(res.status).toBe(201);
      expect(res.body.order_context).toBe("dine_in");
      checkId = res.body.id;
    });

    it("GET /api/restaurant/checks — lists open checks", async () => {
      const res = await request(app)
        .get("/api/restaurant/checks?outlet_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.checks.length).toBeGreaterThan(0);
    });
  });

  // ── KDS ──────────────────────────────────────────────────────

  describe("KDS", () => {
    let stationId;

    it("POST /api/kds/stations — creates station", async () => {
      const res = await request(app)
        .post("/api/kds/stations")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, name: "Grill", station_role: "prep" });
      expect(res.status).toBe(201);
      expect(res.body.station_role).toBe("prep");
      stationId = res.body.id;
    });

    it("GET /api/kds/stations — lists stations", async () => {
      const res = await request(app)
        .get("/api/kds/stations?outlet_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.stations.length).toBeGreaterThan(0);
    });

    it("GET /api/kds/tickets — lists tickets for station", async () => {
      const res = await request(app)
        .get(`/api/kds/tickets?station_id=${stationId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.tickets).toBeDefined();
    });
  });

  // ── Quick-service mode ───────────────────────────────────────

  describe("Quick-service", () => {
    it("creates check without table/session", async () => {
      const res = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, order_context: "takeout", dining_option: "takeout" });
      expect(res.status).toBe(201);
      expect(res.body.table_id).toBeNull();
      expect(res.body.order_context).toBe("takeout");
    });
  });
});
```

### Step 2: Run tests

```bash
npx jest backend/tests/integration/pg-batch13-restaurant.test.js --verbose
```

### Step 3: Commit

```bash
git add backend/tests/integration/pg-batch13-restaurant.test.js
git commit -m "test(phase4): add restaurant integration tests — floor, tables, sessions, checks, KDS"
```

---

## Task 10: Appointment Schema (Migration v23)

**Files:**
- Modify: `backend/schema-pg.sql`
- Modify: `backend/migrate-pg.js`

### Step 1: Add appointment tables to schema-pg.sql

```sql
-- ═══════════════════════════════════════════════════════════════
-- Phase 4B — Appointment Booking
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_services (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  padding_minutes INTEGER DEFAULT 0,
  price NUMERIC(12,2) DEFAULT 0,
  outlet_id INTEGER REFERENCES outlets(id),
  is_active BOOLEAN DEFAULT TRUE,
  requires_confirmation BOOLEAN DEFAULT FALSE,
  max_advance_days INTEGER DEFAULT 90,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_service_variants (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_staff_assignments (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(service_id, employee_id)
);

CREATE TABLE IF NOT EXISTS booking_resources (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  name TEXT NOT NULL,
  resource_type TEXT DEFAULT 'room',
  capacity INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_resource_assignments (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES booking_resources(id) ON DELETE CASCADE,
  UNIQUE(service_id, resource_id)
);

CREATE TABLE IF NOT EXISTS booking_availability_rules (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  outlet_id INTEGER REFERENCES outlets(id),
  service_id INTEGER REFERENCES booking_services(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_availability_rules_employee ON booking_availability_rules(employee_id, day_of_week);

CREATE TABLE IF NOT EXISTS appointment_blocks (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  outlet_id INTEGER REFERENCES outlets(id),
  block_type TEXT NOT NULL DEFAULT 'unavailable' CHECK (block_type IN ('unavailable','break','closure')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appointment_blocks_employee ON appointment_blocks(employee_id, start_at, end_at);

CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id),
  variant_id INTEGER REFERENCES booking_service_variants(id),
  customer_id INTEGER REFERENCES customers(id),
  employee_id INTEGER REFERENCES employees(id),
  resource_id INTEGER REFERENCES booking_resources(id),
  outlet_id INTEGER REFERENCES outlets(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled','no_show')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  notes TEXT,
  source TEXT DEFAULT 'admin' CHECK (source IN ('admin','public','import')),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appointments_employee_time ON appointments(employee_id, start_at, end_at) WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

CREATE TABLE IF NOT EXISTS appointment_segments (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES booking_services(id),
  employee_id INTEGER REFERENCES employees(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_reminders (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL DEFAULT 'before' CHECK (reminder_type IN ('before','followup')),
  minutes_before INTEGER NOT NULL DEFAULT 60,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appointment_reminders_scheduled ON appointment_reminders(scheduled_for) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS appointment_waitlist_entries (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id),
  customer_id INTEGER REFERENCES customers(id),
  employee_id INTEGER REFERENCES employees(id),
  preferred_date DATE,
  preferred_time_start TIME,
  preferred_time_end TIME,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','booked','expired')),
  customer_name TEXT,
  customer_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_sessions (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id),
  employee_id INTEGER REFERENCES employees(id),
  outlet_id INTEGER REFERENCES outlets(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_session_bookings (
  id SERIAL PRIMARY KEY,
  class_session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id),
  appointment_id INTEGER REFERENCES appointments(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','no_show')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_sync_accounts (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  provider TEXT NOT NULL DEFAULT 'google',
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  calendar_id TEXT,
  sync_enabled BOOLEAN DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Step 2: Add migration v23

Add to `migrate-pg.js` after v22. Follow the same pattern — `CREATE TABLE IF NOT EXISTS` for each table, then indexes, then seed feature flags:

```javascript
{
  version: 23,
  description: "Phase 4B — appointment booking: services, availability, appointments, reminders, waitlist, classes",
  up: async (client) => {
    // [All the CREATE TABLE statements from Step 1, each in its own client.query()]
    // ... (same pattern as v22 — one CREATE TABLE per query, indexes after)

    // Seed feature flags
    await client.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_appointments', false),
        ('phase4_appointments_waitlists', false),
        ('phase4_appointments_classes', false),
        ('phase4_google_calendar_sync', false)
      ON CONFLICT (key) DO NOTHING
    `);
  },
},
```

### Step 3: Commit

```bash
git add backend/schema-pg.sql backend/migrate-pg.js
git commit -m "feat(phase4): add migration v23 — appointment booking schema"
```

---

## Task 11: Booking Domain Services

**Files:**
- Create: `backend/services/booking-services.js`
- Create: `backend/services/booking-availability.js`
- Create: `backend/services/booking-reminders.js`
- Create: `backend/schemas/bookings.js`

### Step 1: Create Zod schemas

Create `backend/schemas/bookings.js`:

```javascript
const { z } = require("zod");

const createServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  duration_minutes: z.number().int().positive(),
  padding_minutes: z.number().int().min(0).default(0),
  price: z.number().min(0).default(0),
  outlet_id: z.number().int().positive().optional(),
  requires_confirmation: z.boolean().default(false),
  max_advance_days: z.number().int().positive().default(90),
  staff_ids: z.array(z.number().int().positive()).optional(),
});

const updateServiceSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
  padding_minutes: z.number().int().min(0).optional(),
  price: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
  requires_confirmation: z.boolean().optional(),
  staff_ids: z.array(z.number().int().positive()).optional(),
});

const createAppointmentSchema = z.object({
  service_id: z.number().int().positive(),
  variant_id: z.number().int().positive().optional(),
  customer_id: z.number().int().positive().optional(),
  employee_id: z.number().int().positive().optional(),
  outlet_id: z.number().int().positive().optional(),
  start_at: z.string().min(1),
  customer_name: z.string().optional(),
  customer_phone: z.string().optional(),
  customer_email: z.string().email().optional(),
  notes: z.string().optional(),
});

const rescheduleSchema = z.object({
  start_at: z.string().min(1),
  employee_id: z.number().int().positive().optional(),
});

const cancelSchema = z.object({
  reason: z.string().optional(),
});

const availabilityQuerySchema = z.object({
  service_id: z.string().min(1),
  employee_id: z.string().optional(),
  date: z.string().min(1),
  outlet_id: z.string().optional(),
});

const publicBookingSchema = z.object({
  service_id: z.number().int().positive(),
  employee_id: z.number().int().positive().optional(),
  start_at: z.string().min(1),
  customer_name: z.string().min(1),
  customer_phone: z.string().min(1),
  customer_email: z.string().email().optional(),
  notes: z.string().optional(),
});

module.exports = {
  createServiceSchema, updateServiceSchema,
  createAppointmentSchema, rescheduleSchema, cancelSchema,
  availabilityQuerySchema, publicBookingSchema,
};
```

### Step 2: Create availability engine

Create `backend/services/booking-availability.js`:

```javascript
/**
 * Availability engine — search-first booking.
 * Builds available slots from rules, blocks, and existing appointments.
 */

async function getAvailableSlots(db, { serviceId, employeeId, date, outletId }) {
  // 1. Get service details
  const { rows: [service] } = await db.query(
    "SELECT * FROM booking_services WHERE id = $1 AND is_active = true",
    [serviceId]
  );
  if (!service) throw Object.assign(new Error("Service not found"), { statusCode: 404 });

  const duration = service.duration_minutes;
  const padding = service.padding_minutes || 0;
  const slotLength = duration + padding;
  const dayOfWeek = new Date(date).getDay();

  // 2. Get eligible staff
  let staffIds = [];
  if (employeeId) {
    staffIds = [Number(employeeId)];
  } else {
    const { rows: assignments } = await db.query(
      "SELECT employee_id FROM booking_staff_assignments WHERE service_id = $1",
      [serviceId]
    );
    staffIds = assignments.map(a => a.employee_id);
  }
  if (!staffIds.length) return [];

  // 3. For each staff member, compute available slots
  const allSlots = [];

  for (const sid of staffIds) {
    // Get availability rules for this day
    const { rows: rules } = await db.query(
      `SELECT start_time, end_time FROM booking_availability_rules
       WHERE employee_id = $1 AND day_of_week = $2 AND is_active = true`,
      [sid, dayOfWeek]
    );
    if (!rules.length) continue;

    // Get blocks for this date
    const dateStart = `${date}T00:00:00`;
    const dateEnd = `${date}T23:59:59`;
    const { rows: blocks } = await db.query(
      `SELECT start_at, end_at FROM appointment_blocks
       WHERE employee_id = $1 AND start_at < $3 AND end_at > $2`,
      [sid, dateStart, dateEnd]
    );

    // Get existing appointments for this date
    const { rows: existing } = await db.query(
      `SELECT start_at, end_at FROM appointments
       WHERE employee_id = $1 AND start_at::date = $2 AND status NOT IN ('cancelled','no_show')`,
      [sid, date]
    );

    // Build slots from each rule window
    for (const rule of rules) {
      const windowStart = parseTimeToMinutes(rule.start_time);
      const windowEnd = parseTimeToMinutes(rule.end_time);

      for (let m = windowStart; m + slotLength <= windowEnd; m += 15) {
        const slotStart = minutesToIso(date, m);
        const slotEnd = minutesToIso(date, m + duration);
        const slotEndPadded = minutesToIso(date, m + slotLength);

        // Check conflicts
        const blocked = blocks.some(b =>
          new Date(slotStart) < new Date(b.end_at) && new Date(slotEndPadded) > new Date(b.start_at)
        );
        const occupied = existing.some(a =>
          new Date(slotStart) < new Date(a.end_at) && new Date(slotEndPadded) > new Date(a.start_at)
        );

        if (!blocked && !occupied) {
          allSlots.push({
            employee_id: sid,
            start_at: slotStart,
            end_at: slotEnd,
            duration_minutes: duration,
          });
        }
      }
    }
  }

  return allSlots;
}

async function checkOverlap(db, employeeId, startAt, endAt, excludeAppointmentId = null) {
  const params = [employeeId, startAt, endAt];
  let exclude = "";
  if (excludeAppointmentId) {
    params.push(excludeAppointmentId);
    exclude = ` AND id != $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT id FROM appointments
     WHERE employee_id = $1 AND start_at < $3 AND end_at > $2
     AND status NOT IN ('cancelled','no_show')${exclude}`,
    params
  );
  return rows.length > 0;
}

// helpers
function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minutesToIso(date, minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${date}T${h}:${m}:00`;
}

module.exports = { getAvailableSlots, checkOverlap };
```

### Step 3: Create booking service

Create `backend/services/booking-services.js`:

```javascript
/**
 * Booking service CRUD and appointment lifecycle.
 */

async function createAppointment(db, data, source = "admin") {
  const { rows: [service] } = await db.query(
    "SELECT * FROM booking_services WHERE id = $1",
    [data.service_id]
  );
  if (!service) throw Object.assign(new Error("Service not found"), { statusCode: 404 });

  const startAt = new Date(data.start_at);
  const endAt = new Date(startAt.getTime() + service.duration_minutes * 60 * 1000);

  // Check overlap if employee assigned
  if (data.employee_id) {
    const { checkOverlap } = require("./booking-availability");
    const overlaps = await checkOverlap(db, data.employee_id, startAt.toISOString(), endAt.toISOString());
    if (overlaps) throw Object.assign(new Error("Time slot is already booked"), { statusCode: 409 });
  }

  const status = (source === "public" && service.requires_confirmation) ? "pending" : "confirmed";

  const { rows: [appt] } = await db.query(
    `INSERT INTO appointments (service_id, variant_id, customer_id, employee_id, outlet_id,
       status, start_at, end_at, customer_name, customer_phone, customer_email, notes, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [data.service_id, data.variant_id || null, data.customer_id || null,
     data.employee_id || null, data.outlet_id || service.outlet_id || null,
     status, startAt.toISOString(), endAt.toISOString(),
     data.customer_name || null, data.customer_phone || null, data.customer_email || null,
     data.notes || null, source]
  );

  // Schedule reminder
  if (data.customer_email || data.customer_phone) {
    const reminderTime = new Date(startAt.getTime() - 60 * 60 * 1000); // 1 hour before
    if (reminderTime > new Date()) {
      await db.query(
        `INSERT INTO appointment_reminders (appointment_id, minutes_before, channel, scheduled_for)
         VALUES ($1, 60, $2, $3)`,
        [appt.id, data.customer_email ? "email" : "sms", reminderTime.toISOString()]
      );
    }
  }

  return appt;
}

async function rescheduleAppointment(db, appointmentId, data) {
  const { rows: [appt] } = await db.query(
    "SELECT * FROM appointments WHERE id = $1",
    [appointmentId]
  );
  if (!appt) throw Object.assign(new Error("Appointment not found"), { statusCode: 404 });
  if (appt.status === "cancelled") throw Object.assign(new Error("Cannot reschedule cancelled appointment"), { statusCode: 400 });

  const { rows: [service] } = await db.query("SELECT duration_minutes FROM booking_services WHERE id = $1", [appt.service_id]);
  const newStart = new Date(data.start_at);
  const newEnd = new Date(newStart.getTime() + service.duration_minutes * 60 * 1000);
  const employeeId = data.employee_id || appt.employee_id;

  if (employeeId) {
    const { checkOverlap } = require("./booking-availability");
    const overlaps = await checkOverlap(db, employeeId, newStart.toISOString(), newEnd.toISOString(), appointmentId);
    if (overlaps) throw Object.assign(new Error("New time slot is already booked"), { statusCode: 409 });
  }

  const { rows: [updated] } = await db.query(
    `UPDATE appointments SET start_at = $1, end_at = $2, employee_id = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [newStart.toISOString(), newEnd.toISOString(), employeeId, appointmentId]
  );
  return updated;
}

async function cancelAppointment(db, appointmentId, reason) {
  const { rows: [appt] } = await db.query(
    `UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $2, updated_at = NOW()
     WHERE id = $1 AND status NOT IN ('cancelled','completed') RETURNING *`,
    [appointmentId, reason || null]
  );
  if (!appt) throw Object.assign(new Error("Appointment not found or already cancelled"), { statusCode: 404 });
  return appt;
}

module.exports = { createAppointment, rescheduleAppointment, cancelAppointment };
```

### Step 4: Create reminder service

Create `backend/services/booking-reminders.js`:

```javascript
/**
 * Booking reminder scheduler — uses pg-boss to send reminders.
 */

async function processPendingReminders(db, boss) {
  const { rows: reminders } = await db.query(
    `SELECT ar.*, a.customer_email, a.customer_phone, a.customer_name, a.start_at AS appt_start,
       bs.name AS service_name
     FROM appointment_reminders ar
     JOIN appointments a ON a.id = ar.appointment_id
     JOIN booking_services bs ON bs.id = a.service_id
     WHERE ar.status = 'pending' AND ar.scheduled_for <= NOW()
     AND a.status NOT IN ('cancelled','no_show')
     LIMIT 50`
  );

  for (const r of reminders) {
    try {
      if (r.channel === "email" && r.customer_email) {
        await boss.send("email", {
          to: r.customer_email,
          from: process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>",
          subject: `Reminder: ${r.service_name} appointment`,
          html: `<p>Hi ${r.customer_name || ""},</p><p>This is a reminder for your <b>${r.service_name}</b> appointment at ${new Date(r.appt_start).toLocaleString()}.</p>`,
        });
      }
      await db.query(
        "UPDATE appointment_reminders SET status = 'sent', sent_at = NOW() WHERE id = $1",
        [r.id]
      );
    } catch (err) {
      await db.query(
        "UPDATE appointment_reminders SET status = 'failed' WHERE id = $1",
        [r.id]
      );
    }
  }
  return reminders.length;
}

module.exports = { processPendingReminders };
```

### Step 5: Commit

```bash
git add backend/schemas/bookings.js backend/services/booking-services.js backend/services/booking-availability.js backend/services/booking-reminders.js
git commit -m "feat(phase4): add booking domain services — availability engine, appointment lifecycle, reminders"
```

---

## Task 12: Booking Backend Routes

**Files:**
- Create: `backend/routes/bookings.js`

### Step 1: Create booking routes

Create `backend/routes/bookings.js`:

```javascript
module.exports = function registerBookingRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createServiceSchema, updateServiceSchema, createAppointmentSchema, rescheduleSchema, cancelSchema } = require("../schemas/bookings");
  const { getAvailableSlots } = require("../services/booking-availability");
  const { createAppointment, rescheduleAppointment, cancelAppointment } = require("../services/booking-services");

  const gate = [requireFeature("phase4_appointments"), requirePerm("manage_bookings")];

  // ── Booking Services ─────────────────────────────────────────

  app.get("/api/booking-services", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        `SELECT bs.*,
           (SELECT json_agg(json_build_object('id', bsa.employee_id, 'name', e.name))
            FROM booking_staff_assignments bsa JOIN employees e ON e.id = bsa.employee_id
            WHERE bsa.service_id = bs.id) AS staff
         FROM booking_services bs ORDER BY bs.name`
      );
      res.json({ services: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/booking-services", ...gate, validate(createServiceSchema), async (req, res) => {
    try {
      const { staff_ids, ...data } = req.body;
      const { rows: [service] } = await deps.db.query(
        `INSERT INTO booking_services (name, description, duration_minutes, padding_minutes, price, outlet_id, requires_confirmation, max_advance_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [data.name, data.description || null, data.duration_minutes, data.padding_minutes, data.price, data.outlet_id || null, data.requires_confirmation, data.max_advance_days]
      );

      if (staff_ids?.length) {
        for (const eid of staff_ids) {
          await deps.db.query(
            "INSERT INTO booking_staff_assignments (service_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [service.id, eid]
          );
        }
      }
      res.status(201).json(service);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/booking-services/:id", ...gate, validate(updateServiceSchema), async (req, res) => {
    try {
      const { staff_ids, ...data } = req.body;
      const sets = []; const params = []; let idx = 0;
      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined) { idx++; sets.push(`${key} = $${idx}`); params.push(val); }
      }
      if (sets.length) {
        idx++; params.push(Number(req.params.id));
        sets.push("updated_at = NOW()");
        await deps.db.query(`UPDATE booking_services SET ${sets.join(", ")} WHERE id = $${idx}`, params);
      }
      if (staff_ids) {
        await deps.db.query("DELETE FROM booking_staff_assignments WHERE service_id = $1", [Number(req.params.id)]);
        for (const eid of staff_ids) {
          await deps.db.query("INSERT INTO booking_staff_assignments (service_id, employee_id) VALUES ($1, $2)", [Number(req.params.id), eid]);
        }
      }
      const { rows: [service] } = await deps.db.query("SELECT * FROM booking_services WHERE id = $1", [Number(req.params.id)]);
      res.json(service);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Availability ─────────────────────────────────────────────

  app.get("/api/appointments/availability", ...gate, async (req, res) => {
    try {
      const { service_id, employee_id, date, outlet_id } = req.query;
      if (!service_id || !date) return res.status(400).json({ error: "service_id and date required" });
      const slots = await getAvailableSlots(deps.db, { serviceId: Number(service_id), employeeId: employee_id ? Number(employee_id) : null, date, outletId: outlet_id ? Number(outlet_id) : null });
      res.json({ slots });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Appointments ─────────────────────────────────────────────

  app.get("/api/appointments", ...gate, async (req, res) => {
    try {
      const { from, to, status, employee_id } = req.query;
      const params = []; let idx = 0;
      let where = "1=1";
      if (from) { idx++; where += ` AND a.start_at >= $${idx}`; params.push(from); }
      if (to) { idx++; where += ` AND a.start_at <= $${idx}`; params.push(to); }
      if (status) { idx++; where += ` AND a.status = $${idx}`; params.push(status); }
      if (employee_id) { idx++; where += ` AND a.employee_id = $${idx}`; params.push(Number(employee_id)); }

      const { rows } = await deps.db.query(
        `SELECT a.*, bs.name AS service_name, e.name AS employee_name, c.name AS customer_display_name
         FROM appointments a
         JOIN booking_services bs ON bs.id = a.service_id
         LEFT JOIN employees e ON e.id = a.employee_id
         LEFT JOIN customers c ON c.id = a.customer_id
         WHERE ${where}
         ORDER BY a.start_at ASC`,
        params
      );
      res.json({ appointments: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/appointments/calendar", ...gate, async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: "from and to required" });
      const { rows } = await deps.db.query(
        `SELECT a.id, a.start_at, a.end_at, a.status, a.employee_id, a.customer_name,
           bs.name AS service_name, e.name AS employee_name
         FROM appointments a
         JOIN booking_services bs ON bs.id = a.service_id
         LEFT JOIN employees e ON e.id = a.employee_id
         WHERE a.start_at >= $1 AND a.start_at <= $2 AND a.status NOT IN ('cancelled')
         ORDER BY a.start_at`,
        [from, to]
      );
      res.json({ events: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/appointments", ...gate, validate(createAppointmentSchema), async (req, res) => {
    try {
      const appt = await createAppointment(deps.db, req.body, "admin");
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "appointment_created", JSON.stringify({ id: appt.id })]); } catch {}
      res.status(201).json(appt);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/appointments/:id", ...gate, async (req, res) => {
    try {
      const sets = []; const params = []; let idx = 0;
      for (const [key, val] of Object.entries(req.body)) {
        if (val !== undefined && ["status", "notes", "employee_id"].includes(key)) {
          idx++; sets.push(`${key} = $${idx}`); params.push(val);
        }
      }
      if (!sets.length) return res.status(400).json({ error: "No fields to update" });
      idx++; params.push(Number(req.params.id));
      sets.push("updated_at = NOW()");
      const { rows: [appt] } = await deps.db.query(
        `UPDATE appointments SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
      );
      if (!appt) return res.status(404).json({ error: "Appointment not found" });
      res.json(appt);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/appointments/:id/reschedule", ...gate, validate(rescheduleSchema), async (req, res) => {
    try {
      const appt = await rescheduleAppointment(deps.db, Number(req.params.id), req.body);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "appointment_rescheduled", JSON.stringify({ id: appt.id })]); } catch {}
      res.json(appt);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/appointments/:id/cancel", ...gate, validate(cancelSchema), async (req, res) => {
    try {
      const appt = await cancelAppointment(deps.db, Number(req.params.id), req.body.reason);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "appointment_cancelled", JSON.stringify({ id: appt.id })]); } catch {}
      res.json(appt);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
```

### Step 2: Commit

```bash
git add backend/routes/bookings.js
git commit -m "feat(phase4): add booking backend routes — services, availability, appointments"
```

---

## Task 13: Public Booking Routes

**Files:**
- Create: `backend/routes/public-bookings.js`

### Step 1: Create public booking routes

Create `backend/routes/public-bookings.js`:

```javascript
const { resolvePublicTenantDb } = require("../services/public-tenant-context");

module.exports = function registerPublicBookingRoutes(app, deps) {

  // GET /api/public/bookings/config — public booking page config
  app.get("/api/public/bookings/config", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows: [profile] } = await db.query(
        "SELECT company_name, logo_url, currency_symbol FROM company_profile LIMIT 1"
      );

      const { rows: services } = await db.query(
        `SELECT bs.id, bs.name, bs.description, bs.duration_minutes, bs.price,
           (SELECT json_agg(json_build_object('id', e.id, 'name', e.name))
            FROM booking_staff_assignments bsa JOIN employees e ON e.id = bsa.employee_id
            WHERE bsa.service_id = bs.id) AS staff
         FROM booking_services bs
         WHERE bs.is_active = true
         ORDER BY bs.name`
      );

      res.json({
        company_name: profile?.company_name || "",
        logo_url: profile?.logo_url || null,
        currency_symbol: profile?.currency_symbol || "Rs",
        services,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/public/bookings/availability — public slot search
  app.get("/api/public/bookings/availability", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { service_id, employee_id, date } = req.query;
      if (!service_id || !date) return res.status(400).json({ error: "service_id and date required" });

      const { getAvailableSlots } = require("../services/booking-availability");
      const slots = await getAvailableSlots(db, {
        serviceId: Number(service_id),
        employeeId: employee_id ? Number(employee_id) : null,
        date,
      });
      res.json({ slots });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/bookings — create public booking
  app.post("/api/public/bookings", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { service_id, employee_id, start_at, customer_name, customer_phone, customer_email, notes } = req.body || {};
      if (!service_id || !start_at || !customer_name || !customer_phone) {
        return res.status(400).json({ error: "service_id, start_at, customer_name, customer_phone required" });
      }

      const { createAppointment } = require("../services/booking-services");
      const appt = await createAppointment(db, {
        service_id, employee_id, start_at, customer_name, customer_phone, customer_email, notes,
      }, "public");

      res.status(201).json({
        id: appt.id,
        status: appt.status,
        start_at: appt.start_at,
        end_at: appt.end_at,
        message: appt.status === "pending" ? "Your booking is pending confirmation" : "Your booking is confirmed",
      });
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
    }
  });
};
```

### Step 2: Commit

```bash
git add backend/routes/public-bookings.js
git commit -m "feat(phase4): add public booking routes — config, availability search, booking create"
```

---

## Task 14: Booking Frontend Pages

Same pattern as Task 7. Create:
- `frontend/src/pages/redesign/AppointmentServicesRedesign.jsx` — service catalog management
- `frontend/src/pages/redesign/AppointmentsCalendarRedesign.jsx` — week/day calendar view
- `frontend/src/pages/redesign/AppointmentsRedesign.jsx` — appointment list with filters

All check `flags.phase4_appointments` and use `api.get`/`api.post`.

> **Commit** after creating all three.

---

## Task 15: Booking Integration Tests

**Files:**
- Create: `backend/tests/integration/pg-batch14-bookings.test.js`

Test scenarios:
- Service CRUD
- Availability search returns valid slots
- Appointment creation succeeds in available slot
- Double-booking is rejected (409)
- Reschedule updates time and checks overlap
- Cancel sets status correctly
- Public booking creates with "pending" status when confirmation required
- Reminder is scheduled

> **Commit** after tests pass.

---

## Task 16: Service Workspace Schema (Migration v24)

**Files:**
- Modify: `backend/schema-pg.sql`
- Modify: `backend/migrate-pg.js`

Add tables: `service_projects`, `project_contacts`, `project_milestones`, `project_activities`, `contract_templates`, `contracts`, `contract_signers`, `contract_events`, `project_files`.

Extend: `quotations` (+project_id, estimate_status, approved_at, approved_by), `customer_invoices` (+project_id, milestone_id, invoice_kind), `customer_subscriptions` (+project_id, billing_template_id).

Seed flags: `phase4_service_projects`, `phase4_service_contracts`, `phase4_contract_ai`.

Follow the exact same migration pattern as v22/v23.

> **Commit** after adding migration.

---

## Task 17: Project & Contract Domain Services

**Files:**
- Create: `backend/services/projects.js`
- Create: `backend/services/contracts.js`
- Create: `backend/services/project-billing.js`
- Create: `backend/schemas/projects.js`
- Create: `backend/schemas/contracts.js`

Key behaviors:
- Project CRUD with activity logging
- Quotation approval (changes `estimate_status` on quotations)
- Quotation → project conversion
- Milestone creation with billing linkage
- Contract generation from templates, signature capture, audit events

> **Commit** after creating services.

---

## Task 18: Service Workspace Backend Routes

**Files:**
- Create: `backend/routes/projects.js`
- Create: `backend/routes/contracts.js`

Key routes:
- `GET/POST/PUT /api/projects` + `/:id` + `/milestones`
- `POST /api/quotations/:id/approve`
- `POST /api/quotations/:id/convert-to-project`
- `POST /api/customer-invoices/:id/attach-to-project`
- `GET/POST/PUT /api/contracts` + `/:id/send` + `/:id/sign`

All gated by `phase4_service_projects` or `phase4_service_contracts`.

> **Commit** after creating routes.

---

## Task 19: Service Workspace Frontend Pages

**Files:**
- Create: `frontend/src/pages/redesign/ProjectsRedesign.jsx`
- Create: `frontend/src/pages/redesign/ContractsRedesign.jsx`

ProjectsRedesign shows:
- Project list and detail workspace
- Milestones panel
- Linked estimates, invoices, subscriptions

ContractsRedesign shows:
- Contract list with template picker
- Signer state tracking

> **Commit** after creating pages.

---

## Task 20: Service Workspace Integration Tests

**Files:**
- Create: `backend/tests/integration/pg-batch15-service-workspace.test.js`

Test scenarios:
- Quotation approval changes estimate_status
- Quotation converts to project
- Milestone creation links to project
- Invoice attaches to project/milestone
- Contract create/send/sign audit trail
- Feature flag disabled behavior

> **Commit** after tests pass.

---

## Task 21: Permissions, Audit, and Docs Update

**Files:**
- Modify: `CLAUDE.md`
- Modify: `backend/CLAUDE.md`
- Modify: `frontend/CLAUDE.md`

### Required updates:
- Add migrations v22, v23, v24 to migration version note
- Add new feature flags to the registry table
- Add new routes to the route tree
- Add new frontend pages to the page structure
- Add new permission areas to the permissions table
- Add new service modules to the lookup table
- Update current version reference from v17 to v24

> **Commit** after docs update.

---

## Summary

| Phase | Tasks | New Tables | New Routes | New Frontend Pages |
|-------|-------|------------|------------|--------------------|
| Shared | 1, 3 | 0 | 0 | 9 route wrappers |
| 4A Restaurant | 2, 4, 5, 6, 7, 8, 9 | 14 | ~22 | 4 pages |
| 4B Bookings | 10, 11, 12, 13, 14, 15 | 14 | ~15 | 3 pages |
| 4C Service | 16, 17, 18, 19, 20 | 9 + 3 extensions | ~14 | 2 pages |
| Cross-cutting | 21 | 0 | 0 | 0 |

Total: ~37 new tables, ~51 new API endpoints, 9 new frontend pages, 3 new migrations.
