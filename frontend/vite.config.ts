import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The SpendWise Node server (npm start in the backend folder).
const API_TARGET = 'http://127.0.0.1:3000';

// Same-origin /api calls keep the HttpOnly sw_sid session cookie and the sw_csrf cookie on
// this origin. The backend rejects any write whose Origin host differs from the Host header
// (server/app.js checkCsrf), so the proxy must pass Host through unchanged: with
// changeOrigin false, the browser's real Origin (localhost:5173) matches Host (localhost:5173)
// and the cross-origin check keeps working instead of being bypassed.
const apiProxy: Record<string, ProxyOptions> = {
  '/api': { target: API_TARGET, changeOrigin: false },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 5173, proxy: apiProxy },
});
