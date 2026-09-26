// One Toy Store pilot, blocker 3b′: the service worker's offline copy of the app
// page must be the one the counter last loaded. Before the fix the page ("/")
// was saved once, at install, and never again — after a few deploys an offline
// reload opened an old app whose code files had never been saved.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const SW_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");

function makeCaches() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const keyOf = (req) => (typeof req === "string" ? req : new URL(req.url).pathname);
    return {
      match: async (req) => m.get(keyOf(req)),
      put: async (req, res) => { m.set(keyOf(req), res); },
      addAll: async (urls) => { for (const u of urls) m.set(u, fakeResponse(`precached ${u}`)); },
    };
  };
  return { open, keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n), stores };
}

function fakeResponse(text, ok = true) {
  return { ok, text: async () => text, clone() { return fakeResponse(text, ok); } };
}

function loadSw(fetchImpl) {
  const listeners = {};
  const caches = makeCaches();
  const self = {
    location: { origin: "https://sanopos.com" },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  vm.runInNewContext(SW_SOURCE, { self, caches, fetch: fetchImpl, URL, Response: { error: () => fakeResponse("error", false) }, Promise });
  return { listeners, caches };
}

async function navigate(listeners, url) {
  let responded;
  const pending = [];
  listeners.fetch({
    request: { method: "GET", mode: "navigate", url },
    respondWith: (p) => { responded = p; },
    waitUntil: (p) => { pending.push(p); },
  });
  const res = await responded;
  await Promise.all(pending);
  return res;
}

describe("sw.js — the offline app page", () => {
  let online;
  beforeEach(() => { online = true; });
  const fetchImpl = async (req) => {
    if (!online) throw new TypeError("Failed to fetch");
    return fakeResponse(`fresh page for ${typeof req === "string" ? req : req.url}`);
  };

  it("an online page load refreshes the saved page, so an offline reload opens the latest app", async () => {
    const { listeners } = loadSw(fetchImpl);
    await navigate(listeners, "https://sanopos.com/pos");
    online = false;
    const res = await navigate(listeners, "https://sanopos.com/pos");
    expect(await res.text()).toBe("fresh page for https://sanopos.com/pos");
  });

  it("offline with nothing saved yet falls back to the install-time page", async () => {
    const { listeners } = loadSw(fetchImpl);
    await listeners.install?.({ waitUntil: async (p) => p });
    online = false;
    const res = await navigate(listeners, "https://sanopos.com/pos");
    expect(res.ok).toBe(true);
  });
});
