import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/cormorant-garamond/700.css';
import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyTheme, watchColorScheme } from './theme.ts';

watchColorScheme(applyTheme);

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

const info = await window.hasbihal.getAppInfo();

createRoot(root).render(
  <StrictMode>
    <App info={info} />
  </StrictMode>,
);
