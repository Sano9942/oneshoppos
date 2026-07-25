import { get } from "../../helpers/api.js";
import { STORE_CODE } from "../../helpers/auth.js";

let _cache = null;

async function loadFlags() {
  if (_cache) return _cache;
  const res = await get("/api/feature-flags");
  if (!res.ok) {
    console.warn(`[smoke] feature-flags fetch failed (${res.status}) — treating all flags as false`);
    _cache = new Map();
    return _cache;
  }
  const flags = res.data?.flags || [];
  _cache = new Map(flags.map((f) => [f.key, !!f.enabled]));
  return _cache;
}

export async function isFlagEnabled(key) {
  const flags = await loadFlags();
  return flags.get(key) === true;
}

/**
 * Call inside `test.beforeAll` or at the top of a `test()`. If any of the required
 * flags is off, the test is skipped and a SKIP line is logged to stdout.
 *
 * @param {import('@playwright/test').TestType} test — the imported `test` object
 * @param {string} specName — short name used in the log line
 * @param {...string} flagKeys — one or more required flag keys
 */
export async function skipIfFlagOff(test, specName, ...flagKeys) {
  for (const key of flagKeys) {
    const enabled = await isFlagEnabled(key);
    if (!enabled) {
      console.log(`SKIP: ${specName} (${key}=false)`);
      test.skip(true, `Feature flag ${key} is disabled on ${STORE_CODE}`);
      return false;
    }
  }
  return true;
}

/** For runtime skips inside a single `test()` case when the beforeAll guard is too coarse. */
export async function softSkip(test, specName, ...flagKeys) {
  for (const key of flagKeys) {
    const enabled = await isFlagEnabled(key);
    if (!enabled) {
      console.log(`SKIP: ${specName} (${key}=false)`);
      test.skip();
      return false;
    }
  }
  return true;
}

export function __resetFlagCache() {
  _cache = null;
}
