const DEFAULT_PROXY_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_PROXY_MEDIA_TIMEOUT_MS = 30_000;

function readPositiveIntegerEnv(value: string | undefined, fallbackValue: number): number {
  if (!value) return fallbackValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

export function getProxyMediaMaxBytes(): number {
  return readPositiveIntegerEnv(process.env.PROXY_MEDIA_MAX_BYTES, DEFAULT_PROXY_MEDIA_MAX_BYTES);
}

export function getProxyMediaTimeoutMs(): number {
  return readPositiveIntegerEnv(process.env.PROXY_MEDIA_TIMEOUT_MS, DEFAULT_PROXY_MEDIA_TIMEOUT_MS);
}

export function getDeclaredContentLength(headers: Headers): number | null {
  const rawValue = headers.get('content-length');
  if (!rawValue) return null;

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export class ProxyMediaTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Remote media exceeded the ${maxBytes} byte limit`);
    this.name = 'ProxyMediaTooLargeError';
  }
}

export async function readProxyBodyWithinLimit(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        const tooLargeError = new ProxyMediaTooLargeError(maxBytes);
        try {
          await reader.cancel(tooLargeError);
        } catch {
          // Best-effort cancellation; the route still returns a deterministic 413.
        }
        throw tooLargeError;
      }

      chunks.push(value);
    }

    const output = new Uint8Array(new ArrayBuffer(totalBytes));
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return output.buffer;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release failures after cancellation or abort.
    }
  }
}
