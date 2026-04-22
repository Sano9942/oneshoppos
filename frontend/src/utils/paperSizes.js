/**
 * Shared paper-width definitions for thermal printers and receipt templates.
 * The `value` is the character width the backend printer service uses to lay
 * out rows; the label pairs it with the physical roll width merchants know.
 *
 * Imported by Printer Settings (hardware config) and Receipt Templates
 * (per-template override) so both surfaces stay in sync.
 */
export const PAPER_SIZES = [
  { label: "80mm — 48 chars (standard)", value: 48 },
  { label: "76mm — 42 chars", value: 42 },
  { label: "58mm — 32 chars (mini)", value: 32 },
  { label: "57mm — 30 chars (narrow)", value: 30 },
];

/**
 * 13px monospace glyph is ~7.1px wide; the popup needs slightly more width
 * than the raw char count to comfortably render divider rows. Calibrated so:
 *   32 chars → 227px (58mm)
 *   42 chars → 298px
 *   48 chars → 341px (80mm, default)
 */
export function pxForChars(chars) {
  const n = Number(chars) || 48;
  return Math.round(n * 7.1);
}
