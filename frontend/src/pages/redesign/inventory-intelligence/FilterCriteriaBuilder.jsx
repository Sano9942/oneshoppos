import { Select } from "../../../ui/primitives";

export default function FilterCriteriaBuilder({
  value,
  onChange,
  outlets = [],
  categories = [],
  brands = [],
  suppliers = [],
}) {
  const set = (key, v) => {
    const next = { ...value };
    if (v === "" || v == null) delete next[key];
    else next[key] = key === "abc_rank" ? v : Number(v);
    onChange(next);
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">
        <span className="text-(--ui-text-muted)">
          Outlet <span className="text-(--ui-danger)">*</span>
        </span>
        <Select
          value={value.outlet_id ?? ""}
          onChange={(e) => set("outlet_id", e.target.value)}
          required
        >
          <option value="">Select an outlet</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-(--ui-text-muted)">Category</span>
        <Select
          value={value.category_id ?? ""}
          onChange={(e) => set("category_id", e.target.value)}
        >
          <option value="">Any</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-(--ui-text-muted)">Brand</span>
        <Select value={value.brand_id ?? ""} onChange={(e) => set("brand_id", e.target.value)}>
          <option value="">Any</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-(--ui-text-muted)">Supplier</span>
        <Select
          value={value.supplier_id ?? ""}
          onChange={(e) => set("supplier_id", e.target.value)}
        >
          <option value="">Any</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="space-y-1 text-sm sm:col-span-2">
        <span className="text-(--ui-text-muted)">ABC rank</span>
        <Select
          value={value.abc_rank ?? ""}
          onChange={(e) => set("abc_rank", e.target.value)}
        >
          <option value="">Any</option>
          <option value="A">A — top 80% of revenue</option>
          <option value="B">B — next 15%</option>
          <option value="C">C — last 5%</option>
        </Select>
      </label>
    </div>
  );
}
