/**
 * One Toy Store pilot F2 (D52): the till's "Online" payment button.
 *
 * Mirrors backend/services/online-payments.js. A payment is saved as
 * "Online - <choice>" (plain hyphen, so CSV downloads read right in Excel).
 * The choices come from Company Profile (GET /api/company-profile/online-payment-options);
 * the last list seen is kept in localStorage so an offline till still has it.
 */
import { useEffect, useState } from "react";
import { api } from "../api";

export const ONLINE_PREFIX = "Online";
export const DEFAULT_ONLINE_OPTIONS = ["EasyPaisa", "JazzCash", "Allied", "Meezan", "MCB", "HBL", "Alfalah"];
const CACHE_KEY = "sanopos_online_payment_options";

export const onlineMethodName = (choice) => `${ONLINE_PREFIX} - ${choice}`;

export const isOnlineMethod = (method) =>
  typeof method === "string" && (method === ONLINE_PREFIX || method.startsWith(`${ONLINE_PREFIX} - `));

/** "Online - JazzCash" → "JazzCash"; anything else → null. */
export const onlineChoiceOf = (method) =>
  isOnlineMethod(method) && method.length > ONLINE_PREFIX.length + 3
    ? method.slice(ONLINE_PREFIX.length + 3)
    : null;

function readCache() {
  try {
    const list = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    return null;
  }
}

function writeCache(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch { /* storage blocked: the defaults still work */ }
}

/** The shop's Online choices, in order. Never empty. */
export function useOnlinePaymentOptions() {
  const [options, setOptions] = useState(() => readCache() || DEFAULT_ONLINE_OPTIONS);
  useEffect(() => {
    let alive = true;
    api.get("/api/company-profile/online-payment-options")
      .then((data) => {
        const list = data?.online_payment_options;
        if (!alive || !Array.isArray(list) || !list.length) return;
        setOptions(list);
        writeCache(list);
      })
      .catch(() => { /* offline or older server: keep the cached/default list */ });
    return () => { alive = false; };
  }, []);
  return options;
}

/** After Company Profile saves a new list, refresh the till's copy too. */
export const rememberOnlinePaymentOptions = writeCache;
