// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { useExternalItems } from "./useExternalItems";
import { api } from "@/shared/api";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/api", () => ({
  api: { listSavedCollections: vi.fn() },
  mediaUrl: (url: string) => url,
  toMaxQualityAvatarUrl: (url: string) => url,
  getAuthSession: authMocks.getAuthSession,
}));

const authMocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}));

const artistsResponse = {
  items: [
    {
      savedAt: "2026-10-20T10:00:00.000Z",
      artist: { id: "a1", name: "SZA", cover: { url: "sza.jpg" } },
    },
  ],
};

let latest: ReturnType<typeof useExternalItems> | null = null;

function Probe() {
  latest = useExternalItems("artist");
  return null;
}

describe("useExternalItems", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    authMocks.getAuthSession.mockReturnValue({
      accessToken: "test-token",
      user: { id: "u1" },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.listSavedCollections).mockResolvedValue(
      artistsResponse as any,
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    latest = null;
  });

  it("reports loading until saved artists arrive, then serves them instantly on the next open", async () => {
    await act(async () => {
      root.render(<Probe />);
    });
    expect(latest?.isLoading).toBe(false);
    expect(latest?.data.map((item) => item.title)).toEqual(["SZA"]);

    act(() => root.unmount());
    root = createRoot(container);
    vi.mocked(api.listSavedCollections).mockReturnValue(
      new Promise(() => undefined),
    );

    act(() => {
      root.render(<Probe />);
    });
    expect(latest?.isLoading).toBe(false);
    expect(latest?.data.map((item) => item.title)).toEqual(["SZA"]);
  });

  it("does not request cloud collections when no Liner session exists", async () => {
    authMocks.getAuthSession.mockReturnValue(null);
    vi.mocked(api.listSavedCollections).mockClear();

    await act(async () => {
      root.render(<Probe />);
    });

    expect(api.listSavedCollections).not.toHaveBeenCalled();
    expect(latest?.isLoading).toBe(false);
    expect(latest?.data).toEqual([]);
  });
});
