import { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "../../../../api";
import { useAuth } from "../../../../auth/AuthProvider";
import { readContext } from "../../../../auth/authStore";

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

  // Bootstrap outlets + auto-select based on context
  useEffect(() => {
    api.get("/api/outlets")
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
    } catch (err) {
      setActiveShift(null);
      setAttendanceStatus(null);
      setError?.(err.message || "Failed to load POS opening status");
    } finally {
      setGateLoading(false);
    }
  }, [selectedOutletId, employee?.id, setError]);

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
