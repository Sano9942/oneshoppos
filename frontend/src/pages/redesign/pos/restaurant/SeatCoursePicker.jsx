import { useEffect, useState } from "react";
import { usePOS } from "../POSContext";

// Phase 2-R.0 Day 4 — Seat + Course picker.
// Writes activeSeat / activeCourse on POSContext; the cart's overlay
// builder reads them in addToCartWithModifiers (POSContext.jsx) so every
// item added gets stamped with seat_number + course_name.

const COURSE_LABELS = {
  1: "Appetizer",
  2: "Salad",
  3: "Entrée",
  4: "Dessert",
  5: "Drinks",
};

export default function SeatCoursePicker({ asSheet = false }) {
  const { seatCount, activeSeat, setActiveSeat, activeCourse, setActiveCourse } = usePOS();
  const seats = Math.max(1, Number(seatCount) || 1);
  const seatOptions = Array.from({ length: seats }, (_, i) => i + 1);
  const courseOptions = [1, 2, 3, 4, 5];

  if (asSheet) {
    return (
      <div className="bg-(--ui-surface) border-t border-(--ui-border-strong) px-4 py-3">
        <PickerControls
          seatOptions={seatOptions}
          activeSeat={activeSeat}
          setActiveSeat={setActiveSeat}
          courseOptions={courseOptions}
          activeCourse={activeCourse}
          setActiveCourse={setActiveCourse}
          compact
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-(--ui-border-strong) bg-(--ui-surface) px-4 py-3 mb-3">
      <PickerControls
        seatOptions={seatOptions}
        activeSeat={activeSeat}
        setActiveSeat={setActiveSeat}
        courseOptions={courseOptions}
        activeCourse={activeCourse}
        setActiveCourse={setActiveCourse}
      />
    </div>
  );
}

function PickerControls({ seatOptions, activeSeat, setActiveSeat, courseOptions, activeCourse, setActiveCourse, compact = false }) {
  return (
    <div className={`flex items-center gap-3 ${compact ? "flex-wrap" : ""}`}>
      <Group label="Seat">
        <select
          value={activeSeat || 1}
          onChange={(e) => setActiveSeat(Number(e.target.value))}
          className="h-10 px-3 rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) text-sm font-bold text-(--ui-text) focus:outline-none focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus)"
        >
          {seatOptions.map((n) => (
            <option key={n} value={n}>Seat {n}</option>
          ))}
        </select>
      </Group>

      <Group label="Course">
        <div className="flex gap-1">
          {courseOptions.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setActiveCourse(n)}
              className={`h-10 px-3 rounded-lg text-xs font-bold border transition ${
                activeCourse === n
                  ? "bg-(--ui-primary) text-white border-(--ui-primary)"
                  : "bg-(--ui-surface) text-(--ui-text-muted) border-(--ui-border-strong) hover:border-(--ui-primary)"
              }`}
              title={COURSE_LABELS[n]}
            >
              <span className="block leading-none">C{n}</span>
              <span className="block text-[9px] opacity-80 mt-0.5">{COURSE_LABELS[n]}</span>
            </button>
          ))}
        </div>
      </Group>
    </div>
  );
}

function Group({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-(--ui-text-muted)">{label}</span>
      {children}
    </div>
  );
}

// Hook for callers that want to know if the viewport is portrait (< 900px)
// so they can render this picker as a bottom sheet.
export function useIsPortrait(threshold = 900) {
  const [portrait, setPortrait] = useState(
    typeof window !== "undefined" ? window.innerWidth < threshold : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${threshold - 1}px)`);
    const onChange = (e) => setPortrait(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [threshold]);
  return portrait;
}
