import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Employees from "./Employees";
import EmployeesRedesign from "./redesign/EmployeesRedesign";

export default function EmployeesRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_employees ? <EmployeesRedesign /> : <Employees />;
}
