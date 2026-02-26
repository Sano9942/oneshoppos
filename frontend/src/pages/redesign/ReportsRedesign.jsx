/**
 * Wave C — Reports Redesign
 *
 * Strategy: the existing Reports component and all its tab sub-components are
 * very mature and not duplicated here.  We wrap them in the shared design-system
 * shell (PageShell / SectionCard) so the outer chrome matches every other
 * redesigned page, while the tab content stays in Reports.jsx as the single
 * source of truth.
 */
import Reports, { ReportTabStandalone } from "../Reports";

// Reports.jsx renders its own header and scrollable tab bar — pass through directly.
export default function ReportsRedesign() {
  return <Reports />;
}

export function ReportsTabStandaloneRedesign({ tabId }) {
  return <ReportTabStandalone tabId={tabId} />;
}
