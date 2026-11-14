import type { Track as ContractTrack } from "@/shared/contracts";
import type { Track } from "@/shared/types";

export interface LocalPlaylistRecord {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  tracks: Track[];
}

const STORAGE_KEY = "liner:local-playlists:v1";
const PREFIX = "local-playlist:";

function makeId(): string {
  return `${PREFIX}${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function makeItemId(): string {
  return `local-playlist-item:${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function isLocalPlaylistId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PREFIX);
}

const DB_NAME = "liner-guest-library";
const DB_VERSION = 1;
const STORE_NAME = "playlists";
let dbPromise: Promise<IDBDatabase> | null = null;

function readFallback(): LocalPlaylistRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalPlaylistRecord =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as LocalPlaylistRecord).id === "string" &&
            isLocalPlaylistId((item as LocalPlaylistRecord).id) &&
            Array.isArray((item as LocalPlaylistRecord).tracks),
        ),
    );
  } catch {
    return [];
  }
}

function openPlaylistDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Could not open local playlist database"));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("Local playlist database is blocked by another window"));
    };
  });
  return dbPromise;
}

async function readAll(): Promise<LocalPlaylistRecord[]> {
  try {
    const db = await openPlaylistDb();
    const records = await new Promise<LocalPlaylistRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as LocalPlaylistRecord[]);
      request.onerror = () => reject(request.error);
    });
    if (records.length > 0) return records;
    // One-time migration from the early localStorage implementation.
    const legacy = readFallback();
    if (legacy.length > 0) {
      await writeAll(legacy);
      return legacy;
    }
    return records;
  } catch {
    return readFallback();
  }
}

async function writeAll(playlists: LocalPlaylistRecord[]): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Local playlists are unavailable outside the app.");
  }
  try {
    const db = await openPlaylistDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const clearRequest = store.clear();
      clearRequest.onerror = () => reject(clearRequest.error);
      for (const playlist of playlists) store.put(playlist);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Playlist save was aborted"));
    });
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  } catch {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
    } catch {
      throw new Error(
        "Could not save this playlist on this device. Free up local storage and try again.",
      );
    }
  }
}

function emitChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("library:changed"));
  }
}

export function toLocalTrack(input: Track | ContractTrack): Track {
  const source = input as unknown as Record<string, unknown>;
  const rawArtists = source.artists;
  const artistList = Array.isArray(rawArtists)
    ? rawArtists
        .filter((artist) => artist && typeof artist === "object")
        .map((artist) => {
          const item = artist as Record<string, unknown>;
          return {
            id: typeof item.id === "string" ? item.id : "unknown",
            name: typeof item.name === "string" ? item.name : "Unknown artist",
          };
        })
    : undefined;
  const artists =
    typeof rawArtists === "string"
      ? rawArtists
      : artistList?.map((artist) => artist.name).join(", ") ?? "Unknown artist";
  const cover = source.cover;
  const coverUrl =
    typeof source.coverUrl === "string"
      ? source.coverUrl
      : cover && typeof cover === "object" &&
          typeof (cover as Record<string, unknown>).url === "string"
        ? String((cover as Record<string, unknown>).url)
        : "";

  return {
    id: String(source.id ?? ""),
    ...(typeof source.playlistItemId === "string"
      ? { playlistItemId: source.playlistItemId }
      : {}),
    title: String(source.title ?? "Unknown track"),
    artists,
    ...(typeof source.artistId === "string"
      ? { artistId: source.artistId }
      : {}),
    ...(artistList?.length ? { artistList } : {}),
    coverUrl,
    durationMs:
      typeof source.durationMs === "number" ? source.durationMs : 0,
    playCount: typeof source.playCount === "number" ? source.playCount : 0,
    ...(typeof source.explicit === "boolean"
      ? { explicit: source.explicit }
      : {}),
    ...(typeof source.releaseDate === "string"
      ? { releaseDate: source.releaseDate }
      : {}),
    ...(source.album && typeof source.album === "object"
      ? {
          album: {
            id: String((source.album as Record<string, unknown>).id ?? ""),
            title: String(
              (source.album as Record<string, unknown>).title ?? "",
            ),
          },
        }
      : {}),
  };
}

export async function listLocalPlaylists(): Promise<LocalPlaylistRecord[]> {
  return (await readAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getLocalPlaylist(
  id: string,
): Promise<LocalPlaylistRecord | null> {
  return (await readAll()).find((playlist) => playlist.id === id) ?? null;
}

export async function createLocalPlaylist(
  title: string,
  description?: string,
  tracks: Array<Track | ContractTrack> = [],
): Promise<LocalPlaylistRecord> {
  const now = new Date().toISOString();
  const normalizedTracks = tracks
    .map(toLocalTrack)
    .filter((track) => Boolean(track.id))
    .map((track) => ({
      ...track,
      playlistItemId: makeItemId(),
      addedAt: now,
    }));
  const playlist: LocalPlaylistRecord = {
    id: makeId(),
    title: title.trim().slice(0, 200) || "Untitled playlist",
    ...(description?.trim()
      ? { description: description.trim().slice(0, 2000) }
      : {}),
    createdAt: now,
    updatedAt: now,
    revision: 1,
    tracks: normalizedTracks,
  };
  await writeAll([...(await readAll()), playlist]);
  emitChanged();
  return playlist;
}

export async function updateLocalPlaylist(
  id: string,
  patch: { title?: string; description?: string },
): Promise<LocalPlaylistRecord> {
  const playlists = await readAll();
  const index = playlists.findIndex((playlist) => playlist.id === id);
  if (index < 0) throw new Error("Local playlist not found.");
  const current = playlists[index];
  const next: LocalPlaylistRecord = {
    ...current,
    ...(patch.title !== undefined
      ? { title: patch.title.trim().slice(0, 200) || current.title }
      : {}),
    ...(patch.description !== undefined
      ? { description: patch.description.trim().slice(0, 2000) }
      : {}),
    updatedAt: new Date().toISOString(),
    revision: current.revision + 1,
  };
  playlists[index] = next;
  await writeAll(playlists);
  emitChanged();
  return next;
}

export async function deleteLocalPlaylist(id: string): Promise<void> {
  const playlists = readAll();
  writeAll(playlists.filter((playlist) => playlist.id !== id));
  emitChanged();
}

export async function addLocalPlaylistTrack(
  playlistId: string,
  input: Track | ContractTrack,
): Promise<LocalPlaylistRecord> {
  const playlists = readAll();
  const index = playlists.findIndex((playlist) => playlist.id === playlistId);
  if (index < 0) throw new Error("Local playlist not found.");
  const track = toLocalTrack(input);
  if (!track.id) throw new Error("Track details are missing.");
  const current = playlists[index];
  if (current.tracks.some((item) => item.id === track.id)) return current;
  const next: LocalPlaylistRecord = {
    ...current,
    tracks: [
      ...current.tracks,
      {
        ...track,
        playlistItemId: makeItemId(),
        addedAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
    revision: current.revision + 1,
  };
  playlists[index] = next;
  writeAll(playlists);
  emitChanged();
  return next;
}

export async function removeLocalPlaylistTrack(
  playlistId: string,
  itemId: string,
): Promise<void> {
  const playlists = readAll();
  const index = playlists.findIndex((playlist) => playlist.id === playlistId);
  if (index < 0) throw new Error("Local playlist not found.");
  const current = playlists[index];
  const next: LocalPlaylistRecord = {
    ...current,
    tracks: current.tracks.filter(
      (track) => track.playlistItemId !== itemId,
    ),
    updatedAt: new Date().toISOString(),
    revision: current.revision + 1,
  };
  playlists[index] = next;
  writeAll(playlists);
  emitChanged();
}

export async function moveLocalPlaylistTrack(
  playlistId: string,
  itemId: string,
  beforeItemId: string | null,
): Promise<void> {
  const playlists = readAll();
  const index = playlists.findIndex((playlist) => playlist.id === playlistId);
  if (index < 0) throw new Error("Local playlist not found.");
  const current = playlists[index];
  const tracks = [...current.tracks];
  const from = tracks.findIndex((track) => track.playlistItemId === itemId);
  if (from < 0) throw new Error("Track was not found in this playlist.");
  const [moving] = tracks.splice(from, 1);
  const to =
    beforeItemId === null
      ? tracks.length
      : tracks.findIndex((track) => track.playlistItemId === beforeItemId);
  tracks.splice(to < 0 ? tracks.length : to, 0, moving);
  playlists[index] = {
    ...current,
    tracks,
    updatedAt: new Date().toISOString(),
    revision: current.revision + 1,
  };
  writeAll(playlists);
  emitChanged();
}
