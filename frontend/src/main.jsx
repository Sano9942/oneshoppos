import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './auth/AuthProvider.jsx'
import { CurrencyProvider } from './contexts/CurrencyContext.jsx'
import { ToastProvider } from './contexts/ToastContext.jsx'
import { ErrorBoundary } from './ui/ErrorBoundary.jsx'
import { PresetProvider } from './contexts/PresetContext.jsx'
import { SENTRY_DSN, ENV_MODE, IS_PROD } from './config.js'

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENV_MODE,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
  });
}

// Stale-chunk recovery. After a deploy, clients holding an old index hash try
// to lazy-load a chunk filename that no longer exists on the server. The page
// silently breaks. Sentry SANOPOS-FRONTEND-7 (2026-04-12) was exactly this.
//
// Vite emits `vite:preloadError` for failed dynamic chunk preloads; browsers
// surface "Failed to fetch dynamically imported module" via unhandledrejection.
// Catch both and reload once per session window (guarded so a real network
// outage doesn't infinite-loop).
import { looksLikeChunkLoadFailure, reloadOnceForChunkFailure } from "./utils/chunkReload";

window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  reloadOnceForChunkFailure();
});
window.addEventListener("unhandledrejection", (e) => {
  if (looksLikeChunkLoadFailure(e.reason)) reloadOnceForChunkFailure();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <CurrencyProvider>
        <ToastProvider>
          <AuthProvider>
            <PresetProvider>
              <App />
            </PresetProvider>
          </AuthProvider>
        </ToastProvider>
      </CurrencyProvider>
    </ErrorBoundary>
  </StrictMode>,
)

if (IS_PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
