import { Navigate } from "react-router-dom";
import { usePreset } from "../contexts/PresetContext";
import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import RouteLoading from "../routes/RouteLoading";
import POSRedesign from "./redesign/POSRedesign";

// Phase 2-R.0 Day 9 — Restaurant tenants land on /pos/restaurant.
// Wait for both preset + flags to load so we don't flash retail POS,
// then redirect when preset has the restaurant mode AND the
// phase4_restaurant flag is on. All other tenants render retail POS.
export default function POSRoute() {
  const { presetLoaded, hasMode } = usePreset();
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);

  if (!presetLoaded || flagsLoading) return <RouteLoading />;

  if (hasMode("restaurant") && flags.phase4_restaurant) {
    return <Navigate to="/pos/restaurant" replace />;
  }

  return <POSRedesign />;
}
