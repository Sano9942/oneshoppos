import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import CompanySettings from "./CompanySettings";
import CompanySettingsRedesign from "./redesign/CompanySettingsRedesign";

export default function CompanySettingsRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_company_settings ? <CompanySettingsRedesign /> : <CompanySettings />;
}
