import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const projectRoot = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/\/$/, '');
  const apiKey =
    env.VITE_GEMINI_API_KEY ||
    env.VITE_API_KEY ||
    env.GEMINI_API_KEY ||
    env.API_KEY ||
    '';

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    define: {
      // Keep compatibility with legacy process.env key usage in the app.
      'process.env.API_KEY': JSON.stringify(apiKey),
      'process.env.GEMINI_API_KEY': JSON.stringify(apiKey),
    },
    resolve: {
      alias: {
        '@': projectRoot,
      },
    },
  };
});
