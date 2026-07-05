import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { Camera, MapPin, ArrowLeft, Check, X } from "lucide-react";
import { api } from "../../../api";
import { useAuth } from "../../../auth/AuthProvider";
import { useToast } from "../../../contexts/ToastContext";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { compressImage } from "../../../utils/imageCompress";
import { enqueueCheckIn, markSyncing, markSynced, markFailed } from "../../../utils/offlineQueue";

const OUTCOMES = [
  { value: "ordered", label: "Took Order", color: "bg-(--ui-success-fg) hover:bg-(--ui-success-fg)" },
  { value: "no_stock_needed", label: "No Stock Needed", color: "bg-(--ui-muted-surface) hover:bg-(--ui-primary-strong)" },
  { value: "shop_closed", label: "Shop Closed", color: "bg-(--ui-warning-fg) hover:bg-(--ui-warning-fg)" },
  { value: "owner_away", label: "Owner Away", color: "bg-(--ui-warning-fg) hover:bg-(--ui-warning-fg)" },
];

// Browser-generated UUID for idempotency. Crypto.randomUUID is available on
// every modern mobile browser (Chrome 92+, Safari 15.4+); fall back to a
// timestamp+random string for older clients.
function newUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `cuid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function FieldCheckInRedesign() {
  const { customer_id } = useParams();
  const navigate = useNavigate();
  const { employee, authHeaders, hasPerm } = useAuth();
  const { success: toastOk, error: toastErr } = useToast();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);

  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  const [routeMeta, setRouteMeta] = useState({ geofence_meters: 500 });

  const [gps, setGps] = useState(null); // { lat, lng, accuracy }
  const [gpsErr, setGpsErr] = useState("");
  const [gpsLoading, setGpsLoading] = useState(true);

  const [selfieDataUrl, setSelfieDataUrl] = useState(null);
  const [selfieErr, setSelfieErr] = useState("");
  const fileInputRef = useRef(null);

  const [submitting, setSubmitting] = useState(false);
  const [tagShopLocation, setTagShopLocation] = useState(false);

  // Load customer + route metadata
  useEffect(() => {
    if (flagsLoading || !flags.wholesale_field_sales) return;
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get("/api/field/route/today");
        if (cancelled) return;
        const found = data.customers.find((c) => String(c.customer_id) === String(customer_id));
        setCustomer(found || null);
        setRouteMeta({ geofence_meters: data.geofence_meters });
        // Auto-flip "tag shop location" on if the shop has no saved coords —
        // first visit becomes the canonical geo-tag.
        if (found && found.lat == null) setTagShopLocation(true);
      } catch (e) {
        if (!cancelled) toastErr(e.message || "Failed to load customer");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [customer_id, flagsLoading, flags.wholesale_field_sales]);

  // GPS capture on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsErr("Your browser doesn't support location services");
      setGpsLoading(false);
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 0),
        });
        setGpsErr("");
        setGpsLoading(false);
      },
      (err) => {
        setGpsErr(err.message || "Could not get location");
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }, []);

  const handleSelfiePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelfieErr("");
    try {
      const dataUrl = await compressImage(file, { maxWidth: 800, quality: 0.7 });
      setSelfieDataUrl(dataUrl);
    } catch (err) {
      setSelfieErr(err.message || "Failed to read photo");
    }
  };

  const submit = async (outcome) => {
    if (!gps && !selfieDataUrl) {
      toastErr("Please capture GPS and a selfie before submitting");
      return;
    }
    if (!gps) {
      toastErr("Waiting for GPS — try again in a moment");
      return;
    }
    if (!selfieDataUrl) {
      toastErr("Please take a selfie first");
      return;
    }
    setSubmitting(true);

    const payload = {
      idempotency_key: newUuid(),
      customer_id: Number(customer_id),
      outcome,
      lat: gps.lat,
      lng: gps.lng,
      gps_accuracy_m: gps.accuracy,
      selfie_base64: selfieDataUrl,
      tag_shop_location: tagShopLocation,
    };

    // Optimistic flow: enqueue first, attempt sync. If online sync succeeds,
    // mark synced (deletes from queue). If it fails, mark failed — rep sees
    // "N pending sync" on the today screen and the drain loop retries.
    try {
      await enqueueCheckIn(employee.id, payload);
    } catch (e) {
      // Queue full or storage error — surface to rep but don't block
      toastErr(e.message || "Could not save check-in locally");
      setSubmitting(false);
      return;
    }

    try {
      await markSyncing(payload.idempotency_key);
      await api.post("/api/field/check-in", {
        client_uuid: payload.idempotency_key,
        customer_id: payload.customer_id,
        outcome: payload.outcome,
        lat: payload.lat,
        lng: payload.lng,
        gps_accuracy_m: payload.gps_accuracy_m,
        selfie_base64: payload.selfie_base64,
        tag_shop_location: payload.tag_shop_location,
      });
      await markSynced(payload.idempotency_key);
      toastOk("Check-in recorded");
    } catch (e) {
      await markFailed(payload.idempotency_key, e.message);
      toastOk("Saved offline — will sync when connection returns");
    } finally {
      setSubmitting(false);
      // Tier 1.2 wholesale: "Took Order" auto-advances to the order screen so
      // the rep can capture the order without an extra tap. The visit's
      // idempotency_key is passed as visit_uuid — the sales POST resolves it
      // to field_visits.id even if the visit row is still in the offline
      // queue (the order will sync after the visit).
      if (outcome === "ordered") {
        navigate(
          `/field/order/${customer_id}?visit_uuid=${encodeURIComponent(
            payload.idempotency_key
          )}`
        );
      } else {
        navigate("/field/today");
      }
    }
  };

  if (flagsLoading || loading) {
    return (
      <div className="min-h-screen bg-(--ui-bg) p-4">
        <div className="animate-pulse h-32 bg-(--ui-muted-surface) rounded-xl" />
      </div>
    );
  }
  if (!flags.wholesale_field_sales) return <Navigate to="/" replace />;
  if (!hasPerm("manage_field_sales")) return <Navigate to="/" replace />;
  if (!customer) {
    return (
      <div className="min-h-screen bg-(--ui-bg) p-4">
        <div className="rounded-xl bg-(--ui-danger-bg) border border-(--ui-danger-bg) text-(--ui-danger-fg) p-4">
          Customer not found on today's route.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-(--ui-bg) pb-32">
      <header className="sticky top-0 z-10 bg-(--ui-surface) border-b border-(--ui-border) px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/field/today")}
          className="p-1 text-(--ui-text-muted) hover:text-(--ui-text)"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-(--ui-text-muted)">Check in</div>
          <div className="text-lg font-semibold text-(--ui-text) truncate">{customer.name}</div>
        </div>
      </header>

      <div className="px-4 pt-4 space-y-4">
        {/* GPS section */}
        <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <div className="flex items-start gap-3">
            <MapPin className="h-5 w-5 text-(--ui-primary) shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-(--ui-text) text-sm mb-1">Location</div>
              {gpsLoading && <div className="text-xs text-(--ui-text-muted)">Acquiring GPS…</div>}
              {gpsErr && (
                <div className="text-xs text-(--ui-danger-fg)">{gpsErr}</div>
              )}
              {gps && (
                <div className="text-xs text-(--ui-text-muted)">
                  {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} · accuracy ±{gps.accuracy}m
                </div>
              )}
              {tagShopLocation && gps && (
                <div className="mt-2 text-xs text-(--ui-success-fg)">
                  This visit will save the shop's location for future geofence checks.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Selfie section */}
        <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <div className="flex items-start gap-3">
            <Camera className="h-5 w-5 text-(--ui-primary) shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-(--ui-text) text-sm mb-2">Selfie</div>
              {!selfieDataUrl && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    onChange={handleSelfiePick}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg bg-(--ui-primary) text-(--ui-on-primary) px-4 py-2 text-sm font-medium"
                  >
                    Take selfie at shop
                  </button>
                </>
              )}
              {selfieDataUrl && (
                <div className="flex items-start gap-3">
                  <img
                    src={selfieDataUrl}
                    alt="Check-in selfie"
                    className="w-24 h-24 rounded-lg object-cover border border-(--ui-border)"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelfieDataUrl(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-xs text-(--ui-text-muted) hover:text-(--ui-danger-fg) inline-flex items-center gap-1"
                  >
                    <X className="h-3 w-3" /> Retake
                  </button>
                </div>
              )}
              {selfieErr && (
                <div className="mt-2 text-xs text-(--ui-danger-fg)">{selfieErr}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Outcome buttons — sticky bottom, large tap targets */}
      <div className="fixed bottom-0 inset-x-0 bg-(--ui-surface) border-t border-(--ui-border) p-3 space-y-2">
        <div className="text-xs text-(--ui-text-muted) text-center mb-1">What happened?</div>
        <div className="grid grid-cols-2 gap-2">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={submitting || !gps || !selfieDataUrl}
              onClick={() => submit(o.value)}
              className={`${o.color} text-(--ui-on-primary) font-medium rounded-lg py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1`}
            >
              <Check className="h-4 w-4" /> {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
