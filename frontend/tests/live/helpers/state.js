import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const STATE_FILE = resolve(import.meta.dirname, "../state.json");

export function readState() {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

export function writeState(updates) {
  const current = readState();
  const next = { ...current, ...updates };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}
