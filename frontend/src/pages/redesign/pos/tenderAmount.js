// One Toy Store pilot (owner, 2026-10-01): what the checkout Amount box holds.
// Cash starts empty so the cashier types (or taps) what the customer handed
// over; every other method (Card, Online, Cut from salary, ...) is always the
// exact amount due, so it starts filled in. Note buttons ADD a note.
export const NOTE_BUTTONS = [50, 100, 500, 1000, 5000];

export function startAmount(method, remaining) {
  if (method === "Cash") return "";
  const due = Number(remaining) || 0;
  return due > 0 ? due.toFixed(2) : "";
}

// D59 (owner, 2026-10-19): an Online amount is what the customer actually
// sent, even above what is due; the difference is change from the drawer
// (the till shows Change Due, the bill books it as a Cash minus line).
export function onlineTender(typed) {
  const amt = Number(typed);
  return Number.isFinite(amt) && amt > 0 ? amt : 0;
}

export function addNote(current, note) {
  const now = Number(current);
  return ((Number.isFinite(now) ? now : 0) + note).toFixed(2);
}
