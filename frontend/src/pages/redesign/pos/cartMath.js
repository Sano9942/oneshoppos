/**
 * Pure cart calculation functions — extracted from POSContext for testability.
 * No React dependencies. All functions are deterministic given the same inputs.
 */

/**
 * Sum of all line totals (price × quantity) in the cart.
 * @param {Array<{price: number, quantity: number}>} cart
 * @returns {number}
 */
export function calcGrossTotal(cart) {
  return cart.reduce((s, i) => s + Number(i.price || 0) * i.quantity, 0);
}

/**
 * Order-level discount amount.
 * @param {number} grossTotal
 * @param {"percent"|"flat"} discountType
 * @param {string|number} discountInput - Raw user input
 * @returns {number}
 */
export function calcDiscountValue(grossTotal, discountType, discountInput) {
  const raw = Number(discountInput || 0);
  if (discountType === "percent") return (grossTotal * raw) / 100;
  return raw;
}

/**
 * Tax amount extracted from item prices (inclusive tax only).
 * Returns 0 when taxInclusive is false (tax-exclusive mode adds tax in total).
 * @param {Array<{price: number, quantity: number, effectiveTaxRate: number}>} cart
 * @param {boolean} taxInclusive
 * @returns {number}
 */
export function calcTaxTotal(cart, taxInclusive) {
  if (!taxInclusive) return 0;
  return cart.reduce((s, i) => {
    const rate = i.effectiveTaxRate || 0;
    const itemTotal = i.price * i.quantity;
    return s + (itemTotal - itemTotal / (1 + rate / 100));
  }, 0);
}

/**
 * Grand total: subtotal minus discount, plus exclusive tax (if applicable).
 * Always >= 0.
 * @param {number} grossTotal
 * @param {number} discountValue
 * @param {number} taxTotal
 * @param {boolean} taxInclusive
 * @returns {number}
 */
export function calcTotal(grossTotal, discountValue, taxTotal, taxInclusive) {
  return Math.max(0, grossTotal - discountValue + (taxInclusive ? 0 : taxTotal));
}
