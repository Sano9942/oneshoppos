import Reports, { ReportTabStandalone } from "../Reports";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import ReportsPowerUpPanel from "./ReportsPowerUpPanel";

export default function ReportsRedesign() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return (
    <div className="space-y-3">
      <ReportsPowerUpPanel flags={flags} authHeaders={authHeaders} />
      <Reports />
    </div>
  );
}

export function ReportsTabStandaloneRedesign({ tabId }) {
  return <ReportTabStandalone tabId={tabId} />;
}

