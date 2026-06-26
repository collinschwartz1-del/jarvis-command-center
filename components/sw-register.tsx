"use client";

import { useEffect } from "react";

// Registers the service worker (public/sw.js) once on the client. Gives the
// installed PWA an offline last-known-screen fallback on flaky mobile data.
// No-ops in browsers without SW support.
export function ServiceWorkerRegister() {
  useEffect(() => {
    // Never register the SW in dev — it cache-firsts stable-named dev chunks and
    // breaks HMR. The PWA offline fallback only matters for the deployed app.
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration failure is non-fatal — app still works online */
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
