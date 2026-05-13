/**
 * imageCompress.js — Tier 1.1 wholesale field-rep selfie compression.
 *
 * Mobile phone cameras shoot 3MB+ JPEGs by default. Uploading that over 3G in
 * a Pakistani bazaar is painful and bloats the IndexedDB queue. This utility
 * draws the image to a canvas at max 800px wide, exports at JPEG quality 0.7,
 * and returns a base64 data URL ~80-150KB.
 *
 * Single export: compressImage(fileOrBlob, opts?) → Promise<string>
 *
 * Caller:
 *   const file = e.target.files[0];        // from <input type="file" accept="image/*" capture="user">
 *   const compressedDataUrl = await compressImage(file);
 *   await enqueueCheckIn(empId, { selfie_base64: compressedDataUrl, ... });
 *
 * Falls back gracefully — if canvas/FileReader/Image is unavailable (very
 * old browsers) we read the raw file as base64 without compression. The
 * server then accepts the larger payload (Zod schema caps at ~2MB).
 */

const DEFAULTS = {
  maxWidth: 800,
  maxHeight: 800,
  quality: 0.7,
  mime: "image/jpeg",
};

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error("FileReader failed"));
    fr.readAsDataURL(blob);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUrl;
  });
}

export async function compressImage(fileOrBlob, opts = {}) {
  if (!fileOrBlob) return null;
  const { maxWidth, maxHeight, quality, mime } = { ...DEFAULTS, ...opts };

  // Read raw bytes first — needed as fallback if canvas path fails.
  const rawDataUrl = await readAsDataUrl(fileOrBlob);

  if (typeof document === "undefined" || typeof HTMLCanvasElement === "undefined") {
    return rawDataUrl;
  }

  try {
    const img = await loadImage(rawDataUrl);
    // Scale to fit within max bounds while preserving aspect ratio.
    let w = img.width;
    let h = img.height;
    const scale = Math.min(maxWidth / w, maxHeight / h, 1);
    w = Math.round(w * scale);
    h = Math.round(h * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL(mime, quality);
    // If for some reason the encoded result is larger than the raw input
    // (rare — happens for already-tiny PNGs being re-encoded), prefer raw.
    return out.length < rawDataUrl.length ? out : rawDataUrl;
  } catch {
    return rawDataUrl;
  }
}
