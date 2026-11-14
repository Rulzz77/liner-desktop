import type { Track } from "@/shared/contracts";
import { createLocalPlaylist } from "../localPlaylists";

export interface FinalizedPlaylist {
  playlistId: string;
  saved: number;
}

function uniqueTracks(tracks: Track[]): Track[] {
  return [
    ...new Map(
      tracks
        .filter((track) => Boolean(track?.id))
        .map((track) => [track.id, track] as const),
    ).values(),
  ];
}

export async function finalizeImportedPlaylist(
  title: string,
  description: string | undefined,
  tracks: Track[],
): Promise<FinalizedPlaylist> {
  const unique = uniqueTracks(tracks);
  const playlist = await createLocalPlaylist(
    title.trim().slice(0, 200) || "Imported playlist",
    description?.trim().slice(0, 2000) || undefined,
    unique,
  );
  return { playlistId: playlist.id, saved: playlist.tracks.length };
}
