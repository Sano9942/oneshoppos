import { POSProvider } from "./pos/POSContext";
import { ErrorBoundary } from "../../ui/ErrorBoundary";

// Phase 2-R.0 Day 1 stub. The restaurant shell (floor grid, check view,
// cart grouped by seat/course, action bar, modals) lands across Days 2-8
// in Tracks 2 and 3. This file exists today so the /pos/restaurant route
// resolves and POSProvider mounts — which is what the foundation milestone
// verifies.
export default function POSRestaurantRedesign() {
  return (
    <POSProvider>
      <ErrorBoundary level="page">
        <div className="p-8">Restaurant POS shell — coming in Phase 2-R.0</div>
      </ErrorBoundary>
    </POSProvider>
  );
}
