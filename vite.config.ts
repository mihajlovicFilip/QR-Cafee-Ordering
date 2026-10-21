/** Vite configuration — the dev server and the production build (React, Tailwind). */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// BASE_PATH is set when the app is served from a sub-folder, e.g. GitHub Pages:
// https://<user>.github.io/QR-Cafee-Ordering/ → BASE_PATH=/QR-Cafee-Ordering/
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: true },
});
