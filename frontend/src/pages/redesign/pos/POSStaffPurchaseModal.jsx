import React from "react";
import { Button, Modal } from "../../../ui/primitives";
import { usePOS } from "./POSContext";

/**
 * One Toy Store F3b part 2: pick the staff member taking toys at cost. The
 * bill keeps the normal price and a "Staff" discount brings it down to cost;
 * it is paid Cash, Online, or Cut from salary (onto their staff account).
 */
export default function POSStaffPurchaseModal({ open, onClose }) {
  const { staffList, staffListError, staffPurchase, startStaffPurchase, clearStaffPurchase } = usePOS();

  const pick = (person) => {
    startStaffPurchase(person);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Staff purchase (at cost)" size="md">
      <div className="space-y-3 text-sm">
        <p className="text-(--ui-text-muted)">
          Who is taking the toys? Prices drop to cost as a Staff discount. Pay with Cash, Online or Cut from salary.
        </p>
        {staffListError && <p className="text-(--ui-danger)">{staffListError}</p>}
        <div className="grid grid-cols-2 gap-2">
          {staffList.map((s) => (
            <Button
              key={s.id}
              tone={staffPurchase?.id === s.id ? "primary" : "default"}
              onClick={() => pick(s)}
            >
              {s.name}
            </Button>
          ))}
        </div>
        {!staffList.length && !staffListError && (
          <p className="text-(--ui-text-muted)">Loading staff…</p>
        )}
        {staffPurchase && (
          <div className="border-t border-(--ui-border) pt-3">
            <Button tone="danger" onClick={() => { clearStaffPurchase(); onClose(); }}>
              Not a staff purchase
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
