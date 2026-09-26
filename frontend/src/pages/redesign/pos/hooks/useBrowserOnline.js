import { useEffect, useState } from "react";

// The browser's own online/offline flag, kept live. It only knows about the
// local network: with the shop's Wi-Fi up and its internet down it still says
// online, which is why the lookups and the queue also treat failed requests
// as offline (offlineLookup.js, useOfflineQueue.js).
export function useBrowserOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
