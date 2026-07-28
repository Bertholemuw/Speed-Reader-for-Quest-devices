import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // The Take 5 service stays bound to loopback; the dashboard reaches
          // it through here. Start it with `cd take5 && npm run serve`.
          '/take5-api': {
            target: `http://127.0.0.1:${env.TAKE5_PORT || 4173}`,
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/take5-api/, ''),
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
