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
      <div className="bg-white p-10 rounded-3xl shadow-sm border border-slate-200 max-w-md w-full flex flex-col items-center">
        <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mb-6">
          <HardHat className="w-10 h-10 text-indigo-500" />
        </div>

        <h2 className="text-2xl font-bold text-slate-800 mb-2">{title}</h2>

        <div className="inline-block bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-4">
          Coming Soon
        </div>

        <p className="text-slate-500 mb-8 max-w-xs leading-relaxed">
          This feature is scheduled for a future development phase according to
          the OneShopPOS roadmap.
        </p>

        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl font-medium transition-colors w-full justify-center"
        >
          <ArrowLeft size={18} />
          Return to Dashboard
        </button>
      </div>
    </div>
  );
}
