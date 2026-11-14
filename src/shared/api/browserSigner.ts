import { SIGNER_WASM_BASE64 } from "../../../electron/signer";

export interface BrowserSignedRequest {
  signature: string;
  timestamp: number;
  nonce: string;
}

interface SignerExports {
  memory: WebAssembly.Memory;
  liner_alloc: (length: number) => number;
  liner_dealloc: (pointer: number, length: number) => void;
  liner_get_result_ptr: () => number;
  liner_get_result_len: () => number;
  liner_sign_request: (
    methodPointer: number,
    methodLength: number,
    pathPointer: number,
    pathLength: number,
    bodyPointer: number,
    bodyLength: number,
    timestamp: bigint,
    noncePointer: number,
    nonceLength: number,
  ) => number;
}

let signerPromise: Promise<SignerExports> | null = null;

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

async function loadSigner(): Promise<SignerExports> {
  if (!signerPromise) {
    signerPromise = WebAssembly.compile(decodeBase64(SIGNER_WASM_BASE64))
      .then((module) => WebAssembly.instantiate(module, {}))
      .then((instance) => instance.exports as unknown as SignerExports)
      .catch((error: unknown) => {
        signerPromise = null;
        throw error;
      });
  }
  return signerPromise;
}

function writeString(
  signer: SignerExports,
  value: string,
): { pointer: number; length: number; free: () => void } {
  const bytes = new TextEncoder().encode(value);
  const pointer = signer.liner_alloc(bytes.length);
  if (!pointer && bytes.length > 0) {
    throw new Error("Liner signer could not allocate memory.");
  }
  new Uint8Array(signer.memory.buffer, pointer, bytes.length).set(bytes);
  return {
    pointer,
    length: bytes.length,
    free: () => signer.liner_dealloc(pointer, bytes.length),
  };
}

function readResult(signer: SignerExports): string {
  const pointer = signer.liner_get_result_ptr();
  const length = signer.liner_get_result_len();
  if (!pointer || length <= 0) return "";
  return new TextDecoder().decode(
    new Uint8Array(signer.memory.buffer, pointer, length),
  );
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Runs the same bundled Liner WASM request signer used by Electron.
 * It does not invent a signature or fall back to unsigned requests.
 */
export async function signRequestInBrowser(
  method: string,
  path: string,
  body?: string | null,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<BrowserSignedRequest> {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random number generation is unavailable.");
  }

  const signer = await loadSigner();
  const nonce = createNonce();
  const methodBuffer = writeString(signer, method.toUpperCase().trim());
  const pathBuffer = writeString(signer, path.split("?")[0].trim());
  const bodyBuffer = writeString(signer, body ?? "");
  const nonceBuffer = writeString(signer, nonce);

  try {
    const code = signer.liner_sign_request(
      methodBuffer.pointer,
      methodBuffer.length,
      pathBuffer.pointer,
      pathBuffer.length,
      bodyBuffer.pointer,
      bodyBuffer.length,
      BigInt(timestamp),
      nonceBuffer.pointer,
      nonceBuffer.length,
    );

    if (code !== 0) {
      throw new Error(`Liner WASM signer failed with code ${code}.`);
    }

    const signature = readResult(signer);
    if (!signature) {
      throw new Error("Liner WASM signer returned an empty signature.");
    }

    return { signature, timestamp, nonce };
  } finally {
    methodBuffer.free();
    pathBuffer.free();
    bodyBuffer.free();
    nonceBuffer.free();
  }
}
