/**
 * Media Proxy API
 *
 * Server-side proxy for fetching remote media URLs (images/videos).
 * Required because browser fetch() to remote CDN URLs fails with CORS errors.
 * The media orchestrator uses this to download generated media as blobs
 * for IndexedDB persistence.
 *
 * POST /api/proxy-media
 * Body: { url: string }
 * Response: Binary blob with appropriate Content-Type
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { API_ERROR_CODES, apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import {
  ProxyMediaTooLargeError,
  getDeclaredContentLength,
  getProxyMediaMaxBytes,
  getProxyMediaTimeoutMs,
  readProxyBodyWithinLimit,
} from '@/lib/server/proxy-media';

const log = createLogger('ProxyMedia');

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let url: string | undefined;
  let abortController: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    ({ url } = await request.json());

    if (!url || typeof url !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing or invalid url');
    }

    // Block local/private network URLs to prevent SSRF
    const ssrfError = await validateUrlForSSRF(url);
    if (ssrfError) {
      return apiError('INVALID_URL', 403, ssrfError);
    }

    const maxBytes = getProxyMediaMaxBytes();
    const timeoutMs = getProxyMediaTimeoutMs();
    const controller = new AbortController();
    abortController = controller;
    timeout = setTimeout(() => {
      controller.abort(new Error('Proxy media request timed out'));
    }, timeoutMs);

    // Disable redirect following to prevent redirect-to-internal attacks
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timeout);
      return apiError('REDIRECT_NOT_ALLOWED', 403, 'Redirects are not allowed');
    }
    if (!response.ok) {
      clearTimeout(timeout);
      return apiError('UPSTREAM_ERROR', 502, `Upstream returned ${response.status}`);
    }

    const declaredContentLength = getDeclaredContentLength(response.headers);
    if (declaredContentLength !== null && declaredContentLength > maxBytes) {
      clearTimeout(timeout);
      abortController.abort(new Error('Remote media exceeds the configured size limit'));
      return apiError(
        API_ERROR_CODES.PAYLOAD_TOO_LARGE,
        413,
        `Remote media exceeds the ${maxBytes} byte limit`,
      );
    }

    if (!response.body) {
      clearTimeout(timeout);
      return apiError('UPSTREAM_ERROR', 502, 'Upstream response had no body');
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const body = await readProxyBodyWithinLimit(response.body, maxBytes);
    const responseBody = new Blob([body], { type: contentType });
    clearTimeout(timeout);

    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(body.byteLength),
      },
    });
  } catch (error) {
    if (timeout) clearTimeout(timeout);
    if (error instanceof ProxyMediaTooLargeError) {
      return apiError(API_ERROR_CODES.PAYLOAD_TOO_LARGE, 413, error.message);
    }
    if (
      abortController?.signal.aborted &&
      abortController.signal.reason instanceof Error &&
      abortController.signal.reason.message === 'Proxy media request timed out'
    ) {
      return apiError(API_ERROR_CODES.UPSTREAM_TIMEOUT, 504, 'Upstream request timed out');
    }

    log.error(`Proxy media failed [url="${url?.substring(0, 100) ?? 'unknown'}"]:`, error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
