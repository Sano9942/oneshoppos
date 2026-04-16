import { useState, useEffect, useMemo } from "react";
import { api } from "../../../../api";

const LOYALTY_EARN_RATE = 1;
const LOYALTY_REDEEM_RATE = 10;

export function useLoyaltyWallet({ customers, checkoutCustomerId, total }) {
  const [checkoutWalletBalance, setCheckoutWalletBalance] = useState(0);
  const [checkoutWalletLoading, setCheckoutWalletLoading] = useState(false);
  const [redeemPointsOn, setRedeemPointsOn] = useState(false);
  const [payWithWalletOn, setPayWithWalletOn] = useState(false);

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
  const pointsEarned = Math.floor((total / 100) * LOYALTY_EARN_RATE * tierMultiplier);
  const pointsDiscount = redeemPointsOn
    ? Math.floor(checkoutCustomerPoints / 100) * LOYALTY_REDEEM_RATE
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
    LOYALTY_EARN_RATE,
    LOYALTY_REDEEM_RATE,
  };
}
