import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '');
  const demoSeedingEnabled = ['1', 'true', 'yes'].includes(
    (env.SEED_DEMO_USER ?? '').toLowerCase(),
  );
  const canShowDemoCredentials =
    command === 'serve' &&
    mode !== 'production' &&
    (env.APP_ENV ?? '').toLowerCase() !== 'production' &&
    demoSeedingEnabled &&
    Boolean(env.DEMO_USER_PASSWORD);
  const demoLogin = canShowDemoCredentials
    ? {
        email: env.DEMO_USER_EMAIL?.trim() || 'demo@recruitai.local',
        password: env.DEMO_USER_PASSWORD,
      }
    : null;

  return {
    plugins: [react()],
    define: { __DEMO_LOGIN__: JSON.stringify(demoLogin) },
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': 'http://127.0.0.1:8000',
      },
    },
  };
});
