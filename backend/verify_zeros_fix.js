/**
 * Verify that the new String() coercion logic handles all edge cases
 * for barcode/SKU leading zeros.
 */
const cases = [
  // [input, expectedOutput, description]
  ["002590", "002590", "String with leading zeros (ideal case)"],
  [2590, "2590", "Numeric value (no leading zeros possible)"],
  [0, "0", "Numeric 0 — new code treats it as valid barcode '0'"],
  [null, null, "Null — should give null"],
  [undefined, null, "Undefined — should give null"],
  ["", null, "Empty string — should give null"],
  ["  ", null, "Whitespace only — should give null"],
  ["00001", "00001", "All leading zeros"],
  ["0", "0", "Single zero string"],
];

let passed = 0;
let failed = 0;

// This is the EXACT logic from the new import.js
function extractBarcode(rawBarcode) {
  return rawBarcode != null ? String(rawBarcode).trim() || null : null;
}

// OLD logic for comparison
function extractBarcodeOld(rawBarcode) {
  const coerced = rawBarcode || "";
  return String(coerced).trim() || null;
}

console.log("=== Leading Zero Fix Verification ===\n");
for (const [input, expected, desc] of cases) {
  const result = extractBarcode(input);
  const oldResult = extractBarcodeOld(input);
  const ok = result === expected;
  if (ok) {
    passed++;
    const improved =
      result !== oldResult ? ` [OLD returned: "${oldResult}"]` : "";
    console.log(`  PASS: ${desc}${improved}`);
  } else {
    failed++;
    console.error(`  FAIL: ${desc}`);
    console.error(
      `     Input: ${JSON.stringify(input)} | Expected: "${expected}" | Got: "${result}"`,
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
