import type { CapacitorConfig } from '@capacitor/cli';

const isLiveReload = process.env.LIVE_RELOAD === 'false';

const config: CapacitorConfig = {
  appId: 'dev.pages.lingonow',
  appName: 'Lingo Now',
  webDir: 'dist',
  server: isLiveReload ? {
    url: 'http://localhost:5173',
    cleartext: true,
  } : undefined,
};

export default config;
