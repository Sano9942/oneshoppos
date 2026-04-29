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
 * Tax amount for the cart, computed regardless of mode.
 *   - inclusive: backs tax out of the sticker price.
 *   - exclusive: tax sits on top of the price.
 * Each line uses its own `effectiveTaxRate` so mixed-rate carts work
 * (P8 / 3.14 fix — pre-fix this returned 0 in exclusive mode, silently
 * dropping tax from the cart UI).
 * @param {Array<{price: number, quantity: number, effectiveTaxRate: number}>} cart
 * @param {boolean} taxInclusive
 * @returns {number}
 */
export function calcTaxTotal(cart, taxInclusive) {
  return cart.reduce((s, i) => {
    const rate = i.effectiveTaxRate || 0;
    if (rate === 0) return s;
    const itemTotal = i.price * i.quantity;
    if (taxInclusive) {
      // back out tax already in price
      return s + (itemTotal - itemTotal / (1 + rate / 100));
    }
    // exclusive: tax sits on top
    return s + (itemTotal * rate / 100);
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
