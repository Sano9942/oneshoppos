import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileCheck2, X } from "lucide-react";
import { api } from "../api";

/**
 * FBRPromptBanner
 *
 * Shown only to PK tenants who haven't yet enabled FBR Digital Invoicing and
 * haven't dismissed this banner. Two CTAs:
 *   - "Set up FBR" → /settings/fbr
 *   - "Not required for my business" → PUT /api/company-profile/fbr-banner-dismiss
 *
 * Props (all from dashboard data — avoids a second fetch):
 *   countryCode             : string|null
 *   fbrBannerDismissed      : boolean
 *   fbrIntegrationEnabled   : boolean
 *
 * Visibility AND-conditions:
 *   - countryCode === "PK"
 *   - fbrBannerDismissed !== true
 *   - fbrIntegrationEnabled !== true (already set up — banner stops nagging)
 */
export default function FBRPromptBanner({ countryCode, fbrBannerDismissed, fbrIntegrationEnabled }) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const visible =
    !hidden &&
    countryCode === "PK" &&
    fbrBannerDismissed !== true &&
    fbrIntegrationEnabled !== true;

  if (!visible) return null;

  async function handleDismiss() {
    if (dismissing) return;
    setDismissing(true);
    try {
      await api.raw("/api/company-profile/fbr-banner-dismiss", { method: "PUT" });
    } catch {
      // Best-effort — even if the persist fails we hide locally so we don't
      // nag this session.
    }
    setHidden(true);
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
      <FileCheck2 size={16} className="mt-0.5 shrink-0 text-blue-600" />
      <div className="flex-1">
        <p className="font-medium text-blue-900">FBR Digital Invoicing</p>
        <p className="mt-0.5 text-xs text-blue-800">
          Required for Pakistan businesses registered for sales tax (STRN). If
          your business isn&apos;t registered for sales tax, you can dismiss this.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/settings/fbr")}
        className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
      >
        Set up FBR
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={dismissing}
        className="shrink-0 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50 cursor-pointer"
      >
        {dismissing ? "Saving…" : "Not required"}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="rounded-full p-1 text-blue-600 hover:bg-blue-100 cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  );
}
