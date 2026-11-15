import { buildURL, GOOG_API_KEY } from "bgutils-js/utils";
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";

const WEB_CLIENT_VERSION = "2.20250925.01.00";
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const INTERPRETER_HOSTS = new Set(["www.google.com", "www.gstatic.com"]);
const FETCH_TIMEOUT_MS = 20_000;
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const TOKEN_CACHE_LIMIT = 256;

interface RawChallenge {
  interpreterUrl?: {
    privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string;
  };
  interpreterJavascript?: {
    privateDoNotAccessOrElseSafeScriptWrappedValue?: string;
  };
  program?: string;
  globalName?: string;
}

interface ChallengeResponse {
  bgChallenge?: RawChallenge;
}

interface BotguardChallenge {
  program: string;
  globalName: string;
  interpreterUrl?: string;
  interpreterScript?: string;
}

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

function readChallenge(raw: RawChallenge | undefined): BotguardChallenge {
  const interpreterUrl =
    raw?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  const interpreterScript =
    raw?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;

  if (!raw?.program || !raw.globalName || !(interpreterUrl || interpreterScript)) {
    throw new Error("YouTube BotGuard challenge is missing.");
  }

  return {
    program: raw.program,
    globalName: raw.globalName,
    ...(interpreterUrl ? { interpreterUrl } : {}),
    ...(interpreterScript ? { interpreterScript } : {}),
  };
}

async function fetchWebChallenge(): Promise<BotguardChallenge> {
  const response = await fetch(
    "https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: WEB_CLIENT_VERSION,
            hl: "en",
            gl: "US",
          },
        },
        engagementType: "ENGAGEMENT_TYPE_UNBOUND",
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new Error(`YouTube BotGuard challenge failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as ChallengeResponse;
  return readChallenge(body.bgChallenge);
}

async function loadInterpreter(challenge: BotguardChallenge): Promise<string> {
  if (challenge.interpreterScript) return challenge.interpreterScript;

  const rawUrl = challenge.interpreterUrl ?? "";
  const url = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
  const target = new URL(url);

  if (
    target.protocol !== "https:" ||
    !INTERPRETER_HOSTS.has(target.hostname)
  ) {
    throw new Error("YouTube BotGuard interpreter host is not allowed.");
  }

  const response = await fetch(target.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `YouTube BotGuard interpreter download failed with HTTP ${response.status}.`,
    );
  }

  return response.text();
}

async function generateIntegrityToken(
  botguardResponse: string,
): Promise<{ token: string; ttlSeconds?: number }> {
  const response = await fetch(buildURL("GenerateIT", true), {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": GOOG_API_KEY,
      "x-user-agent": "grpc-web-javascript/0.1",
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `YouTube integrity token request failed with HTTP ${response.status}.`,
    );
  }

  const [token, ttlSeconds] = (await response.json()) as [
    string | null,
    number?,
  ];

  if (!token) {
    throw new Error("YouTube returned no integrity token.");
  }

  return { token, ...(ttlSeconds ? { ttlSeconds } : {}) };
}

async function createMinter(): Promise<MinterEntry> {
  const challenge = await fetchWebChallenge();
  const interpreter = await loadInterpreter(challenge);

  // The same official BotGuard/WebPo flow is used by the desktop worker.
  new Function(interpreter)();

  const botguard = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: globalThis,
  });

  const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
  const { token, ttlSeconds } = await generateIntegrityToken(botguardResponse);
  const minter = await WebPoMinter.create(
    { integrityToken: token.replace(/\+/g, "-").replace(/\//g, "_") },
    webPoSignalOutput,
  );

  const ttlMs =
    (ttlSeconds && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS) * 1000;

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
  if (!/^[\w=-]{1,128}$/.test(identifier)) {
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
      if (!token) throw new Error("YouTube PoToken minting returned an empty token.");

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
