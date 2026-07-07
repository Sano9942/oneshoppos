#!/usr/bin/env node
/**
 * Marketing screenshot demo-data seeder — LOCAL ONLY.
 *
 * Seeds believable demo data into the local golv_* test tenants (sanopos_dev)
 * so the marketing-site screenshots show a working product, not empty tables.
 * Also renames each tenant's company profile to a neutral brand name and USD
 * so screenshots read globally (local copies only; prod tenants untouched).
 *
 * Usage: node tools/marketing-seed/seed.mjs [tenant-slug ...]
 *        (no args = all tenants)
 */

const BASE = "http://localhost:5000";
const PASS = "1234";

const log = (...a) => console.log(...a);
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => new Date(today.getTime() + n * 86400000);
const at = (dayOffset, h, m = 0) => {
  const d = addDays(dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

async function login(slug) {
  const r = await fetch(`${BASE}/api/auth/mt-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_slug: slug, username: "Owner", password: PASS }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${slug}: ${JSON.stringify(j)}`);
  return j.token;
}

function client(slug, token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}tenant=${slug}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-outlet-id": "1",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch { /* empty body */ }
    if (!r.ok) {
      const err = new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j)}`);
      err.status = r.status;
      err.body = j;
      throw err;
    }
    return j;
  };
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b),
    put: (p, b) => call("PUT", p, b),
  };
}

async function brand(api, company_name) {
  await api.put("/api/company-profile", {
    company_name,
    currency_symbol: "$",
    currency_code: "USD",
  });
  log(`  ✓ branded as "${company_name}" (USD)`);
}

async function ensureProducts(api, defs) {
  const existing = await api.get("/api/products");
  const rows = existing.products || existing;
  if (Array.isArray(rows) && rows.length >= defs.length) {
    log(`  = products already seeded (${rows.length})`);
    return rows;
  }
  const created = [];
  for (const p of defs) {
    try {
      created.push((await api.post("/api/products", p)).product || (await 0));
    } catch (e) {
      log(`  ! product "${p.name}": ${e.message.slice(0, 200)}`);
    }
  }
  const after = await api.get("/api/products");
  const list = after.products || after;
  log(`  ✓ products: ${Array.isArray(list) ? list.length : "?"}`);
  return list;
}

async function ensureCustomers(api, names) {
  const existing = await api.get("/api/customers");
  const rows = existing.customers || existing;
  if (Array.isArray(rows) && rows.length >= names.length) {
    log(`  = customers already seeded (${rows.length})`);
    return rows;
  }
  for (const n of names) {
    try {
      await api.post("/api/customers", n);
    } catch (e) {
      log(`  ! customer "${n.name}": ${e.message.slice(0, 200)}`);
    }
  }
  const after = await api.get("/api/customers");
  const list = after.customers || after;
  log(`  ✓ customers: ${Array.isArray(list) ? list.length : "?"}`);
  return list;
}

/* ─────────────────────────── tenants ─────────────────────────── */

const SEEDERS = {
  async golv_general_retail(api) {
    await brand(api, "Everline Market");
    const products = await ensureProducts(api, [
      { name: "Soy Candle — Cedar & Sage", price: 18, sku: "CNDL-001", stock: 42 },
      { name: "Ceramic Mug — Matte White", price: 14, sku: "MUG-014", stock: 65 },
      { name: "Linen Tea Towel Set", price: 22, sku: "TWL-203", stock: 30 },
      { name: "Hardcover Notebook A5", price: 12, sku: "NTB-118", stock: 88 },
      { name: "Olive Wood Serving Board", price: 34, sku: "BRD-076", stock: 18 },
      { name: "Stainless Water Bottle 750ml", price: 26, sku: "BTL-330", stock: 54 },
      { name: "Beeswax Wrap 3-Pack", price: 16, sku: "WRP-045", stock: 40 },
      { name: "Cotton Tote — Natural", price: 9, sku: "TOT-002", stock: 120 },
      { name: "Desk Organizer — Oak", price: 28, sku: "ORG-091", stock: 22 },
      { name: "Scented Diffuser — Fig", price: 24, sku: "DIF-055", stock: 35 },
      { name: "Wool Throw Blanket", price: 58, sku: "THR-012", stock: 12 },
      { name: "Glass Storage Jar 1L", price: 11, sku: "JAR-140", stock: 73 },
    ]);
    await ensureCustomers(api, [
      { name: "Maya Chen", phone: "5550101", email: "maya@example.com" },
      { name: "Daniel Okafor", phone: "5550102" },
      { name: "Sara Whitfield", phone: "5550103" },
    ]);
    // open a shift so the POS is usable for screenshots + make a few sales
    let shift;
    try {
      shift = await api.post("/api/shifts/open", { outlet_id: 1, opening_float: 200 });
      log("  ✓ shift opened");
    } catch (e) {
      log(`  = shift: ${String(e.message).slice(0, 160)}`);
    }
    try {
      await api.post("/api/attendance/pin-checkin", { pin_code: PASS, outlet_id: 1 });
      log("  ✓ clocked in");
    } catch (e) {
      log(`  = clock-in: ${String(e.message).slice(0, 160)}`);
    }
    const list = Array.isArray(products) ? products : [];
    if (list.length >= 3) {
      const pick = (i, qty) => ({
        id: list[i].id,
        price: Number(list[i].price),
        quantity: qty,
        name: list[i].name,
      });
      for (const items of [
        [pick(0, 1), pick(1, 2)],
        [pick(3, 3)],
        [pick(4, 1), pick(5, 1), pick(7, 2)],
      ]) {
        const total = items.reduce((s, it) => s + it.price * it.quantity, 0);
        try {
          await api.post("/api/sales", {
            cartItems: items,
            total,
            subtotal: total,
            payment_method: "cash",
            outlet_id: 1,
          });
        } catch (e) {
          log(`  ! sale: ${String(e.message).slice(0, 220)}`);
        }
      }
      log("  ✓ sales attempted");
    }
  },

  async golv_restaurant(api) {
    await brand(api, "Saffron House");
    await ensureProducts(api, [
      { name: "Charred Chicken Skewers", price: 12.5 },
      { name: "Lamb Kofta Plate", price: 16 },
      { name: "Saffron Rice Bowl", price: 9 },
      { name: "Grilled Halloumi Salad", price: 11 },
      { name: "Beef Smash Burger", price: 13.5 },
      { name: "Wood-Fired Flatbread", price: 8 },
      { name: "Harissa Prawns", price: 17 },
      { name: "Lemon Mint Cooler", price: 4.5 },
      { name: "Cardamom Creme Brulee", price: 7 },
      { name: "Pistachio Baklava", price: 6.5 },
    ]);
    // floor plan + tables
    const plans = await api.get("/api/restaurant/floor-plans");
    const existing = plans.floor_plans || plans;
    let planId;
    if (Array.isArray(existing) && existing.length > 0) {
      planId = existing[0].id;
      log(`  = floor plan exists (#${planId})`);
    } else {
      const fp = await api.post("/api/restaurant/floor-plans", { name: "Main Dining", outlet_id: 1 });
      planId = fp.floor_plan?.id ?? fp.id;
    }
    const detail = await api.get(`/api/restaurant/floor-plans/${planId}`);
    const existingTables = detail.tables || detail.floor_plan?.tables || [];
    if (Array.isArray(existingTables) && existingTables.length >= 8) {
      log(`  = tables exist (${existingTables.length})`);
      return;
    }
    const tables = [
      ["T1", 2, 60, 60], ["T2", 2, 200, 60], ["T3", 4, 340, 60], ["T4", 4, 480, 60],
      ["T5", 4, 60, 220], ["T6", 6, 220, 220], ["T7", 6, 420, 220],
      ["B1", 8, 60, 380], ["P1", 4, 300, 380], ["P2", 2, 480, 380],
    ];
    for (const [label, seats, x, y] of tables) {
      try {
        await api.post("/api/restaurant/tables", {
          floor_plan_id: planId, label, name: label, seats, pos_x: x, pos_y: y, x, y,
        });
      } catch (e) {
        log(`  ! table ${label}: ${String(e.message).slice(0, 180)}`);
      }
    }
    log("  ✓ floor plan + tables");
  },

  async golv_salon(api) {
    await brand(api, "Velvet & Vine Salon");
    const services = [
      { name: "Signature Haircut & Style", price: 55, duration_minutes: 45 },
      { name: "Full Balayage", price: 180, duration_minutes: 150 },
      { name: "Root Touch-Up", price: 85, duration_minutes: 75 },
      { name: "Deep Conditioning Ritual", price: 40, duration_minutes: 30 },
      { name: "Classic Manicure", price: 30, duration_minutes: 40 },
      { name: "Bridal Trial", price: 120, duration_minutes: 90 },
    ];
    let svcList;
    try {
      const existing = await api.get("/api/booking-services");
      svcList = existing.services || existing;
      if (!Array.isArray(svcList) || svcList.length < services.length) {
        for (const s of services) {
          try { await api.post("/api/booking-services", s); }
          catch (e) { log(`  ! service: ${String(e.message).slice(0, 200)}`); }
        }
        const after = await api.get("/api/booking-services");
        svcList = after.services || after;
      }
      log(`  ✓ services: ${svcList.length}`);
    } catch (e) {
      log(`  ! services: ${String(e.message).slice(0, 200)}`);
      return;
    }
    const customers = await ensureCustomers(api, [
      { name: "Amelia Ross", phone: "5550201" },
      { name: "Priya Nair", phone: "5550202" },
      { name: "Charlotte King", phone: "5550203" },
      { name: "Zoe Almeida", phone: "5550204" },
      { name: "Hana Suzuki", phone: "5550205" },
    ]);
    // appointments across today
    const appts = await api.get("/api/appointments");
    const apptList = appts.appointments || appts;
    if (Array.isArray(apptList) && apptList.length >= 5) {
      log(`  = appointments exist (${apptList.length})`);
      return;
    }
    const custs = Array.isArray(customers) ? customers : [];
    const svcs = Array.isArray(svcList) ? svcList : [];
    const slots = [[0, 10, 0], [0, 11, 30], [0, 13, 0], [0, 14, 30], [0, 16, 0], [1, 10, 30]];
    for (let i = 0; i < slots.length && i < custs.length * 2; i++) {
      const [d, h, m] = slots[i];
      const svc = svcs[i % svcs.length];
      try {
        await api.post("/api/appointments", {
          customer_id: custs[i % custs.length].id,
          service_id: svc.id,
          employee_id: 1,
          start_at: at(d, h, m),
          duration_minutes: svc.duration_minutes || 45,
        });
      } catch (e) {
        log(`  ! appt: ${String(e.message).slice(0, 220)}`);
      }
    }
    log("  ✓ appointments attempted");
  },

  async golv_dental_clinic(api) {
    await brand(api, "Brightside Dental");
    const customers = await ensureCustomers(api, [
      { name: "Jonas Petersen", phone: "5550301" },
      { name: "Fatima Al-Rashid", phone: "5550302" },
      { name: "Miguel Santos", phone: "5550303" },
    ]);
    const custs = Array.isArray(customers) ? customers : [];
    // patient subjects
    let subjects = [];
    try {
      const ex = await api.get("/api/patient-subjects");
      subjects = ex.subjects || ex;
      if (!Array.isArray(subjects) || subjects.length < custs.length) {
        for (const c of custs) {
          try {
            await api.post("/api/patient-subjects", {
              customer_id: c.id, subject_type: "self", name: c.name,
            });
          } catch (e) { log(`  ! subject: ${String(e.message).slice(0, 200)}`); }
        }
        const after = await api.get("/api/patient-subjects");
        subjects = after.subjects || after;
      }
      log(`  ✓ patient subjects: ${subjects.length}`);
    } catch (e) {
      log(`  ! subjects: ${String(e.message).slice(0, 200)}`);
      return;
    }
    // treatment plans
    try {
      const plansEx = await api.get("/api/treatment-plans");
      const plansList = plansEx.plans || plansEx;
      if (Array.isArray(plansList) && plansList.length >= 2) {
        log(`  = plans exist (${plansList.length})`);
        return;
      }
      const defs = [
        { title: "Full Mouth Rehabilitation — Phase 1", sessions: 6 },
        { title: "Invisalign Treatment Course", sessions: 10 },
        { title: "Wisdom Tooth Extraction + Follow-up", sessions: 2 },
      ];
      for (let i = 0; i < defs.length && i < subjects.length; i++) {
        try {
          const p = await api.post("/api/treatment-plans", {
            customer_id: custs[i].id,
            subject_id: subjects[i].id,
            patient_subject_id: subjects[i].id,
            title: defs[i].title,
            name: defs[i].title,
            planned_sessions: defs[i].sessions,
            total_sessions: defs[i].sessions,
          });
          const planId = p.plan?.id ?? p.id;
          if (planId) {
            try { await api.post(`/api/treatment-plans/${planId}/activate`, {}); } catch {}
          }
        } catch (e) {
          log(`  ! plan: ${String(e.message).slice(0, 240)}`);
        }
      }
      log("  ✓ treatment plans attempted");
    } catch (e) {
      log(`  ! plans: ${String(e.message).slice(0, 200)}`);
    }
  },

  async golv_gym(api) {
    await brand(api, "Ironworks Fitness");
    // class-type services
    const services = [
      { name: "HIIT Circuit", price: 15, duration_minutes: 45, is_class: true, capacity: 14 },
      { name: "Strength Foundations", price: 18, duration_minutes: 60, is_class: true, capacity: 10 },
      { name: "Spin Express", price: 12, duration_minutes: 30, is_class: true, capacity: 16 },
      { name: "Mobility & Core", price: 12, duration_minutes: 45, is_class: true, capacity: 12 },
    ];
    let svcList = [];
    try {
      const ex = await api.get("/api/booking-services");
      svcList = ex.services || ex;
      if (!Array.isArray(svcList) || svcList.length < services.length) {
        for (const s of services) {
          try { await api.post("/api/booking-services", s); }
          catch (e) { log(`  ! service: ${String(e.message).slice(0, 200)}`); }
        }
        const after = await api.get("/api/booking-services");
        svcList = after.services || after;
      }
    } catch (e) { log(`  ! services: ${String(e.message).slice(0, 160)}`); }
    // class sessions this week
    try {
      const sess = await api.get("/api/classes/sessions");
      const sessList = sess.sessions || sess;
      if (Array.isArray(sessList) && sessList.length >= 4) {
        log(`  = class sessions exist (${sessList.length})`);
      } else {
        const slots = [[0, 7, 0], [0, 12, 15], [0, 18, 0], [1, 7, 0], [1, 18, 30], [2, 9, 0]];
        for (let i = 0; i < slots.length; i++) {
          const [d, h, m] = slots[i];
          const svc = svcList[i % Math.max(svcList.length, 1)];
          if (!svc) break;
          try {
            const startAt = at(d, h, m);
            const endAt = new Date(new Date(startAt).getTime() + (svc.duration_minutes || 45) * 60000).toISOString();
            await api.post("/api/classes/sessions", {
              service_id: svc.id,
              employee_id: 1,
              start_at: startAt,
              end_at: endAt,
              capacity: svc.capacity || 12,
            });
          } catch (e) {
            log(`  ! session: ${String(e.message).slice(0, 240)}`);
          }
        }
        log("  ✓ class sessions attempted");
      }
    } catch (e) { log(`  ! sessions: ${String(e.message).slice(0, 160)}`); }
    await ensureCustomers(api, [
      { name: "Tom Becker", phone: "5550401" },
      { name: "Lena Fischer", phone: "5550402" },
      { name: "Ravi Patel", phone: "5550403" },
    ]);
  },

  async golv_wholesale(api) {
    await brand(api, "Crestline Distribution");
    await ensureProducts(api, [
      { name: "Dish Soap 500ml — Case of 24", price: 38, sku: "WH-1001", stock: 300 },
      { name: "Paper Towels 2-Ply — Case of 12", price: 22, sku: "WH-1002", stock: 250 },
      { name: "Basmati Rice 5kg — Bale of 8", price: 96, sku: "WH-1003", stock: 120 },
      { name: "Sunflower Oil 1L — Case of 12", price: 42, sku: "WH-1004", stock: 180 },
      { name: "Black Tea 200g — Case of 48", price: 110, sku: "WH-1005", stock: 90 },
      { name: "Laundry Powder 3kg — Case of 6", price: 54, sku: "WH-1006", stock: 140 },
    ]);
    const customers = await ensureCustomers(api, [
      { name: "GreenLeaf Mini Mart", phone: "5550501" },
      { name: "Sunrise General Store", phone: "5550502" },
      { name: "Hilltop Traders", phone: "5550503" },
      { name: "Bluebird Superette", phone: "5550504" },
    ]);
    // credit limits + terms
    const custs = Array.isArray(customers) ? customers : [];
    for (const [i, c] of custs.entries()) {
      try {
        await api.put(`/api/customers/${c.id}`, {
          name: c.name,
          credit_limit: [5000, 3000, 8000, 2000][i % 4],
          payment_terms_days: [30, 15, 45, 30][i % 4],
        });
      } catch (e) {
        log(`  ! credit ${c.name}: ${String(e.message).slice(0, 180)}`);
      }
    }
    log("  ✓ credit limits attempted");
  },

  async golv_car_rental(api) {
    await brand(api, "Metro Car Hire");
    let items = [];
    try {
      const ex = await api.get("/api/rental-items");
      items = ex.items || ex.rental_items || ex;
      const defs = [
        { name: "Toyota Corolla — Compact Sedan", daily_rate: 45, rate_daily: 45 },
        { name: "Honda CR-V — Mid-size SUV", daily_rate: 68, rate_daily: 68 },
        { name: "Kia Carnival — 7-Seat Van", daily_rate: 85, rate_daily: 85 },
        { name: "Suzuki Swift — Economy", daily_rate: 35, rate_daily: 35 },
      ];
      if (!Array.isArray(items) || items.length < defs.length) {
        for (const d of defs) {
          try {
            const it = await api.post("/api/rental-items", d);
            const itemId = it.item?.id ?? it.id;
            if (itemId) {
              for (const plate of ["A", "B"]) {
                try {
                  await api.post(`/api/rental-items/${itemId}/assets`, {
                    identifier: `${d.name.split(" ")[0].toUpperCase()}-${itemId}${plate}`,
                    label: `${d.name.split(" —")[0]} ${plate}`,
                  });
                } catch {}
              }
            }
          } catch (e) {
            log(`  ! rental item: ${String(e.message).slice(0, 240)}`);
          }
        }
        const after = await api.get("/api/rental-items");
        items = after.items || after.rental_items || after;
      }
      log(`  ✓ rental items: ${Array.isArray(items) ? items.length : "?"}`);
    } catch (e) {
      log(`  ! rental items: ${String(e.message).slice(0, 200)}`);
      return;
    }
    const customers = await ensureCustomers(api, [
      { name: "Oliver Grant", phone: "5550601" },
      { name: "Nadia Hassan", phone: "5550602" },
    ]);
    // contracts
    try {
      const ex = await api.get("/api/rental-contracts");
      const contracts = ex.contracts || ex;
      if (Array.isArray(contracts) && contracts.length >= 2) {
        log(`  = contracts exist (${contracts.length})`);
        return;
      }
      const custs = Array.isArray(customers) ? customers : [];
      const list = Array.isArray(items) ? items : [];
      for (let i = 0; i < 2 && i < custs.length && i < list.length; i++) {
        try {
          const c = await api.post("/api/rental-contracts", {
            customer_id: custs[i].id,
            rental_start: at(i === 0 ? 0 : 1, 9),
            expected_return: at(i === 0 ? 3 : 5, 17),
            lines: [{ rental_item_id: list[i].id, quantity: 1, duration_value: i === 0 ? 3 : 4, duration_unit: "day" }],
          });
          const cid = c.contract?.id ?? c.id;
          if (cid && i === 0) {
            try { await api.post(`/api/rental-contracts/${cid}/confirm`, {}); } catch {}
          }
        } catch (e) {
          log(`  ! contract: ${String(e.message).slice(0, 260)}`);
        }
      }
      log("  ✓ contracts attempted");
    } catch (e) {
      log(`  ! contracts: ${String(e.message).slice(0, 200)}`);
    }
  },

  async golv_hotel(api) {
    await brand(api, "The Juniper Hotel");
    // room types + rooms
    let types = [];
    try {
      const ex = await api.get("/api/room-types");
      types = ex.room_types || ex.types || ex;
      const defs = [
        { name: "Standard Queen", base_rate: 89, rate: 89 },
        { name: "Deluxe King", base_rate: 129, rate: 129 },
        { name: "Junior Suite", base_rate: 189, rate: 189 },
      ];
      if (!Array.isArray(types) || types.length < defs.length) {
        for (const d of defs) {
          try { await api.post("/api/room-types", d); }
          catch (e) { log(`  ! room type: ${String(e.message).slice(0, 220)}`); }
        }
        const after = await api.get("/api/room-types");
        types = after.room_types || after.types || after;
      }
      log(`  ✓ room types: ${Array.isArray(types) ? types.length : "?"}`);
    } catch (e) {
      log(`  ! room types: ${String(e.message).slice(0, 200)}`);
      return;
    }
    try {
      const ex = await api.get("/api/rooms");
      const rooms = ex.rooms || ex;
      if (!Array.isArray(rooms) || rooms.length < 8) {
        const tlist = Array.isArray(types) ? types : [];
        const names = ["101", "102", "103", "104", "201", "202", "203", "301"];
        for (const [i, n] of names.entries()) {
          const t = tlist[i < 4 ? 0 : i < 7 ? 1 : 2] || tlist[0];
          if (!t) break;
          try {
            await api.post("/api/rooms", { room_type_id: t.id, room_number: n, name: n });
          } catch (e) {
            log(`  ! room ${n}: ${String(e.message).slice(0, 200)}`);
          }
        }
      }
      const after = await api.get("/api/rooms");
      const roomList = after.rooms || after;
      log(`  ✓ rooms: ${Array.isArray(roomList) ? roomList.length : "?"}`);
      // bookings
      const bex = await api.get("/api/room-bookings");
      const bookings = bex.bookings || bex;
      if (Array.isArray(bookings) && bookings.length >= 3) {
        log(`  = bookings exist (${bookings.length})`);
        return;
      }
      const customers = await ensureCustomers(api, [
        { name: "Elena Marsh", phone: "5550701" },
        { name: "Kofi Mensah", phone: "5550702" },
        { name: "Isabelle Laurent", phone: "5550703" },
      ]);
      const custs = Array.isArray(customers) ? customers : [];
      const rlist = Array.isArray(roomList) ? roomList : [];
      const stays = [[0, 2], [0, 3], [1, 4]];
      for (let i = 0; i < stays.length && i < custs.length && i < rlist.length; i++) {
        try {
          const b = await api.post("/api/room-bookings", {
            room_id: rlist[i].id,
            room_type_id: rlist[i].room_type_id,
            customer_id: custs[i].id,
            guest_name: custs[i].name,
            check_in: iso(addDays(stays[i][0])),
            check_out: iso(addDays(stays[i][1])),
            check_in_date: iso(addDays(stays[i][0])),
            check_out_date: iso(addDays(stays[i][1])),
            adults: 2,
          });
          const bid = b.booking?.id ?? b.id;
          if (bid) {
            try { await api.post(`/api/room-bookings/${bid}/confirm`, {}); } catch {}
            if (i === 0) {
              try { await api.post(`/api/room-bookings/${bid}/checkin`, {}); } catch {}
            }
          }
        } catch (e) {
          log(`  ! booking: ${String(e.message).slice(0, 260)}`);
        }
      }
      log("  ✓ bookings attempted");
    } catch (e) {
      log(`  ! rooms: ${String(e.message).slice(0, 200)}`);
    }
  },

  async golv_repair_shop(api) {
    await brand(api, "Circuit City Repairs");
    const customers = await ensureCustomers(api, [
      { name: "Marcus Webb", phone: "5550801" },
      { name: "Aisha Bello", phone: "5550802" },
      { name: "Leo Tanaka", phone: "5550803" },
      { name: "Grace O'Connor", phone: "5550804" },
      { name: "Ethan Brooks", phone: "5550805" },
    ]);
    try {
      const ex = await api.get("/api/service-tickets");
      const tickets = ex.tickets || ex;
      if (Array.isArray(tickets) && tickets.length >= 5) {
        log(`  = tickets exist (${tickets.length})`);
        return;
      }
      const custs = Array.isArray(customers) ? customers : [];
      const defs = [
        { title: "iPhone 14 — cracked screen replacement", status: "in_progress" },
        { title: "MacBook Air — battery swap", status: "in_progress" },
        { title: "Samsung TV 55\" — no picture, diagnostics", status: "open" },
        { title: "PlayStation 5 — HDMI port repair", status: "ready" },
        { title: "Dell XPS 13 — keyboard replacement", status: "open" },
      ];
      for (let i = 0; i < defs.length && i < custs.length; i++) {
        try {
          await api.post("/api/service-tickets", {
            customer_id: custs[i].id,
            title: defs[i].title,
            subject: defs[i].title,
            description: defs[i].title,
            issue: defs[i].title,
          });
        } catch (e) {
          log(`  ! ticket: ${String(e.message).slice(0, 260)}`);
        }
      }
      log("  ✓ tickets attempted");
    } catch (e) {
      log(`  ! tickets: ${String(e.message).slice(0, 200)}`);
    }
  },

  async golv_photography_studio(api) {
    await brand(api, "North Light Studio");
    const customers = await ensureCustomers(api, [
      { name: "Harper & James Wedding", phone: "5550901" },
      { name: "Bloom Cosmetics (Brand)", phone: "5550902" },
      { name: "The Ortiz Family", phone: "5550903" },
    ]);
    try {
      const ex = await api.get("/api/projects");
      const projects = ex.projects || ex;
      if (Array.isArray(projects) && projects.length >= 2) {
        log(`  = projects exist (${projects.length})`);
        return;
      }
      const custs = Array.isArray(customers) ? customers : [];
      const defs = [
        {
          name: "Harper & James — Wedding Package",
          milestones: ["Engagement shoot", "Wedding day coverage", "Album delivery"],
        },
        {
          name: "Bloom Cosmetics — Spring Campaign",
          milestones: ["Concept & moodboard", "Studio shoot day", "Retouched selects"],
        },
        {
          name: "Ortiz Family — Portrait Session",
          milestones: ["Location session", "Gallery delivery"],
        },
      ];
      for (let i = 0; i < defs.length && i < custs.length; i++) {
        try {
          const p = await api.post("/api/projects", {
            customer_id: custs[i].id,
            name: defs[i].name,
            title: defs[i].name,
          });
          const pid = p.project?.id ?? p.id;
          if (pid) {
            for (const m of defs[i].milestones) {
              try {
                await api.post(`/api/projects/${pid}/milestones`, { name: m, title: m });
              } catch {}
            }
          }
        } catch (e) {
          log(`  ! project: ${String(e.message).slice(0, 260)}`);
        }
      }
      log("  ✓ projects attempted");
    } catch (e) {
      log(`  ! projects: ${String(e.message).slice(0, 200)}`);
    }
  },
};

/* ─────────────────────────── main ─────────────────────────── */

const args = process.argv.slice(2);
const slugs = args.length ? args : Object.keys(SEEDERS);

for (const slug of slugs) {
  if (!SEEDERS[slug]) {
    log(`✗ no seeder for ${slug}`);
    continue;
  }
  log(`\n── ${slug} ──`);
  try {
    const token = await login(slug);
    await SEEDERS[slug](client(slug, token));
  } catch (e) {
    log(`✗ ${slug}: ${String(e.message).slice(0, 300)}`);
  }
}
log("\ndone.");
