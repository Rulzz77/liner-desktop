import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "@/shared/contracts";

const mocks = vi.hoisted(() => ({
  parseImportSource: vi.fn(),
  searchRaw: vi.fn(),
}));

vi.mock("../parseImportSource", () => ({
  parseImportSource: mocks.parseImportSource,
}));
vi.mock("@/shared/youtube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/youtube")>();
  return { ...actual, searchRaw: mocks.searchRaw };
});

import { api } from "@/shared/api";
import { runClientImport } from "./clientImportManager";
import { finalizeImportedPlaylist } from "./finalizeImport";
import { listLocalPlaylists } from "../../localPlaylists";

function searchTrack(
  id: string,
  title: string,
  artist: string,
  durationMs: number,
): SearchResult {
  return {
    type: "track",
    id,
    title,
    artists: [{ id: `UC_${artist}`, name: artist }],
    durationMs,
  };
}

const spotifyPlaylist = {
  source: "spotify" as const,
  sourceUrl: "https://open.spotify.com/playlist/abc",
  title: "Road trip",
  tracks: [
    {
      sourceId: "sp1",
      title: "Blinding Lights",
      artists: ["The Weeknd"],
      durationMs: 200_040,
    },
    {
      sourceId: "sp2",
      title: "Some Obscure Demo",
      artists: ["Nobody Known"],
      durationMs: 61_000,
    },
  ],
};

afterEach(() => {
  window.localStorage.removeItem("liner:local-playlists:v1");
  vi.restoreAllMocks();
  mocks.parseImportSource.mockReset();
  mocks.searchRaw.mockReset();
});

describe("runClientImport", () => {
  it("auto-approves confident matches and leaves the rest out of the playlist", async () => {
    mocks.parseImportSource.mockResolvedValue(spotifyPlaylist);
    mocks.searchRaw.mockImplementation(async (query: string) =>
      query.toLowerCase().includes("blinding")
        ? [searchTrack("4NRXx6U8ABQ", "Blinding Lights", "The Weeknd", 200_000)]
        : [],
    );
    const progress: number[] = [];

    const outcome = await runClientImport(spotifyPlaylist.sourceUrl, {
      onProgress: (update) =>
        progress.push(update.result.imported + update.result.skipped),
    });

    expect(outcome.approvedTracks.map((track) => track.id)).toEqual([
      "4NRXx6U8ABQ",
    ]);
    expect(outcome.result).toEqual({ total: 2, imported: 1, skipped: 1 });
    expect(outcome.reviewItems).toEqual([]);
    expect(progress[progress.length - 1]).toBe(2);
  });

  it("sends ambiguous matches with a candidate to review", async () => {
    mocks.parseImportSource.mockResolvedValue({
      ...spotifyPlaylist,
      tracks: [spotifyPlaylist.tracks[0]],
    });
    mocks.searchRaw.mockResolvedValue([
      searchTrack(
        "liveversion",
        "Blinding Lights (Live at SNL)",
        "The Weeknd",
        260_000,
      ),
    ]);

    const outcome = await runClientImport(spotifyPlaylist.sourceUrl);

    expect(outcome.approvedTracks).toEqual([]);
    expect(outcome.reviewItems).toHaveLength(1);
    expect(outcome.reviewItems[0]).toMatchObject({
      status: "pending",
      proposedTrack: { id: "liveversion" },
      position: 0,
    });
  });

  it("uses youtube ids directly without searching", async () => {
    mocks.parseImportSource.mockResolvedValue({
      source: "youtube",
      sourceUrl: "https://music.youtube.com/playlist?list=PL1",
      title: "Mine",
      canonicalTrackIds: ["dQw4w9WgXcQ"],
      tracks: [
        {
          sourceId: "dQw4w9WgXcQ",
          title: "Never Gonna Give You Up",
          artists: ["Rick Astley"],
          durationMs: 213_000,
        },
      ],
    });

    const outcome = await runClientImport(
      "https://music.youtube.com/playlist?list=PL1",
    );

    expect(mocks.searchRaw).not.toHaveBeenCalled();
    expect(outcome.approvedTracks[0]).toMatchObject({
      id: "dQw4w9WgXcQ",
      cover: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
    });
  });
});

describe("finalizeImportedPlaylist", () => {
  const track = {
    id: "dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    artists: [{ id: "UC1", name: "Rick Astley" }],
    durationMs: 213_000,
  };

  it("saves deduplicated imported tracks locally without account API calls", async () => {
    const createServerPlaylist = vi.spyOn(api, "createPlaylist");
    const addServerTracks = vi.spyOn(api, "addPlaylistTrackSnapshots");

    const result = await finalizeImportedPlaylist(
      "Mine",
      "Imported from Spotify",
      [track, track],
    );

    expect(result.playlistId).toMatch(/^local-playlist:/);
    expect(result.saved).toBe(1);
    expect(createServerPlaylist).not.toHaveBeenCalled();
    expect(addServerTracks).not.toHaveBeenCalled();

    const playlists = await listLocalPlaylists();
    expect(playlists).toHaveLength(1);
    expect(playlists[0]).toMatchObject({
      id: result.playlistId,
      title: "Mine",
      description: "Imported from Spotify",
    });
    expect(playlists[0].tracks).toHaveLength(1);
    expect(playlists[0].tracks[0]).toMatchObject({
      id: track.id,
      title: track.title,
      artists: "Rick Astley",
      durationMs: track.durationMs,
    });
  });

  it("can save an imported playlist locally with no Liner account session", async () => {
    const result = await finalizeImportedPlaylist("Offline mix", undefined, [
      track,
    ]);

    expect(result.saved).toBe(1);
    expect((await listLocalPlaylists()).map((playlist) => playlist.title)).toContain(
      "Offline mix",
    );
    expect(api.createPlaylist).not.toHaveBeenCalled();
  });
});
