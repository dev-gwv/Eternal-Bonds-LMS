import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 8 over the same web dist — one bundle → Android .aab + iOS archive.
 * BILLING_MODE=web_only for the store builds: memberships are bought on the
 * website (PLAN §7), so the binaries are entitlement-only and clear review.
 * Push arrives via FCM (Android) / FCM→APNs (iOS); the API already speaks it.
 */
const config: CapacitorConfig = {
  appId: 'club.eternalbuds.app',
  appName: 'Eternal Bonds',
  webDir: '../web/dist',
  server: {
    // No remote URL: the bundle is local, so the app works offline-first
    // with the queued-writes UI in apps/web/src/shared/offline.tsx.
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
