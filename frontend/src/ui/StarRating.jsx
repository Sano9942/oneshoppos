import { Star } from "lucide-react";

export function StarDisplay({ rating, size = 16, className = "" }) {
  return (
    <span className={`inline-flex gap-0.5 ${className}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= Math.round(rating) ? "text-yellow-400 fill-yellow-400" : "text-gray-300"}
        />
      ))}
    </span>
  );
}

export function StarPicker({ value, onChange, size = 24, className = "" }) {
  return (
    <span className={`inline-flex gap-0.5 ${className}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="focus:outline-none cursor-pointer"
        >
          <Star
            size={size}
            className={n <= value ? "text-yellow-400 fill-yellow-400" : "text-gray-300 hover:text-yellow-300"}
          />
        </button>
      ))}
    </span>
  );
}
