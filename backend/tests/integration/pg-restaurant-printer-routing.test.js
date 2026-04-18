/**
 * pg-restaurant-printer-routing.test.js — Phase 2-R Wave B / 2-R.7
 *
 * Printer purpose resolution:
 *   1. fire_chit + station_id → station's printer_id row
 *   2. guest_bill → purpose='guest_bill' printer, falling back to receipt
 *   3. receipt → legacy id=1 behavior
 */

delete process.env.MULTI_TENANT;

const { createTestApp } = require("../helpers/createTestApp-pg");
const { MIGRATIONS } = require("../../migrate-pg");
const makePrinterService = require("../../services/printer");

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

describe("Phase 2-R.7 — Printer purpose resolution", () => {
  let db, cleanup;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestApp());
    const v59 = MIGRATIONS.find((m) => m.version === 59);
    await v59.up(await db.getClient());

    // Seed printer_config rows. id=1 is the default receipt printer;
    // id=2 is a fire_chit printer assigned to a KDS station; id=3 is
    // a guest_bill printer.
    await db.query(
      `INSERT INTO printer_config (id, connection_type, host, port, paper_width, is_active, purpose)
       VALUES (1, 'network', '10.0.0.10', 9100, 48, true, 'receipt')
       ON CONFLICT (id) DO UPDATE SET purpose = 'receipt', is_active = true`
    );
    await db.query(
      `INSERT INTO printer_config (id, connection_type, host, port, paper_width, is_active, purpose)
       VALUES (2, 'network', '10.0.0.20', 9100, 48, true, 'fire_chit')
       ON CONFLICT (id) DO UPDATE SET purpose = 'fire_chit', is_active = true`
    );
    await db.query(
      `INSERT INTO printer_config (id, connection_type, host, port, paper_width, is_active, purpose)
       VALUES (3, 'network', '10.0.0.30', 9100, 48, true, 'guest_bill')
       ON CONFLICT (id) DO UPDATE SET purpose = 'guest_bill', is_active = true`
    );

    // Seed a KDS station bound to the Grill printer. Schema requires name + outlet_id.
    await db.query(
      `INSERT INTO kds_stations (id, outlet_id, name, printer_id)
       VALUES (42, 1, 'Grill', 2)
       ON CONFLICT (id) DO UPDATE SET printer_id = 2`
    );
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("purpose=fire_chit + station_id returns the station's printer", async () => {
    const svc = makePrinterService(db);
    const cfg = await svc.resolvePrinterConfig({ purpose: "fire_chit", station_id: 42 });
    expect(cfg).toBeTruthy();
    expect(cfg.id).toBe(2);
    expect(cfg.host).toBe("10.0.0.20");
  });

  it("purpose=guest_bill returns the guest_bill printer", async () => {
    const svc = makePrinterService(db);
    const cfg = await svc.resolvePrinterConfig({ purpose: "guest_bill", outlet_id: 1 });
    expect(cfg).toBeTruthy();
    expect(cfg.id).toBe(3);
    expect(cfg.purpose).toBe("guest_bill");
  });

  it("purpose=guest_bill falls back to default when no guest_bill configured", async () => {
    // Temporarily disable the guest_bill printer.
    await db.query(`UPDATE printer_config SET is_active = false WHERE id = 3`);
    const svc = makePrinterService(db);
    const cfg = await svc.resolvePrinterConfig({ purpose: "guest_bill", outlet_id: 1 });
    expect(cfg).toBeTruthy();
    expect(cfg.id).toBe(1); // legacy default receipt printer
    await db.query(`UPDATE printer_config SET is_active = true WHERE id = 3`);
  });

  it("purpose=receipt returns the legacy default", async () => {
    const svc = makePrinterService(db);
    const cfg = await svc.resolvePrinterConfig({ purpose: "receipt" });
    expect(cfg).toBeTruthy();
    expect(cfg.id).toBe(1);
  });

  it("fire_chit with missing station falls back to default (never silent drop)", async () => {
    const svc = makePrinterService(db);
    const cfg = await svc.resolvePrinterConfig({ purpose: "fire_chit", station_id: 9999 });
    expect(cfg).toBeTruthy();
    expect(cfg.id).toBe(1);
  });
});
