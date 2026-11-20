import '@fontsource/inter/400.css';
import '@fontsource/inter/400-italic.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/400-italic.css';
// Sonner's layout (where toasts stack), as a file: the CSP blocks the <style> it would inject.
import 'sonner/dist/styles.css';
import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { startI18n } from './i18n.tsx';
import { applyTheme, watchColorScheme } from './theme.ts';

watchColorScheme(applyTheme);
startI18n(await window.hasbihal.system.language());

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

const info = await window.hasbihal.getAppInfo();

createRoot(root).render(
  <StrictMode>
    <App info={info} />
  </StrictMode>,
);
