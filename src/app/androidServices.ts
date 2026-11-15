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

  // Warm YouTube BotGuard once so first playback does not spend its resolver budget minting a PoToken.
  void import("@/shared/youtube/innertube/browserPoToken")
    .then(({ warmBrowserPoToken }) => warmBrowserPoToken())
    .then(() => console.info("[PoToken] Android WEB minter ready"))
    .catch((error: unknown) =>
      console.warn("[PoToken] Android WEB minter warm-up failed:", error),
    );
  initOfflineMode();
}
