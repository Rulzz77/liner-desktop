import { Innertube, Platform } from "youtubei.js/web";
import { getClientVisitorData } from "../session/visitorSession";
import { InnertubeError } from "./innertubeClient";
import {
  selectBestAudioFormat,
  toResolvedStream,
  type AudioFormat,
  type ResolvedAudioStream,
} from "./innertubeAudioFormats";

interface WebRemixSession {
  visitorData: string;
  innertube: Innertube;
}

let sessionPromise: Promise<WebRemixSession> | null = null;
let evaluatorInstalled = false;

function installPlayerEvaluator(): void {
  if (evaluatorInstalled) return;
  Platform.shim.eval = async (data, env) => {
    const args = [env.n, env.sp, env.sig].map((value) =>
      JSON.stringify(value ?? ""),
    );
    return new Function(
      `${data.output}\nreturn process(${args.join(", ")});`,
    )();
  };
  evaluatorInstalled = true;
}

async function createSession(visitorData: string): Promise<WebRemixSession> {
  const innertube = await Innertube.create({
    visitor_data: visitorData,
    user_agent: navigator.userAgent,
    generate_session_locally: true,
    retrieve_player: true,
    fetch: (input, init) => fetch(input, init),
  });
  return { visitorData, innertube };
}

async function getSession(visitorData: string): Promise<WebRemixSession> {
  const existing = sessionPromise
    ? await sessionPromise.catch(() => null)
    : null;
  if (existing && existing.visitorData === visitorData) return existing;
  sessionPromise = createSession(visitorData);
  sessionPromise.catch(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

export function resetWebRemixSession(): void {
  sessionPromise = null;
}

export type WebPlayer = NonNullable<Innertube["session"]["player"]>;

export interface WebRemixFormatLike {
  itag: number;
  has_audio: boolean;
  has_video: boolean;
  mime_type: string;
  bitrate?: number;
  average_bitrate?: number;
  content_length?: string | number;
  decipher: (player: WebPlayer) => Promise<string>;
}

/**
 * Prefer standalone AAC, then muxed AAC, and only then other audio-only
 * formats. This matters on Android devices/WebViews that cannot decode Opus.
 */
export function chooseWebRemixAudioFormat<T extends WebRemixFormatLike>(
  adaptiveFormats: readonly T[],
  progressiveFormats: readonly T[],
  isAndroid: boolean,
  preferredCodec: "opus" | "aac" = "aac",
  excludedItags: readonly number[] = [],
): { candidate: AudioFormat; source: T } | null {
  const audioOnly = adaptiveFormats.filter(
    (format) =>
      format.has_audio &&
      !format.has_video &&
      format.mime_type.startsWith("audio/"),
  );
  const toCandidates = (
    formats: readonly T[],
    forceAudioMime = false,
  ): AudioFormat[] =>
    formats.map((format) => ({
      itag: format.itag,
      url: "",
      mimeType: forceAudioMime ? "audio/mp4" : format.mime_type,
      bitrate: format.bitrate || format.average_bitrate || 0,
      ...(Number(format.content_length) > 0
        ? { contentLength: Number(format.content_length) }
        : {}),
    }));
  const choose = (
    formats: readonly T[],
    forceAudioMime = false,
  ): { candidate: AudioFormat; source: T } | null => {
    const candidates = toCandidates(formats, forceAudioMime);
    const candidate = selectBestAudioFormat(
      candidates,
      preferredCodec,
      excludedItags,
    );
    const source = candidate
      ? formats.find((format) => format.itag === candidate.itag)
      : undefined;
    return candidate && source ? { candidate, source } : null;
  };

  if (!isAndroid) return choose(audioOnly);

  const standaloneAac = audioOnly.filter((format) =>
    format.mime_type.startsWith("audio/mp4"),
  );
  const standaloneAacChoice = choose(standaloneAac);
  if (standaloneAacChoice) return standaloneAacChoice;

  const muxedAac = progressiveFormats.filter(
    (format) =>
      format.has_audio &&
      format.has_video &&
      format.mime_type.startsWith("video/mp4") &&
      format.mime_type.includes("mp4a.40.2"),
  );
  const muxedAacChoice = choose(muxedAac, true);
  if (muxedAacChoice) return muxedAacChoice;

  return choose(audioOnly);
}

export async function getWebPlayer(): Promise<WebPlayer> {
  installPlayerEvaluator();
  const { innertube } = await getSession(await getClientVisitorData());
  const player = innertube.session.player;
  if (!player)
    throw new InnertubeError("YouTube player script is unavailable.", 502);
  return player;
}

async function mintContentPoToken(videoId: string): Promise<string> {
  const mint =
    typeof window === "undefined"
      ? undefined
      : window.linerElectron?.mintPoToken;
  if (mint) return mint(videoId);

  if (
    typeof __LINER_TARGET__ !== "undefined" &&
    __LINER_TARGET__ === "android"
  ) {
    const { mintBrowserPoToken } = await import("./browserPoToken");
    return mintBrowserPoToken(videoId);
  }

  throw new InnertubeError("PO tokens need a newer Liner app version.", 501);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

export async function resolveWebRemixAudioStream(
  videoId: string,
  options: {
    signal?: AbortSignal;
    preferredCodec?: "opus" | "aac";
    excludedItags?: readonly number[];
  } = {},
): Promise<ResolvedAudioStream> {
  installPlayerEvaluator();
  const [poToken, visitorData] = await Promise.all([
    mintContentPoToken(videoId),
    getClientVisitorData(),
  ]);
  throwIfAborted(options.signal);
  const { innertube } = await getSession(visitorData);
  throwIfAborted(options.signal);
  const info = await innertube.getBasicInfo(videoId, {
    client: "YTMUSIC",
    po_token: poToken,
  });
  throwIfAborted(options.signal);
  const status = info.playability_status?.status;
  if (status !== "OK")
    throw new InnertubeError(
      info.playability_status?.reason || `WEB_REMIX: ${status}`,
      403,
    );

  const selection = chooseWebRemixAudioFormat(
    info.streaming_data?.adaptive_formats ?? [],
    info.streaming_data?.formats ?? [],
    typeof __LINER_TARGET__ !== "undefined" && __LINER_TARGET__ === "android",
    options.preferredCodec,
    options.excludedItags,
  );
  if (!selection)
    throw new InnertubeError(
      "WEB_REMIX returned no audio-only or muxed AAC formats.",
      502,
    );

  const { candidate, source } = selection;
  const player = innertube.session.player;
  if (!player)
    throw new InnertubeError("YouTube player script is unavailable.", 502);

  const deciphered = await source.decipher(player);
  throwIfAborted(options.signal);
  const url = new URL(deciphered);
  url.searchParams.set("pot", poToken);
  return toResolvedStream({ ...candidate, url: url.toString() });
}
