import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import { buildURL, getHeaders } from "bgutils-js/utils";
import { WebPoMinter } from "bgutils-js/webpo";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const FETCH_TIMEOUT_MS = 20_000;
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const TOKEN_CACHE_LIMIT = 256;

type WebPoMinterInstance = Awaited<ReturnType<typeof WebPoMinter.create>>;

interface MinterEntry {
  minter: WebPoMinterInstance;
  expiresAt: number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let minterEntry: MinterEntry | null = null;
let pendingMinter: Promise<MinterEntry> | null = null;
const tokenCache = new Map<string, CachedToken>();
const pendingTokens = new Map<string, Promise<string>>();

async function generateIntegrityToken(botguardResponse: string): Promise<{
  integrityToken: string;
  estimatedTtlSecs: number;
  mintRefreshThreshold: number;
  websafeFallbackToken: string;
}> {
  const response = await fetch(buildURL("GenerateIT", true), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `YouTube integrity token request failed with HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (
    !Array.isArray(payload) ||
    typeof payload[0] !== "string" ||
    payload[0].length === 0
  ) {
    const shape = Array.isArray(payload)
      ? `tuple length ${payload.length}`
      : typeof payload;
    throw new Error(
      `YouTube returned an invalid integrity token response (${shape}).`,
    );
  }

  const [
    integrityToken,
    estimatedTtlSecs,
    mintRefreshThreshold,
    websafeFallbackToken,
  ] = payload as [string, number, number, string];

  return {
    integrityToken,
    estimatedTtlSecs:
      Number.isFinite(estimatedTtlSecs) && estimatedTtlSecs > 0
        ? estimatedTtlSecs
        : DEFAULT_TTL_SECONDS,
    mintRefreshThreshold:
      Number.isFinite(mintRefreshThreshold) && mintRefreshThreshold > 0
        ? mintRefreshThreshold
        : 0,
    websafeFallbackToken:
      typeof websafeFallbackToken === "string" ? websafeFallbackToken : "",
  };
}

async function createMinter(): Promise<MinterEntry> {
  // Use BgUtils' maintained challenge flow rather than hand-building the
  // attestation request. It keeps the request shape and challenge handling
  // aligned with the current YouTube BotGuard protocol.
  const challenge = await getChallenge({
    fetchFunction: fetch,
    requestKey: REQUEST_KEY,
  });
  const interpreter =
    challenge.interpreterJavascript
      ?.privateDoNotAccessOrElseSafeScriptWrappedValue;

  if (!interpreter) {
    throw new Error("YouTube BotGuard interpreter is unavailable.");
  }

  new Function(interpreter)();

  const botguard = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: globalThis,
  });

  const webPoSignalOutput: WebPoSignalOutput = [];
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
  const integrityTokenData = await generateIntegrityToken(botguardResponse);
  const minter = await WebPoMinter.create(
    integrityTokenData,
    webPoSignalOutput,
  );

  const ttlMs = integrityTokenData.estimatedTtlSecs * 1000;
  return {
    minter,
    expiresAt: Date.now() + Math.max(ttlMs - REFRESH_MARGIN_MS, 60_000),
  };
}

async function getMinter(): Promise<MinterEntry> {
  if (minterEntry && Date.now() < minterEntry.expiresAt) return minterEntry;

  pendingMinter ??= createMinter()
    .then((entry) => {
      minterEntry = entry;
      return entry;
    })
    .finally(() => {
      pendingMinter = null;
    });

  return pendingMinter;
}

/** Prepare BotGuard/WEB PoToken state before the first track is requested. */
export async function warmBrowserPoToken(): Promise<void> {
  await getMinter();
}

function rememberToken(identifier: string, token: CachedToken): void {
  tokenCache.delete(identifier);
  tokenCache.set(identifier, token);
  while (tokenCache.size > TOKEN_CACHE_LIMIT) {
    const oldest = tokenCache.keys().next().value;
    if (oldest === undefined) break;
    tokenCache.delete(oldest);
  }
}

/**
 * Mint a video-bound YouTube WEB PoToken in the Android WebView.
 * Desktop continues to use its isolated Electron worker.
 */
export async function mintBrowserPoToken(identifier: string): Promise<string> {
  if (!/^[\\w=-]{1,128}$/.test(identifier)) {
    throw new Error("Invalid YouTube PoToken identifier.");
  }

  const cached = tokenCache.get(identifier);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const pending = pendingTokens.get(identifier);
  if (pending) return pending;

  const work = (async () => {
    try {
      const { minter, expiresAt } = await getMinter();
      const token = await minter.mintAsWebsafeString(identifier);
      if (!token) {
        throw new Error("YouTube PoToken minting returned an empty token.");
      }

      rememberToken(identifier, { token, expiresAt });
      return token;
    } catch (error) {
      minterEntry = null;
      throw error;
    } finally {
      pendingTokens.delete(identifier);
    }
  })();

  pendingTokens.set(identifier, work);
  return work;
}
