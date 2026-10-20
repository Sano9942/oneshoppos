// One Toy Store pilot F3b part 3b: the kiosk's camera (photo on every press).
//
// The browser's camera API, not a "take a photo" file button: a file button
// opens the front camera on a phone but only a file picker on a PC, and the
// shop needs both (spare Samsung by the door, or a webcam on any PC).
// Never throws: a refused / missing camera is status "failed" and snap()
// returns null, so the press goes through without a photo.
import { useEffect, useRef, useState, useCallback } from "react";

const MAX_SIDE = 640;
const QUALITY = 0.7;

/** Draw the current video frame, scaled to MAX_SIDE, as a JPEG data URL (or null). */
export function snapFrame(video, { maxSide = MAX_SIDE, quality = QUALITY } = {}) {
  try {
    const w = video?.videoWidth || 0;
    const h = video?.videoHeight || 0;
    if (!w || !h) return null;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", quality);
    return url.startsWith("data:image/") ? url : null;
  } catch {
    return null;
  }
}

/**
 * Open the front camera while `active`. Returns { videoRef, status, snap }:
 * status "off" | "starting" | "ready" | "failed". videoRef is a callback ref,
 * so the stream follows the <video> when the kiosk moves to another screen
 * (status → break reasons).
 */
export function useKioskCamera(active) {
  const videoEl = useRef(null);
  const streamRef = useRef(null);
  // Set only from the camera's answer (and reset on cleanup); "off" and
  // "failed for no camera" are worked out below, not stored.
  const [answer, setAnswer] = useState("starting");
  const hasCamera = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
  const status = !active ? "off" : !hasCamera ? "failed" : answer;

  const show = (v, stream) => {
    if (!v) return;
    v.srcObject = stream;
    if (!stream) return;
    const p = v.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };
  const videoRef = useCallback((el) => {
    videoEl.current = el;
    if (el && streamRef.current) show(el, streamRef.current);
  }, []);

  useEffect(() => {
    if (!active || !hasCamera) return undefined;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        show(videoEl.current, stream);
        setAnswer("ready");
      })
      .catch(() => {
        if (!cancelled) setAnswer("failed");
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoEl.current) videoEl.current.srcObject = null;
      setAnswer("starting");
    };
  }, [active, hasCamera]);

  const snap = useCallback(() => (status === "ready" ? snapFrame(videoEl.current) : null), [status]);

  return { videoRef, status, snap };
}
