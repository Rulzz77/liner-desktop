let held: string | null = null;

export function setHeldEdgeKey(key: string | null): void {
  held = key;
}

export function heldEdgeKey(): string | null {
  return held;
}

/**
 * Edge keys are injected by Electron's request interceptor on desktop.
 * Android uses CapacitorHttp instead, so the renderer must attach the header.
 */
export function edgeKeyHeadersForPlatform(
  platform: "android" | "desktop",
): Record<string, string> {
  return platform === "android" && held
    ? { "x-liner-edge": held }
    : {};
}
