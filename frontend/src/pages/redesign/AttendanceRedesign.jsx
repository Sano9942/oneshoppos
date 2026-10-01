import { useState } from "react";
import { PageShell, TabBar } from "../../ui/primitives";
import { useAuth } from "../../auth/AuthProvider";
import Attendance from "../Attendance";
import StaffRegister from "./staff/StaffRegister";

export default function AttendanceRedesign() {
  const { hasPerm } = useAuth();
  // F3b: the month register (P / A / S per day) is the owner's
  // (manage_employees); clock-in records stay for everyone with the page.
  const canRegister = hasPerm("manage_employees");
  const [tab, setTab] = useState(canRegister ? "register" : "clock");
  return (
    <PageShell
      title="Attendance"
      subtitle={tab === "register"
        ? "Month register: P present, A absent, S sick. Clock-ins fill it; only the owner corrects a box, with a reason."
        : "Clock-in and clock-out records from the POS terminal"}
      right={canRegister ? (
        <TabBar
          value={tab}
          onChange={setTab}
          tabs={[{ value: "register", label: "Register" }, { value: "clock", label: "Clock-ins" }]}
        />
      ) : null}
    >
      {tab === "register" && canRegister ? <StaffRegister /> : <Attendance />}
    </PageShell>
  );
}
