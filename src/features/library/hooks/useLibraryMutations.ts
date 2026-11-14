import { useCallback, useState } from "react";
import { api } from "@/shared/api";
import { notifyLibraryChanged, evictPlaylistFromCache } from "./usePlaylists";
import { setTrackLiked, toggleTrackLike } from "./useLikedTracks";
import {
  addLocalPlaylistTrack,
  createLocalPlaylist,
  deleteLocalPlaylist,
  isLocalPlaylistId,
  moveLocalPlaylistTrack,
  removeLocalPlaylistTrack,
} from "../services/localPlaylists";
import type { Track } from "@/shared/types";
import type { Track as ContractTrack } from "@/shared/contracts";

type Options = {
  onSuccess?: (...args: any[]) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};

function useMutation<T, R = unknown>(action: (input: T) => Promise<R>) {
  const [isPending, setIsPending] = useState(false);
  const mutateAsync = useCallback(
    async (input: T): Promise<R> => {
      setIsPending(true);
      try {
        const result = await action(input);
        notifyLibraryChanged();
        return result;
      } finally {
        setIsPending(false);
      }
    },
    [action],
  );
  const mutate = useCallback(
    (input: T, options?: Options) => {
      void mutateAsync(input)
        .then((value) => options?.onSuccess?.(value))
        .catch((error) => options?.onError?.(error))
        .finally(() => options?.onSettled?.());
    },
    [mutateAsync],
  );
  return { mutate, mutateAsync, isPending };
}

export function useAddPlaylistTracks() {
  return useMutation(
    async ({
      playlistId,
      trackId,
      track,
    }: {
      playlistId: string;
      trackId: string;
      track?: Track | ContractTrack;
    }) => {
      if (isLocalPlaylistId(playlistId)) {
        const snapshot = track ?? (await api.getTrack(trackId));
        return addLocalPlaylistTrack(playlistId, snapshot);
      }
      return api.addPlaylistTrack(playlistId, trackId);
    },
  );
}

export function useRemovePlaylistTracks() {
  return useMutation(
    ({ playlistId, itemId }: { playlistId: string; itemId: string }) =>
      isLocalPlaylistId(playlistId)
        ? removeLocalPlaylistTrack(playlistId, itemId)
        : api.removePlaylistItem(playlistId, itemId),
  );
}

export function useReorderPlaylistTracks() {
  return useMutation(
    ({
      playlistId,
      itemId,
      beforeItemId,
      revision,
    }: {
      playlistId: string;
      itemId: string;
      beforeItemId: string | null;
      revision: number;
    }) =>
      isLocalPlaylistId(playlistId)
        ? moveLocalPlaylistTrack(playlistId, itemId, beforeItemId)
        : api.movePlaylistItem(playlistId, itemId, beforeItemId, revision),
  );
}

export function useCreatePlaylist() {
  return useMutation(
    ({ title, description }: { title: string; description?: string }) =>
      createLocalPlaylist(title, description),
  );
}

export function useDeletePlaylist() {
  return useMutation(async ({ playlistId }: { playlistId: string }) => {
    evictPlaylistFromCache(playlistId);
    if (isLocalPlaylistId(playlistId)) {
      await deleteLocalPlaylist(playlistId);
      return;
    }
    await api.deletePlaylist(playlistId);
  });
}

export function useSaveExternalItem() {
  return useMutation(
    ({
      type,
      id,
      snapshot,
    }: {
      type: "album" | "artist" | "playlist";
      id: string;
      snapshot?: Record<string, unknown>;
    }) =>
      api.saveCollection(
        `${type}s` as "albums" | "artists" | "playlists",
        id,
        snapshot,
      ),
  );
}

export function useRemoveExternalItem() {
  return useMutation(
    async ({
      type,
      id,
      isOwned,
    }: {
      type: "album" | "artist" | "playlist";
      id: string;
      isOwned?: boolean;
    }) => {
      if (type === "playlist") {
        evictPlaylistFromCache(id);
        if (isLocalPlaylistId(id)) {
          await deleteLocalPlaylist(id);
          return;
        }
        if (isOwned === false) {
          return api.removeCollection("playlists", id);
        }
        try {
          const res = await api.deletePlaylist(id);
          // purge any saved collection reference in case it was both created and saved
          await api.removeCollection("playlists", id).catch(() => {});
          return res;
        } catch (err: unknown) {
          if (isOwned === true) {
            throw err;
          }
          // fall back to removing from saved collections if playlist was not owned
          return api.removeCollection("playlists", id);
        }
      }
      return api.removeCollection(`${type}s` as "albums" | "artists", id);
    },
  );
}

type TrackMutationInput = string | { trackId: string; [key: string]: unknown };
const trackIdFrom = (input: TrackMutationInput) =>
  typeof input === "string" ? input : input.trackId;

function useTrackLikeMutation(liked: boolean) {
  const mutateAsync = useCallback(
    (input: TrackMutationInput) => setTrackLiked(trackIdFrom(input), liked),
    [liked],
  );
  const mutate = useCallback(
    (input: TrackMutationInput, options?: Options) => {
      void mutateAsync(input)
        .then((value) => options?.onSuccess?.(value))
        .catch((error) => options?.onError?.(error))
        .finally(() => options?.onSettled?.());
    },
    [mutateAsync],
  );
  return { mutate, mutateAsync, isPending: false };
}

export function useLikeTrack() {
  return useTrackLikeMutation(true);
}

export function useUnlikeTrack() {
  return useTrackLikeMutation(false);
}

export function useToggleTrackLike() {
  return useCallback(
    (
      trackId: string,
      options?: {
        onSuccess?: (liked: boolean) => void;
        onError?: (error: unknown) => void;
      },
    ): boolean => {
      const { liked, settled } = toggleTrackLike(trackId);
      settled.then(
        () => options?.onSuccess?.(liked),
        (error) => options?.onError?.(error),
      );
      return liked;
    },
    [],
  );
}
