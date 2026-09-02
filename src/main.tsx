import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/ui.tsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
