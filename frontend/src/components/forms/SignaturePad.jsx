import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// Native, dependency-free signature pad. Pointer events cover mouse, touch,
// and stylus. Exposes `toDataURL()` + `clear()` + `isEmpty()` via the ref.
// Shared by the public fill page, portal fill, and staff-assisted fill so the
// signature-capture path can't diverge across surfaces (F03).
const SignaturePad = forwardRef(function SignaturePad({ height = 150 }, ref) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasStrokeRef.current,
    clear: () => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      hasStrokeRef.current = false;
    },
    toDataURL: () => canvasRef.current?.toDataURL("image/png") || null,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext("2d");
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#0f172a";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onDown = (e) => {
    e.preventDefault();
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
    hasStrokeRef.current = true;
  };
  const onMove = (e) => {
    if (!drawingRef.current) return;
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const onUp = () => {
    drawingRef.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      style={{ touchAction: "none", height, width: "100%" }}
      className="rounded border border-(--ui-border) bg-(--ui-surface)"
    />
  );
});

// Downscale a signature dataURL to <= maxDim px on the long edge (mirrors the
// bounds the consent UI relies on) so a high-res canvas can't blow the 10MB
// JSON body limit on a slow mobile link. Returns base64 (no data: prefix).
export async function signatureToBase64(dataUrl, maxDim = 900) {
  if (!dataUrl) return null;
  const strip = (u) => (u ? u.split(",")[1] || null : null);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    if (scale >= 1) return strip(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return strip(canvas.toDataURL("image/png"));
  } catch {
    return strip(dataUrl);
  }
}

export default SignaturePad;
