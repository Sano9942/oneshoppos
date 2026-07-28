import React, { useState, useEffect } from "react";
import { Calendar, CalendarClock, Pause, Play, Package, X } from "lucide-react";
import { usePOS } from "./POSContext";

function readBulkScanMode() {
  try {
    const deviceId = localStorage.getItem("pos_device_id") || "default";
    return localStorage.getItem(`pos_bulk_scan_mode_${deviceId}`) || "increment";
  } catch {
    return "increment";
  }
}

function writeBulkScanMode(mode) {
  try {
    const deviceId = localStorage.getItem("pos_device_id") || "default";
    localStorage.setItem(`pos_bulk_scan_mode_${deviceId}`, mode);
  } catch { /* noop */ }
}

export default function POSSubHeader() {
  const {
    taxInclusive,
    setTaxInclusive,
    parkSale,
    cart,
    selectedOutletId,
    loadParked,
    setShowParked,
    parkedSales,
    posFlags,
    setHoldCreateOpen,
    setHoldPickupOpen,
    taxMode,
    setShowAppointments,
    activeAppointment,
    clearActiveAppointment,
  } = usePOS();
  const holdsOn = !!posFlags?.phase2g_holds;
  const appointmentsOn = !!posFlags?.phase4_appointments;
  // P8 (3.14): hide the inclusive/exclusive toggle for unregistered tenants
  // — they cannot legally charge GST so the choice is meaningless.
  const showTaxToggle = taxMode && taxMode !== "none";

  const [bulkScan, setBulkScan] = useState("increment");
  useEffect(() => { setBulkScan(readBulkScanMode()); }, []);
  const bulkScanOn = bulkScan === "new_line";
  const toggleBulkScan = () => {
    const next = bulkScanOn ? "increment" : "new_line";
    setBulkScan(next);
    writeBulkScanMode(next);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 md:mb-4 gap-2 sm:gap-0">
      <div>
        <h2 className="text-2xl md:text-3xl font-black text-(--ui-text) tracking-tight">
          Sell
        </h2>
        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-(--ui-text-muted) font-medium">
          <span className="hidden sm:flex items-center gap-1.5">
            <Calendar size={12} />
            {new Date().toLocaleDateString("en-GB")}
          </span>
          {showTaxToggle && (
            <button
              onClick={() => setTaxInclusive((v) => !v)}
              className={`sm:ml-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs font-semibold transition ${
                taxInclusive
                  ? "bg-(--ui-muted-surface) border-(--ui-text) text-(--ui-text)"
                  : "bg-(--ui-surface) border-(--ui-border) text-(--ui-text-muted)"
              }`}
            >
              <span
                className={`w-7 h-3.5 rounded-full relative transition-colors ${
                  taxInclusive ? "bg-(--ui-primary)" : "bg-(--ui-border-strong)"
                }`}
              >
                <span
                  className={`w-3 h-3 bg-(--ui-surface) rounded-full absolute top-0.5 shadow transition-all ${
                    taxInclusive ? "left-3.5" : "left-0.5"
                  }`}
                />
              </span>
              Tax Inclusive
            </button>
          )}
          <button
            onClick={toggleBulkScan}
            title="When on, each barcode scan creates a new cart line instead of incrementing quantity"
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs font-semibold transition ${
              bulkScanOn
                ? "bg-(--ui-muted-surface) border-(--ui-text) text-(--ui-text)"
                : "bg-(--ui-surface) border-(--ui-border) text-(--ui-text-muted)"
            }`}
          >
            <span
              className={`w-7 h-3.5 rounded-full relative transition-colors ${
                bulkScanOn ? "bg-(--ui-primary)" : "bg-(--ui-border-strong)"
              }`}
            >
              <span
                className={`w-3 h-3 bg-(--ui-surface) rounded-full absolute top-0.5 shadow transition-all ${
                  bulkScanOn ? "left-3.5" : "left-0.5"
                }`}
              />
            </span>
            Each scan = new line
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        {appointmentsOn && (
          activeAppointment ? (
            <button
              onClick={clearActiveAppointment}
              title="Checkout will complete this appointment — click to detach"
              className="flex items-center gap-1.5 text-(--ui-success-fg) border border-(--ui-success-fg)/20 bg-(--ui-success-bg) px-3 py-1.5 rounded-(--ui-radius-sm) text-xs font-bold transition"
            >
              <CalendarClock size={13} /> Appt #{activeAppointment.id}
              <X size={11} />
            </button>
          ) : (
            <button
              onClick={() => setShowAppointments(true)}
              className="flex items-center gap-1.5 text-(--ui-text) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 rounded-(--ui-radius-sm) text-xs font-bold hover:bg-(--ui-muted-surface) transition"
            >
              <CalendarClock size={13} /> Appointments
            </button>
          )
        )}
        <button
          onClick={parkSale}
          disabled={!cart.length || !selectedOutletId}
          className="flex items-center gap-1.5 text-(--ui-text) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 rounded-full text-xs font-bold hover:bg-(--ui-muted-surface) transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Pause size={13} /> Park Sale
        </button>
        <button
          onClick={() => {
            loadParked(selectedOutletId);
            setShowParked(true);
          }}
          className="flex items-center gap-1.5 text-(--ui-text) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 rounded-full text-xs font-bold hover:bg-(--ui-muted-surface) transition relative"
        >
          <Play size={13} /> Parked
          {parkedSales.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-(--ui-primary) text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">
              {parkedSales.length}
            </span>
          )}
        </button>
        {holdsOn && (
          <>
            <button
              onClick={() => setHoldCreateOpen(true)}
              disabled={!cart.length || !selectedOutletId}
              className="flex items-center gap-1.5 text-(--ui-text) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 rounded-full text-xs font-bold hover:bg-(--ui-muted-surface) transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Package size={13} /> Hold
            </button>
            <button
              onClick={() => setHoldPickupOpen(true)}
              className="flex items-center gap-1.5 text-(--ui-text) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 rounded-full text-xs font-bold hover:bg-(--ui-muted-surface) transition"
            >
              <Package size={13} /> Pick Up
            </button>
          </>
        )}
      </div>
    </div>
  );
}
