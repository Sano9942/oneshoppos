/**
 * utils/scale.js
 *
 * Lane-scale integration for the grocery/butcher/sweet-shop counter (V01 plan
 * P0 "Scale integration"). Reads a live weight from a serial bench scale over
 * the Web Serial API and hands it to the POS so the cashier never types the
 * weight by hand.
 *
 * DESIGN — mirror of the courier/marketplace adapter pattern (a base class with
 * a throwing stub + named adapters + a key→class registry). Each adapter only
 * has to know how to turn one line of the scale's serial stream into a
 * { weight, unit, stable } reading; the transport (open port, stream frames,
 * wait for a stable value) is shared here.
 *
 * This is explicitly a v1 covering ONE protocol class: continuous-mode ASCII
 * scales at 9600-8N1 (CAS ER/SE/PR, AND FG/SG, and the generic Chinese/GS-clone
 * scales ubiquitous in PK markets stream a signed decimal + an ST/US stability
 * token). Extend by adding another adapter class and registering it — do NOT
 * fork the transport.
 *
 * GRACEFUL FALLBACK is first-class: `isScaleSupported()` is false on any browser
 * without Web Serial (Safari, mobile, older Chrome, non-HTTPS), and every POS
 * weight field remains hand-typable exactly as before. The "Weigh" button is
 * only rendered when support is present; nothing here is ever on the critical
 * checkout path.
 */

/** True when the browser exposes Web Serial (Chrome/Edge on HTTPS or localhost). */
export function isScaleSupported() {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export class BaseScaleAdapter {
  static key = "base";
  static baudRate = 9600;
  static label = "Base scale";
  /** @returns {{weight:number, unit:string, stable:boolean}|null} */
  static parseFrame() {
    throw new Error("BaseScaleAdapter.parseFrame not implemented");
  }
}

/**
 * Generic continuous-mode serial scale.
 *
 * Frame examples this tolerates (one per line, CR/LF terminated):
 *   "ST,GS,+  1.234kg"      (CAS continuous)
 *   "US,GS,+  0.500 kg"     (unstable)
 *   "+001.234 kg"           (bare signed decimal)
 *   "S    2.500 kg"         (AND style)
 *   "1.234"                 (numeric only — treated as stable)
 *
 * Stability: an explicit "US"/"U," token ⇒ unstable; "ST"/"S," ⇒ stable; a bare
 * numeric frame with no token is treated as stable (many low-cost scales stream
 * only the number). The transport still requires N consecutive equal readings
 * before committing, so a bare-number scale can't commit a mid-motion value.
 */
export class GenericSerialScaleAdapter extends BaseScaleAdapter {
  static key = "generic";
  static baudRate = 9600;
  static label = "Generic serial scale (9600 8N1)";

  static parseFrame(text) {
    if (!text) return null;
    const line = String(text).trim();
    if (!line) return null;

    let stable = true;
    if (/\b(US|U)\b/i.test(line) || /^U/i.test(line)) stable = false;
    if (/\b(ST|S)\b/i.test(line) || /^S[,\s]/i.test(line)) stable = true;

    const num = line.match(/[+-]?\d+(?:\.\d+)?/);
    if (!num) return null;
    const weight = Number(num[0]);
    if (!Number.isFinite(weight)) return null;

    const unitMatch = line.match(/\b(kg|g|lb|oz)\b/i);
    const unit = unitMatch ? unitMatch[1].toLowerCase() : "kg";
    return { weight, unit, stable };
  }
}

export const SCALE_ADAPTERS = {
  generic: GenericSerialScaleAdapter,
  // CAS scales speak the same continuous ASCII dialect the generic adapter
  // already handles; kept as an explicit alias so tenant config can name it.
  cas: GenericSerialScaleAdapter,
};

export function getScaleAdapter(key) {
  return SCALE_ADAPTERS[key] || GenericSerialScaleAdapter;
}

// Single shared connection — a lane has one scale. `requestPort()` must be
// called from a user gesture (the Weigh button click), so we connect lazily on
// first weigh and reuse the port thereafter.
let _conn = null; // { port, Adapter }

async function ensureConnected(adapterKey, opts = {}) {
  if (!isScaleSupported()) {
    throw new Error("This browser has no serial support — type the weight manually.");
  }
  const Adapter = getScaleAdapter(adapterKey);
  if (_conn && _conn.port && _conn.port.readable) return _conn;

  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: opts.baudRate || Adapter.baudRate });
  _conn = { port, Adapter };
  return _conn;
}

/** Close the shared scale connection (call on POS unmount / device change). */
export async function disconnectScale() {
  if (_conn && _conn.port) {
    try {
      await _conn.port.close();
    } catch {
      /* already closed */
    }
  }
  _conn = null;
}

/**
 * Connect (if needed) and read one settled weight from the lane scale.
 *
 * Resolves with { weight, unit } once the same weight is seen on
 * `settleReads` consecutive stable frames, or rejects on timeout / no scale.
 *
 * @param {object} opts
 * @param {string} opts.adapterKey  registry key (default "generic")
 * @param {number} opts.baudRate    override adapter default
 * @param {number} opts.timeoutMs   default 8000
 * @param {number} opts.settleReads consecutive equal stable frames (default 3)
 */
export async function weighOnce(opts = {}) {
  const {
    adapterKey = "generic",
    timeoutMs = 8000,
    settleReads = 3,
  } = opts;

  const { port, Adapter } = await ensureConnected(adapterKey, opts);
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastWeight = null;
  let streak = 0;

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: false, _timeout: true }), remaining),
        ),
      ]);
      if (done) break;
      if (value === undefined) continue; // timeout tick
      buffer += decoder.decode(value, { stream: true });

      // Split into complete lines; keep the trailing partial in the buffer.
      const lines = buffer.split(/[\r\n]+/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const frame = Adapter.parseFrame(line);
        if (!frame || !frame.stable) {
          streak = 0;
          lastWeight = null;
          continue;
        }
        if (lastWeight !== null && Math.abs(frame.weight - lastWeight) < 1e-6) {
          streak += 1;
        } else {
          streak = 1;
          lastWeight = frame.weight;
        }
        if (streak >= settleReads) {
          return { weight: frame.weight, unit: frame.unit };
        }
      }
    }
    throw new Error("Timed out waiting for a stable weight — check the scale and try again.");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}
