import { useState, useEffect, useMemo } from "react";
import { api } from "../../../../api";

// Historical fallback constants. Kept so that pre-v63 tenants (no
// /api/loyalty/config columns) and any transient config-fetch failures
// don't break checkout math.
const DEFAULT_EARN_RATE = 1; // 1pt per PKR 100 of spend
const DEFAULT_REDEEM_RATE = 10; // PKR 10 off per 100 points

export function useLoyaltyWallet({ customers, checkoutCustomerId, total, loyaltyConfig }) {
  const [checkoutWalletBalance, setCheckoutWalletBalance] = useState(0);
  const [checkoutWalletLoading, setCheckoutWalletLoading] = useState(false);
  const [redeemPointsOn, setRedeemPointsOn] = useState(false);
  const [payWithWalletOn, setPayWithWalletOn] = useState(false);

  // Use the tenant-configured rates when available; fall back to the
  // historical defaults when POSContext hasn't yet fetched config (or
  // the endpoint errored — the route itself falls back to the same
  // defaults, so this belt-and-braces path keeps the hook pure even if
  // the caller forgets to pass loyaltyConfig).
  const earnRate = Number(loyaltyConfig?.earn_rate ?? DEFAULT_EARN_RATE);
  const redeemRate = Number(loyaltyConfig?.redeem_rate ?? DEFAULT_REDEEM_RATE);

  useEffect(() => {
    if (!checkoutCustomerId) {
      setCheckoutWalletBalance(0);
      setRedeemPointsOn(false);
      setPayWithWalletOn(false);
      return;
    }
    setCheckoutWalletLoading(true);
    api.get(`/api/customers/${checkoutCustomerId}/wallet`)
      .then((d) => setCheckoutWalletBalance(Number(d.balance || 0)))
      .catch(() => setCheckoutWalletBalance(0))
      .finally(() => setCheckoutWalletLoading(false));
  }, [checkoutCustomerId]);

  const checkoutCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(checkoutCustomerId)) || null,
    [customers, checkoutCustomerId],
  );
  const checkoutCustomerPoints = checkoutCustomer?.loyalty_points || 0;
  const checkoutCustomerTier = checkoutCustomer
    ? {
        name: checkoutCustomer.tier_name,
        color: checkoutCustomer.tier_color,
        multiplier: Number(checkoutCustomer.tier_multiplier) || 1,
        discount: Number(checkoutCustomer.tier_discount) || 0,
      }
    : null;
  const tierMultiplier = checkoutCustomerTier?.multiplier || 1;
  const pointsEarned = Math.floor((total / 100) * earnRate * tierMultiplier);
  const pointsDiscount = redeemPointsOn
    ? Math.floor(checkoutCustomerPoints / 100) * redeemRate
    : 0;
  const pointsRedeemed = redeemPointsOn
    ? Math.floor(checkoutCustomerPoints / 100) * 100
    : 0;

  return {
    checkoutWalletBalance,
    checkoutWalletLoading,
    redeemPointsOn, setRedeemPointsOn,
    payWithWalletOn, setPayWithWalletOn,
    checkoutCustomerPoints,
    checkoutCustomerTier,
    pointsEarned,
    pointsDiscount,
    pointsRedeemed,
    // Exposed so POSCheckoutModal etc. can still display the "earn X pts"
    // line and the "redeem N pts → PKR Y off" toggle using the same
    // numbers the server will actually write.
    LOYALTY_EARN_RATE: earnRate,
    LOYALTY_REDEEM_RATE: redeemRate,
  };
}
