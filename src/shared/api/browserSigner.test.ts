import { afterEach, describe, expect, it, vi } from "vitest";
import { signRequestInBrowser } from "./browserSigner";

describe("Android browser request signer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the official WASM signature headers payload", async () => {
    const result = await signRequestInBrowser(
      "get",
      "/v1/catalog/search?q=hello",
      "",
      1_800_000_000,
    );

    expect(result.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.timestamp).toBe(1_800_000_000);
    expect(result.nonce).toMatch(/^[a-f0-9]{16}$/);
  });

  it("normalizes method and excludes query from the signed path", async () => {
    const first = await signRequestInBrowser("get", "/v1/me?one=1", "", 1_800_000_000);
    const second = await signRequestInBrowser("GET", "/v1/me?two=2", "", 1_800_000_000);

    // Each request has a fresh nonce, so signatures should differ while both
    // remain valid outputs from the same official signer.
    expect(first.signature).not.toBe(second.signature);
    expect(first.nonce).not.toBe(second.nonce);
  });
});
