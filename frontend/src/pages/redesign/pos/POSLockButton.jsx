import React from "react";
import { Lock } from "lucide-react";
import { Button } from "../../../ui/primitives";
import { usePOS } from "./POSContext";
import { useBrowserOnline } from "./hooks/useBrowserOnline";

// Header Lock button. Unlocking checks the PIN on the server, so it is off
// while offline (owner decision 2026-09-26, One Toy Store blocker 3).
// handleLock also refuses when the server can't be reached with the browser
// still "online" (Wi-Fi up, internet down).
export default function POSLockButton() {
  const { handleLock } = usePOS();
  const online = useBrowserOnline();
  return (
    <Button
      tone="plain"
      size="sm"
      onClick={handleLock}
      disabled={!online}
      title={online ? "Lock the register" : "Lock needs the internet"}
    >
      <Lock size={14} /> <span className="hidden sm:inline">Lock</span>
    </Button>
  );
}
