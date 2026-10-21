// One Toy Store pilot (2026-10-21): the live kiosk said "Camera not working"
// on every load because vercel.json sent `Permissions-Policy: camera=()`,
// which forbids the camera on every page of sanopos.com (the local Vite test
// passed because the dev server sends no such header). The kiosk photo needs
// the camera on our own pages; other sites framing us still get none.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const vercel = JSON.parse(readFileSync(resolve(__dirname, "../../vercel.json"), "utf8"));
const policy = vercel.headers
  .flatMap((h) => h.headers)
  .find((h) => h.key.toLowerCase() === "permissions-policy")?.value;

describe("vercel.json Permissions-Policy", () => {
  it("allows the camera on our own pages (kiosk clock-in photo)", () => {
    expect(policy).toMatch(/(^|,\s*)camera=\(self\)/);
  });

  it("still blocks the microphone", () => {
    expect(policy).toMatch(/(^|,\s*)microphone=\(\)/);
  });
});
