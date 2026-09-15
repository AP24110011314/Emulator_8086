import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Tauri expects the dev server at a fixed URL (see src-tauri/tauri.conf.json
  // devUrl). strictPort prevents Vite from silently drifting to another port.
  server: {
    port: 5173,
    strictPort: true,
  },
  // Prevent Vite from clearing the screen so `tauri dev` output stays visible.
  clearScreen: false,
});