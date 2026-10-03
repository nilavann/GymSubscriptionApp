import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// Self-hosted variable fonts (design_handoff_flexhub_mobile/README.md §Design tokens) — each
// package registers an `@font-face` per unicode subset, so the browser only downloads the
// subsets (in practice: latin) that the page's text actually needs.
import '@fontsource-variable/rubik/wght.css';
import '@fontsource-variable/schibsted-grotesk/wght.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
