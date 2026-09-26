import { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "../../../../api";
import { useAuth } from "../../../../auth/AuthProvider";
import { readContext } from "../../../../auth/authStore";
import { saveLastKnown, readLastKnown, isUnreachable } from "../../../../utils/lastKnown";

const OPENING_DENOMS = [5000, 1000, 500, 100, 50, 20, 10];

export function useShiftGate({ setError, showNotice }) {
  const { employee, hasPerm } = useAuth();

  const [outlets, setOutlets] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [activeShift, setActiveShift] = useState(null);
  const [attendanceStatus, setAttendanceStatus] = useState(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [openingShiftBusy, setOpeningShiftBusy] = useState(false);
  const [openingDenoms, setOpeningDenoms] = useState(
    OPENING_DENOMS.map((value) => ({ denomination: value, count: 0 })),
  );
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);

  const openingFloat = useMemo(
    () =>
      openingDenoms.reduce(
        (sum, row) => sum + row.denomination * Number(row.count || 0),
        0,
      ),
    [openingDenoms],
  );
  const canOpenShift = hasPerm("manage_orders");
  const canSwitchOutlet = hasPerm("all_access");
  const attendanceCode = attendanceStatus?.status || "not_clocked_in";
  const isReadyForCheckout = Boolean(
    selectedOutletId && activeShift && attendanceCode === "clocked_in",
  );

  // Bootstrap outlets + auto-select based on context. Offline (after a reload
  // with the internet down) the branches last seen online are used (3h).
  useEffect(() => {
    api.get("/api/outlets")
      .then((outData) => {
        saveLastKnown("pos_outlets", outData);
        return outData;
      })
      .catch((err) => {
        const saved = isUnreachable(err) ? readLastKnown("pos_outlets") : null;
        if (saved) return saved.value;
        throw err;
      })
      .then((outData) => {
        const outList = outData.outlets || [];
        setOutlets(outList);
        const ctx = readContext();
        if (ctx?.active_outlet_id) {
          const match = outList.find((o) => o.id === ctx.active_outlet_id);
          if (match) setSelectedOutletId(String(match.id));
        } else if (outList.length === 1) {
          setSelectedOutletId(String(outList[0].id));
        }
      })
      .catch(() => setError?.("Failed to load POS setup data."));
  }, []);

  const refreshGateStatus = useCallback(async (outletId) => {
    const targetOutletId = outletId ?? selectedOutletId;
    if (!targetOutletId || !employee?.id) {
      setActiveShift(null);
      setAttendanceStatus(null);
      return;
    }
    setGateLoading(true);
    try {
      const [shiftData, attendanceData] = await Promise.all([
        api.get("/api/shifts/active", { outlet_id: targetOutletId }),
        api.get("/api/attendance/my-status", { outlet_id: targetOutletId }),
      ]);
      setActiveShift(shiftData.shift || null);
      setAttendanceStatus(attendanceData || null);
      saveLastKnown(`pos_gate:${targetOutletId}:${employee.id}`, { shift: shiftData.shift || null, attendance: attendanceData || null });
    } catch (err) {
      // Offline (3h): the till and clock-in last seen online for this branch
      // and cashier, so a reload during an outage doesn't stop the counter.
      const saved = isUnreachable(err) ? readLastKnown(`pos_gate:${targetOutletId}:${employee.id}`) : null;
      if (saved) {
        setActiveShift(saved.value.shift);
        setAttendanceStatus(saved.value.attendance);
        const at = new Date(saved.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        showNotice?.(`Offline: using the till and clock-in saved at ${at}`);
      } else {
        setActiveShift(null);
        setAttendanceStatus(null);
        setError?.(err.message || "Failed to load POS opening status");
      }
    } finally {
      setGateLoading(false);
    }
  }, [selectedOutletId, employee?.id, setError, showNotice]);

  // Reset shift/attendance when outlet cleared
  useEffect(() => {
    if (!selectedOutletId) {
      setActiveShift(null);
      setAttendanceStatus(null);
    }
  }, [selectedOutletId]);

  useEffect(() => {
    if (!selectedOutletId || !employee?.id) return;
    refreshGateStatus(selectedOutletId);
  }, [selectedOutletId, employee?.id]);

  const openShiftFromPOS = useCallback(async () => {
    if (!selectedOutletId || !canOpenShift || openingFloat <= 0) return;
    setOpeningShiftBusy(true);
    setError?.("");
    try {
      await api.post("/api/shifts/open", {
        outlet_id: Number(selectedOutletId),
        employee_id: employee?.id || null,
        opening_float: Number(openingFloat.toFixed(2)),
        denominations: openingDenoms
          .filter((row) => Number(row.count || 0) > 0)
          .map((row) => ({
            denomination: row.denomination,
            count: Number(row.count || 0),
          })),
      });
      showNotice?.("Shift opened successfully.");
      await refreshGateStatus(selectedOutletId);
    } catch (err) {
      setError?.(err.message || "Failed to open shift");
    } finally {
      setOpeningShiftBusy(false);
    }
  }, [selectedOutletId, canOpenShift, openingFloat, employee?.id, openingDenoms, refreshGateStatus, setError, showNotice]);

  return {
    outlets,
    selectedOutletId, setSelectedOutletId,
    activeShift,
    attendanceStatus,
    attendanceCode,
    gateLoading,
    canOpenShift,
    canSwitchOutlet,
    isReadyForCheckout,
    openingDenoms, setOpeningDenoms,
    openingFloat,
    openingShiftBusy,
    openShiftFromPOS,
    closeShiftOpen, setCloseShiftOpen,
    refreshGateStatus,
  };
}
