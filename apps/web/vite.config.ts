import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // envDir is the repo root, so this reads the same .env the app does.
  const env = loadEnv(mode, '../../', 'VITE_');

  return {
    plugins: [react()],
    // One .env at the repo root rather than one per package.
    envDir: '../../',

    define: {
      /**
       * Whether this build carries the one-click test sign-in.
       *
       * A compile-time literal rather than a check on `import.meta.env`,
       * because Vite only substitutes variables that actually exist — a
       * *missing* one stays a property lookup on an object, which no minifier
       * can fold. The button markup and its warning banner then survive into
       * the bundle of every production build, readable by anyone.
       *
       * As a literal `false`, the whole branch is dead code and gets deleted.
       * `bun run check:no-dev-login` proves it after every build.
       */
      __DEV_LOGIN__: JSON.stringify(
        Boolean(env.VITE_DEV_LOGIN_EMAIL && env.VITE_DEV_LOGIN_PASSWORD),
      ),
    },

    server: {
      port: 5173,
      proxy: {
        '/v1': { target: 'http://localhost:8080', changeOrigin: true },
        '/health': { target: 'http://localhost:8080', changeOrigin: true },
      },
    },

    build: {
      // Vendors change slower than app code — separate chunks mean a deploy
      // re-downloads kilobytes, not the whole megabyte. hls.js already lives
      // in the Lesson chunk via the lazy route; supabase stays in the shell
      // because the session gate needs it on first paint.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            tanstack: ['@tanstack/react-query', '@tanstack/react-router'],
            supabase: ['@supabase/supabase-js'],
            zod: ['zod'],
          },
        },
      },
    },
  };
});
