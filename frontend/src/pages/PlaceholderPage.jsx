import { useLocation, useNavigate } from "react-router-dom";
import { HardHat, ArrowLeft } from "lucide-react";

export default function PlaceholderPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  // Create a readable title from the path
  const title = path
    .split("/")
    .pop()
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
      <div className="bg-(--ui-surface) p-10 rounded-(--ui-radius-lg) border border-(--ui-border-strong) max-w-md w-full flex flex-col items-center">
        <div className="w-20 h-20 bg-(--ui-muted-surface) rounded-(--ui-radius-lg) flex items-center justify-center mb-6">
          <HardHat className="w-10 h-10 text-(--ui-text-muted)" />
        </div>

        <h2 className="text-2xl font-bold text-(--ui-text) mb-2">{title}</h2>

        <div className="inline-block bg-(--ui-warning-bg) text-(--ui-warning-fg) text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-(--ui-radius-pill) mb-4">
          Coming Soon
        </div>

        <p className="text-(--ui-text-muted) mb-8 max-w-xs leading-relaxed">
          This feature is scheduled for a future development phase according to
          the SanoPOS roadmap.
        </p>

        <button
          onClick={() => navigate("/")}
          className="ui-focus-ring flex items-center gap-2 bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) px-6 py-2.5 rounded-(--ui-radius-pill) font-medium transition-colors w-full justify-center"
        >
          <ArrowLeft size={18} />
          Return to Dashboard
        </button>
      </div>
    </div>
  );
}
