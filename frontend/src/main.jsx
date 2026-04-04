import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './auth/AuthProvider.jsx'
import { CurrencyProvider } from './contexts/CurrencyContext.jsx'
import { ToastProvider } from './contexts/ToastContext.jsx'
import { ErrorBoundary } from './ui/ErrorBoundary.jsx'
import { SENTRY_DSN, ENV_MODE, IS_PROD } from './config.js'

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENV_MODE,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <CurrencyProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
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
