import ReportsRedesign, { ReportsTabStandaloneRedesign } from "./redesign/ReportsRedesign";

export default function ReportsRoute() {
  return <ReportsRedesign />;
}

export function ReportTabStandaloneRoute({ tabId }) {
  return <ReportsTabStandaloneRedesign tabId={tabId} />;
}
