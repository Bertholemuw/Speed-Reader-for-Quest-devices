import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rsvp.speedreader',
  appName: 'RSVP Speed Reader',
  webDir: 'dist',
  android: {
    // Keep content clear of the status/navigation bars on edge-to-edge Android 15+.
    adjustMarginsForEdgeToEdge: 'force',
  },
};

export default config;
