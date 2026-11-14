import { initOfflineMode } from "@/features/connectivity/engine/offlineController";
import { initTelemetry } from "@/shared/telemetry";
import { initClientVisitorSession } from "@/shared/youtube";

let initialized = false;

/** Startup services that are safe to run inside the Android WebView. */
export function initAndroidServices(): void {
  if (initialized) return;
  initialized = true;

  initTelemetry();
  initClientVisitorSession();
  initOfflineMode();
}
