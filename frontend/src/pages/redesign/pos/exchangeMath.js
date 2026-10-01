// Money for an exchange (F1 / D48, D56). Pure, so the screen and the tests share it.
//
// D56 (2026-10-01, INV-00082): the new bill is saved at its REAL price, paid
// by a "Return Credit" tender up to the return value, plus money for any
// extra (sent with exchange_full_price so the server knows the credit is part
// of the tender). The return keeps its full value and says how much of it was
// spent on the new items (creditApplied) and the real method of the rest
// (returnMethod): money handed back comes off the drawer only when it's Cash.
// A discount on the balance (only when the customer owes money) is the only
// discount saved, never below 0.
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
  const creditApplied = round2(Math.min(refund, total));
  const moneyBack = balance < 0 ? round2(-balance) : 0;

  const payments = [];
  if (creditApplied > 0) payments.push({ method: "Return Credit", amount: creditApplied });
  if (due > 0) payments.push({ method: settleMethod, amount: due });

  return {
    balance,
    discount,
    due,
    payments,
    saleDiscountAmount: discount,
    creditApplied,
    moneyBack,
    returnMethod: moneyBack > 0 ? settleMethod : "Return Credit",
  };
}
