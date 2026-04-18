// Phase 2-R.0 — Pure helper that groups a POS cart by (seat_number, course_name)
// for the restaurant check view. Extracted from RestaurantCartGrouped.jsx so the
// grouping behavior is unit-testable without mounting React.
//
// Conventions documented in the Phase 2-R.0 plan:
//   - DB column is course_name (string), but UI thinks in integer course numbers.
//   - We persist "course_${n}" and parse the trailing integer back here.
//   - course_name === "main" or missing falls back to course 1 — that's the
//     schema default for retail / non-restaurant flows that may share the cart.
//   - seat_number === null is a real bucket (un-seated items, e.g. shared
//     appetizers) — represented as seat 0 so it sorts to the top.

const courseNumberFrom = (name) => {
  if (!name || name === "main") return 1;
  const match = String(name).match(/^course_(\d+)$/);
  if (!match) return 1;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

export function groupCartBySeatAndCourse(cart) {
  if (!Array.isArray(cart) || cart.length === 0) return [];

  const buckets = new Map();
  for (const item of cart) {
    const seat = item.seat_number == null ? 0 : Number(item.seat_number);
    const course = courseNumberFrom(item.course_name);
    const key = `${seat}::${course}`;
    if (!buckets.has(key)) {
      buckets.set(key, { seat, course, items: [], subtotal: 0, itemCount: 0 });
    }
    const group = buckets.get(key);
    group.items.push(item);
    group.subtotal += Number(item.price || 0) * Number(item.quantity || 0);
    group.itemCount += Number(item.quantity || 0);
  }

  return Array.from(buckets.values()).sort((a, b) =>
    a.seat - b.seat || a.course - b.course
  );
}
