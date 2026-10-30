import { defineConfig, loadEnv } from 'vite';

// The site and its API share one origin: the dev server forwards /api to ProxyMarket Server, so the
// browser sends Better Auth's cookie itself and no CORS is involved.
//
// The browser's Origin header (http://127.0.0.1:5173) is passed through unchanged, and the server
// must trust it (BETTER_AUTH_TRUSTED_ORIGINS). It is deliberately not rewritten: that would defeat
// the server's CSRF check.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: env.PROXYMARKET_API_TARGET || 'http://127.0.0.1:3000' },
      },
    },
  };
});
