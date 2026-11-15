import React from "react";
import ReactDOM from "react-dom/client";
import { initGlobalErrorHandlers } from "@/shared/utils/globalErrorHandlers";
import { hydrateScreenCache } from "@/shared/cache/screenCache";
import { applyStoredTheme } from "@/shared/utils/storedTheme";

initGlobalErrorHandlers();

const isAndroidTarget = __LINER_TARGET__ === "android";
const isOverlay =
  !isAndroidTarget && window.location.hash.startsWith("#/overlay");

if (!isOverlay) applyStoredTheme();

if (isAndroidTarget) {
  document.documentElement.dataset.platform = "android";
  document.body.classList.add("android-app");
}

async function loadRoot(): Promise<React.ReactElement> {
  if (isOverlay) {
    const { default: OverlayApp } = await import("./app/OverlayApp");
    return <OverlayApp />;
  }

  const [{ default: App }, { default: RootErrorBoundary }] = await Promise.all([
    import("./app/App"),
    import("@/shared/ui/RootErrorBoundary"),
    hydrateScreenCache(),
  ]);

  if (isAndroidTarget) {
    const { initAndroidServices } = await import("./app/androidServices");
    initAndroidServices();
  } else {
    const { initMainWindowServices } = await import("./app/mainWindowServices");
    initMainWindowServices();
  }

  return (
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  );
}

const rootElement = document.getElementById("root");

if (rootElement) {
  void loadRoot().then((root) => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>{root}</React.StrictMode>,
    );
  });
}
