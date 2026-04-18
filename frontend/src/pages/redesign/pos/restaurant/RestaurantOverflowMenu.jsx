import { Split as SplitIcon, Gift, Percent, ArrowRightLeft, UserPlus, StickyNote, Ban } from "lucide-react";
import { usePOS } from "../POSContext";

// Phase 2-R.0 Day 6 — Overflow popover for secondary restaurant actions.
// Rendered as a fixed-position panel above the 3-dot button in
// RestaurantActionBar. Discount + Note reuse existing POSContext toggles
// (POSDiscountModal / POSNoteModal are already mounted on the shell).
// Split + Transfer Table open dedicated Day-6 modals. Comp is stubbed off
// for 2-R.0 (manager PIN workflow lands in 2-R.2). Add Seat just bumps
// seatCount on POSContext so SeatCoursePicker exposes the new seat.

export default function RestaurantOverflowMenu({ open, onClose, onOpenSplit, onOpenTransfer, onOpen86, onOpenVoidComp }) {
  const {
    cart,
    setShowDiscountModal,
    setShowNoteModal,
    seatCount,
    setSeatCount,
    tableSessionId,
    showNotice,
    posFlags,
  } = usePOS();

  if (!open) return null;

  const cartEmpty = cart.length === 0;

  const items = [
    {
      key: "split",
      icon: SplitIcon,
      label: "Split",
      onClick: () => { onClose?.(); onOpenSplit?.(); },
      disabled: cartEmpty,
      disabledTooltip: "Add items before splitting",
    },
    // 2-R.2 — Void/Comp opens a manager PIN modal. Flag-gated so pre-v59
    // tenants don't see dead entries.
    ...(posFlags?.phase4_restaurant_void_comp
      ? [
          {
            key: "void",
            icon: Ban,
            label: "Void",
            onClick: () => { onClose?.(); onOpenVoidComp?.("void"); },
          },
          {
            key: "comp",
            icon: Gift,
            label: "Comp",
            onClick: () => { onClose?.(); onOpenVoidComp?.("comp"); },
          },
        ]
      : [
          {
            key: "comp",
            icon: Gift,
            label: "Comp",
            onClick: () => {},
            disabled: true,
            disabledTooltip: "Enable phase4_restaurant_void_comp",
          },
        ]),
    // 2-R.1 — "86 an item" launches the availability modal. Hidden when
    // the per-tenant flag is off so pre-v58 tenants don't see a dead entry.
    ...(posFlags?.phase4_restaurant_86
      ? [{
          key: "eighty_six",
          icon: Ban,
          label: "86 an item",
          onClick: () => { onClose?.(); onOpen86?.(); },
        }]
      : []),
    {
      key: "discount",
      icon: Percent,
      label: "Discount",
      onClick: () => { onClose?.(); setShowDiscountModal(true); },
      disabled: cartEmpty,
      disabledTooltip: "Add items before discounting",
    },
    {
      key: "transfer",
      icon: ArrowRightLeft,
      label: "Transfer Table",
      onClick: () => { onClose?.(); onOpenTransfer?.(); },
      disabled: !tableSessionId,
      disabledTooltip: "Only dine-in checks can be transferred",
    },
    {
      key: "add_seat",
      icon: UserPlus,
      label: "Add Seat",
      onClick: () => {
        setSeatCount(Math.min(20, (Number(seatCount) || 0) + 1));
        showNotice?.(`Added Seat ${(Number(seatCount) || 0) + 1}`);
        onClose?.();
      },
    },
    {
      key: "note",
      icon: StickyNote,
      label: "Note",
      onClick: () => { onClose?.(); setShowNoteModal(true); },
    },
  ];

  return (
    <>
      {/* Backdrop — tap outside to close */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute right-0 bottom-14 w-56 rounded-xl bg-white border border-slate-200 shadow-2xl z-50 p-2 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {items.map(({ key, icon: Icon, label, onClick, disabled, disabledTooltip }) => (
          <button
            key={key}
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            title={disabled ? disabledTooltip : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left font-semibold transition ${
              disabled
                ? "text-slate-400 cursor-not-allowed"
                : "text-slate-800 hover:bg-slate-100 active:bg-slate-200"
            }`}
          >
            <Icon size={16} className={disabled ? "text-slate-300" : "text-[#8066FF]"} />
            <span className="flex-1">{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
