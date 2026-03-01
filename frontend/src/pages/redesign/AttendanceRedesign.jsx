import { PageShell } from "../../ui/primitives";
import Attendance from "../Attendance";

export default function AttendanceRedesign() {
  return (
    <PageShell
      title="Attendance"
      subtitle="Clock-in and clock-out records from the POS terminal"
    >
      <Attendance />
    </PageShell>
  );
}
