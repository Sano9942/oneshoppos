/**
 * One Toy Store pilot F2 (D52): the till's "Online" payment button.
 *
 * Customers pay by EasyPaisa / JazzCash / bank app. The till shows one Online
 * button, then the shop's choices; the payment is saved as
 * "Online - <choice>" (plain hyphen: CSV downloads carry no BOM, so an en dash
 * would read "â€“" in Excel). It is neither Cash (Close Shift only counts
 * 'Cash') nor Card (the gateway only runs for 'Card'), and every payment
 * report groups by the saved name, so it gets its own line.
 *
 * The list lives in company_profile.online_payment_options (v146) so the shop
 * can change banks from Company Profile. frontend/src/utils/onlinePayments.js
 * mirrors ONLINE_PREFIX and the defaults.
 */

const ONLINE_PREFIX = "Online";
const DEFAULT_ONLINE_OPTIONS = ["EasyPaisa", "JazzCash", "Allied", "Meezan", "MCB", "HBL", "Alfalah"];
const MAX_OPTIONS = 20;
const MAX_NAME = 30;

const ONLINE_OPTIONS_DDL = `
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS online_payment_options JSONB NOT NULL
  DEFAULT '${JSON.stringify(DEFAULT_ONLINE_OPTIONS)}'::jsonb;
`;

/** Clean a list from the Company Profile page; throws a 400-shaped error. */
function normalizeOnlineOptions(raw) {
  const fail = (msg) => Object.assign(new Error(msg), { statusCode: 400 });
  if (!Array.isArray(raw)) throw fail("online_payment_options must be a list");
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== "string") throw fail("Each choice must be text");
    const name = item.replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > MAX_NAME) throw fail(`"${name}" is longer than ${MAX_NAME} characters`);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (!out.length) throw fail("Keep at least one choice");
  if (out.length > MAX_OPTIONS) throw fail(`At most ${MAX_OPTIONS} choices`);
  return out;
}

/** Stored value → list; falls back to the defaults if unset or malformed. */
function readOnlineOptions(stored) {
  let list = stored;
  if (typeof list === "string") {
    try { list = JSON.parse(list); } catch { list = null; }
  }
  try {
    return normalizeOnlineOptions(list);
  } catch {
    return [...DEFAULT_ONLINE_OPTIONS];
  }
}

const onlineMethodName = (choice) => `${ONLINE_PREFIX} - ${choice}`;

module.exports = {
  ONLINE_PREFIX,
  DEFAULT_ONLINE_OPTIONS,
  ONLINE_OPTIONS_DDL,
  normalizeOnlineOptions,
  readOnlineOptions,
  onlineMethodName,
};
