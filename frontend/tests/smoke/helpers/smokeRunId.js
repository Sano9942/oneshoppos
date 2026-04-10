const ts = new Date().toISOString().replace(/[:.]/g, "-");
const rnd = Math.random().toString(36).slice(2, 8);

export const SMOKE_RUN_ID = `SMOKE-${ts}-${rnd}`;

export function prefix(name) {
  return `${SMOKE_RUN_ID}-${name}`;
}
