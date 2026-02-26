import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Expenses from "./Expenses";
import ExpensesRedesign from "./redesign/ExpensesRedesign";

export default function ExpensesRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_expenses ? <ExpensesRedesign /> : <Expenses />;
}
