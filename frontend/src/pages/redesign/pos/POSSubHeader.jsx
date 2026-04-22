import React, { useState, useEffect } from "react";
import { Calendar, Pause, Play, Package } from "lucide-react";
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
  } = usePOS();
  const holdsOn = !!posFlags?.phase2g_holds;

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
        <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
          Sell
        </h2>
        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400 font-medium">
          <span className="hidden sm:flex items-center gap-1.5">
            <Calendar size={12} />
            {new Date().toLocaleDateString("en-GB")}
          </span>
          <button
            onClick={() => setTaxInclusive((v) => !v)}
            className={`sm:ml-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs font-semibold transition ${
              taxInclusive
                ? "bg-[#8066FF]/10 border-[#8066FF] text-[#8066FF]"
                : "bg-white border-slate-200 text-slate-500"
            }`}
          >
            <span
              className={`w-7 h-3.5 rounded-full relative transition-colors ${
                taxInclusive ? "bg-[#8066FF]" : "bg-slate-200"
              }`}
            >
              <span
                className={`w-3 h-3 bg-white rounded-full absolute top-0.5 shadow transition-all ${
                  taxInclusive ? "left-3.5" : "left-0.5"
                }`}
              />
            </span>
            Tax Inclusive
          </button>
          <button
            onClick={toggleBulkScan}
            title="When on, each barcode scan creates a new cart line instead of incrementing quantity"
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs font-semibold transition ${
              bulkScanOn
                ? "bg-[#8066FF]/10 border-[#8066FF] text-[#8066FF]"
                : "bg-white border-slate-200 text-slate-500"
            }`}
          >
            <span
              className={`w-7 h-3.5 rounded-full relative transition-colors ${
                bulkScanOn ? "bg-[#8066FF]" : "bg-slate-200"
              }`}
            >
              <span
                className={`w-3 h-3 bg-white rounded-full absolute top-0.5 shadow transition-all ${
                  bulkScanOn ? "left-3.5" : "left-0.5"
                }`}
              />
            </span>
            Each scan = new line
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={parkSale}
          disabled={!cart.length || !selectedOutletId}
          className="flex items-center gap-1.5 text-[#8066FF] border border-indigo-100 bg-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-50 transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Pause size={13} /> Park Sale
        </button>
        <button
          onClick={() => {
            loadParked(selectedOutletId);
            setShowParked(true);
          }}
          className="flex items-center gap-1.5 text-[#8066FF] border border-indigo-100 bg-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-50 transition shadow-sm relative"
        >
          <Play size={13} /> Parked
          {parkedSales.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-[#8066FF] text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">
              {parkedSales.length}
            </span>
          )}
        </button>
        {holdsOn && (
          <>
            <button
              onClick={() => setHoldCreateOpen(true)}
              disabled={!cart.length || !selectedOutletId}
              className="flex items-center gap-1.5 text-[#8066FF] border border-indigo-100 bg-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-50 transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Package size={13} /> Hold
            </button>
            <button
              onClick={() => setHoldPickupOpen(true)}
              className="flex items-center gap-1.5 text-[#8066FF] border border-indigo-100 bg-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-50 transition shadow-sm"
            >
              <Package size={13} /> Pick Up
            </button>
          </>
        )}
      </div>
    </div>
  );
}
