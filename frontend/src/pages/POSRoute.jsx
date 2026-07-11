import { Navigate } from "react-router-dom";
import { usePreset } from "../contexts/PresetContext";
import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import RouteLoading from "../routes/RouteLoading";
import POSRedesign from "./redesign/POSRedesign";

// Phase 2-R.0 Day 9 — Restaurant tenants land on /pos/restaurant.
// Wait for both preset + flags to load so we don't flash retail POS.
//
// W0b P1 (AUDIT §3): keyed on the tenant's declared industry, NOT on
// hasMode("restaurant") — the tenant_modes row is also written when a
// retail tenant enables the Restaurant business module, and keying on it
// silently REPLACED the retail till with the restaurant POS. industry_type
// comes from company_profile (what kind of business this is) and only
// changes via the wizard / an explicit industry change. Verified against
// all local golv_* / claimaudit* tenants and prod (read-only): every
// phase4_restaurant tenant is industry restaurant|cafe, and no other
// industry carries the flag. The flag check stays so a restaurant that
// disables its Restaurant module falls back to the retail till.
const RESTAURANT_INDUSTRIES = ["restaurant", "cafe"];

export default function POSRoute() {
  const { presetLoaded, industry_type } = usePreset();
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);

  if (!presetLoaded || flagsLoading) return <RouteLoading />;

  if (RESTAURANT_INDUSTRIES.includes(industry_type) && flags.phase4_restaurant) {
    return <Navigate to="/pos/restaurant" replace />;
  }

  return <POSRedesign />;
}
