// Pick one toy in a form (One Toy Store F5, D44): the till's search box until a
// toy is picked, then the picked toy with a Change button. Replaces the plain
// list of every item (10,044 at One Toy Store) on Stock Adjustments, Transfers
// and Promotions.
import ItemSearchBox from "./ItemSearchBox";
import { Button } from "./primitives";

export default function ItemPickField({ value, onChange, showStock = false, autoFocus = false }) {
  if (!value) {
    return <ItemSearchBox ariaLabel="Find toy" autoFocus={autoFocus} onPick={onChange} />;
  }
  const code = value.sku || value.barcode;
  return (
    <div className="flex items-center gap-3 rounded-(--ui-radius-sm) border border-(--ui-border) px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-(--ui-text)">{value.name}</div>
        <div className="text-xs text-(--ui-text-muted)">
          {code ? <span className="font-mono">{code}</span> : null}
          {showStock && value.local_stock !== undefined ? (
            <span className={code ? "ml-3" : ""}>In stock: {Number(value.local_stock)}</span>
          ) : null}
        </div>
      </div>
      <Button type="button" onClick={() => onChange(null)}>Change</Button>
    </div>
  );
}
