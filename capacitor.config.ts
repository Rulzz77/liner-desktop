import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rulzz77.linerandroid",
  appName: "Liner",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    // Use Android's native HTTP stack for fetch/XHR to avoid WebView CORS
    // preflight failures while preserving the request headers/signatures.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
