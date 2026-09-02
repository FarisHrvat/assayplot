import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, ErrorBoundary } from './app/ui.tsx';
import './styles.css';

// Development only: lets the browser console and automated UI checks drive the
// document without going through file dialogs. Stripped from production builds.
if (import.meta.env.DEV) {
  void import('./app/store.ts').then((store) => {
    (window as any).__assayplot = store;
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');
createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
