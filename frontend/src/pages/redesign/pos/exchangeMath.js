// Money for an exchange (F1 / D48). Pure, so the screen and the tests share it.
//
// The exchange sale keeps its existing shape: the return value rides in
// discount_amount AND as a "Return Credit" payment. A discount on the balance
// (only when the customer owes money) is added to discount_amount and taken
// off what the customer pays, never below 0.
const round2 = (n) => Math.round(n * 100) / 100;

export function exchangeSettlement({ refundTotal, exchangeTotal, discountInput, discountType, settleMethod }) {
  const refund = round2(Number(refundTotal) || 0);
  const total = round2(Number(exchangeTotal) || 0);
  const balance = round2(total - refund);

  let discount = 0;
  if (balance > 0) {
    const raw = Math.max(0, Number(discountInput) || 0);
    const asked = discountType === "percent" ? (balance * Math.min(raw, 100)) / 100 : raw;
    discount = round2(Math.min(balance, asked));
  }
  const due = balance > 0 ? round2(balance - discount) : 0;

  const payments = [];
  if (balance < 0) {
    // Customer is owed money: return credit covers the whole exchange total.
    payments.push({ method: "Return Credit", amount: total });
  } else if (balance > 0) {
    if (refund > 0) payments.push({ method: "Return Credit", amount: refund });
    if (due > 0) payments.push({ method: settleMethod, amount: due });
  }
  // balance === 0: return credit covers it exactly, sale total is 0, no payment.

  return { balance, discount, due, payments, saleDiscountAmount: round2(refund + discount) };
}
