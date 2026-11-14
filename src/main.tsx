/// <reference types="vite/client" />
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (Capacitor.isNativePlatform()) {
  // Inside Capacitor Android APK, native CapacitorUpdater manages offline bundles.
  // Unregister any leftover Service Worker so it never serves stale cache over hot-updated bundles.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const r of regs) r.unregister();
      })
      .catch(() => {});
  }
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
