import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In sviluppo l'API gira su Fastify (porta 3210) e Vite fa da proxy.
// VITE_BASE pubblica la UI in un sottopercorso (es. "/open2bill/" dietro nginx); default la radice.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
    // changeOrigin: false mantiene l'Host della pagina (localhost:5273): il server confronta
    // Origin e Host per respingere le richieste da altri siti (CSRF).
    proxy: { '/api': { target: 'http://127.0.0.1:3210', changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
