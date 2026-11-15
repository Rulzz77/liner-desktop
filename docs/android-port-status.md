# Android port status

## What this branch adds

- A separate Vite build mode: `android`.
- Capacitor 8.6.2 dependencies and configuration.
- Android-specific build/sync/open/run package scripts.
- Electron main/preload injection is excluded from the Android web build.
- Electron-only startup services and desktop integrations are gated from the Android WebView.
- Mobile viewport metadata and basic WebView layout defaults.

## Local setup

Requirements:

- Node.js 22 or newer.
- Android Studio 2025.2.1 or newer.
- Android SDK Platform 24 or newer.
- A configured Android device or emulator.

From the repository root:

```powershell
corepack pnpm install
corepack pnpm android:add
corepack pnpm android:sync
corepack pnpm android:open
```

To create a debug APK from PowerShell after Android has been added and synced:

```powershell
cd android
.\gradlew.bat assembleDebug
```

The APK is expected at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Important functional gaps before release

This is an Android build scaffold, not a completed native port yet.

The Android target now loads the same bundled Liner WASM request signer used by the Electron app and uses Capacitor's native HTTP transport for fetch/XHR to avoid WebView CORS preflight failures. The request signer does not fall back to unsigned API requests in Android builds.

This change has not yet been built and tested on a physical device. If online requests still fail, inspect Android WebView console/Logcat for the HTTP status and request ID; the server may also need to allow the Android client in its edge/origin policy. Do not bypass or disable server-side signing, authentication, edge-key, or rate-limit controls.

Other Electron IPC features still need native replacements, notably YouTube PoToken/session handling, saved/local track file access, secure auth/session storage, system media controls, and background playback. A successful APK build is not the same as a feature-complete Android port.
