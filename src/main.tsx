import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ConsoleWindow } from './components/ConsoleWindow';
import { isConsoleWindow, isTauri, CONSOLE_WINDOW_LABEL } from './utils/consoleBus';

// The external console (Tauri WebviewWindow or browser popup) loads this same
// bundle and renders only the console view — no emulator state lives here.
// Routing: `?window=console` decides synchronously (browser popups); Tauri
// windows are additionally recognised by their window label (the pre-declared
// `emulator-console` window loads plain index.html).
function Root() {
  const [isConsole, setIsConsole] = useState<boolean>(() => isConsoleWindow());

  useEffect(() => {
    if (isConsole || !isTauri()) return;
    let cancelled = false;
    import('@tauri-apps/api/window')
      .then(m => {
        if (!cancelled && m.getCurrentWindow().label === CONSOLE_WINDOW_LABEL) {
          setIsConsole(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isConsole]);

  return isConsole ? <ConsoleWindow /> : <App />;
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
