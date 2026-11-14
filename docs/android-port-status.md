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

The current client deliberately obtains request signatures from the Electron main process. The browser request signer returns no signature when `window.linerElectron` is absent. Therefore online catalog, import matching, and other protected official-service requests are not expected to work in this Android shell until the service owner supplies or approves an Android signing integration.

Other Electron IPC features also need native replacements, notably YouTube PoToken/session handling, saved/local track file access, secure auth/session storage, system media controls, and background playback. A Capacitor APK can be built after the Android project is generated, but it must not be presented as feature-complete until those bridges are implemented and tested on-device.

Do not weaken or bypass the official service's request signing, authentication, edge-key, or rate-limit controls to make the Android build appear functional. Coordinate an approved Android integration with the service owner.
