import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Reports, { ReportTabStandalone } from "./Reports";
import ReportsRedesign, { ReportsTabStandaloneRedesign } from "./redesign/ReportsRedesign";

export default function ReportsRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_reports ? <ReportsRedesign /> : <Reports />;
}

export function ReportTabStandaloneRoute({ tabId }) {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_reports
    ? <ReportsTabStandaloneRedesign tabId={tabId} />
    : <ReportTabStandalone tabId={tabId} />;
}
