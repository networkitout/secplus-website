import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyTheme, storedTheme } from './ui/theme';

// Applied here (not via an inline script) so the production CSP can stay `script-src 'self'`.
applyTheme(storedTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
