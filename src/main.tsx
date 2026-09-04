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

/**
 * The splash in index.html covers the real cost of starting: parsing the
 * bundle, restoring the autosave, and painting the first view. It is dismissed
 * from here, after that work is done, rather than on a timer — a fixed delay
 * would be too long on a fast machine and too short on a slow one.
 */
function dismissSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('leaving');
  setTimeout(() => splash.remove(), 240);
}

export function splashProgress(note: string) {
  const element = document.getElementById('splash-note');
  if (element) element.textContent = note;
}

splashProgress('Loading the interface');

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App onReady={dismissSplash} />
    </ErrorBoundary>
  </React.StrictMode>
);
