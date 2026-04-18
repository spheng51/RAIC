import type { ProviderId } from '@/lib/ai/providers';
import {
  getBrowserLocalTargetAddressSpace,
  normalizeBuiltInOpenAICompatibleBaseUrl,
} from '@/lib/utils/url';

export interface BrowserLocalOpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface BrowserLocalOpenAIParams {
  providerId: ProviderId;
  providerName: string;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
  signal?: AbortSignal;
}

interface BrowserLocalStreamParams extends BrowserLocalOpenAIParams {
  messages: BrowserLocalOpenAIMessage[];
  onTextDelta: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}

export interface BrowserLocalStreamResult {
  hadVisibleContent: boolean;
  hadReasoningContent: boolean;
  finishReason: string | null;
}

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: 'local' | 'loopback';
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function getChatCompletionsUrl(providerId: ProviderId, baseUrl: string): string {
  const normalized = baseUrl.trim();
  if (!normalized) {
    throw new Error('A valid Base URL is required.');
  }

  const resolvedBaseUrl = normalizeBuiltInOpenAICompatibleBaseUrl(providerId, normalized);
  const url = new URL(resolvedBaseUrl.endsWith('/') ? resolvedBaseUrl : `${resolvedBaseUrl}/`);
  return new URL('chat/completions', url).toString();
}

function createBrowserLocalHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  return headers;
}

function createBrowserLocalFetchInit(baseUrl: string, init: RequestInit): LocalNetworkRequestInit {
  const targetAddressSpace = getBrowserLocalTargetAddressSpace(baseUrl) ?? undefined;
  if (!targetAddressSpace) {
    return init;
  }

  return {
    ...init,
    targetAddressSpace,
  };
}

function extractTextFromContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (
          item &&
          typeof item === 'object' &&
          'type' in item &&
          item.type === 'text' &&
          'text' in item &&
          typeof item.text === 'string'
        ) {
          return item.text;
        }

        return '';
      })
      .join('');
  }

  return '';
}

function extractReasoningText(value: unknown): string {
  return extractTextFromContent(value);
}

function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if ('error' in value) {
    const errorValue = value.error;
    if (typeof errorValue === 'string') {
      return errorValue;
    }
    if (
      errorValue &&
      typeof errorValue === 'object' &&
      'message' in errorValue &&
      typeof errorValue.message === 'string'
    ) {
      return errorValue.message;
    }
  }

  if ('message' in value && typeof value.message === 'string') {
    return value.message;
  }

  return null;
}

async function readResponseError(response: Response): Promise<string | null> {
  const bodyText = await response.text().catch(() => '');
  if (!bodyText.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(bodyText);
    return extractErrorMessage(parsed) || bodyText.trim();
  } catch {
    return bodyText.trim();
  }
}

async function createBrowserLocalApiErrorMessage(
  response: Response,
  providerName: string,
  modelId: string,
): Promise<string> {
  const detail = await readResponseError(response);

  if (response.status === 401 || response.status === 403) {
    return `Authentication failed for ${providerName}. Check the optional API key or bearer token.`;
  }

  if (response.status === 404) {
    return `${providerName} could not find model "${modelId}" or rejected the chat/completions endpoint.`;
  }

  if (response.status === 429) {
    return `${providerName} is rate-limiting requests. Please retry in a moment.`;
  }

  if (response.status >= 400 && response.status < 500) {
    return detail
      ? `${providerName} rejected the request: ${detail}`
      : `${providerName} rejected the request for model "${modelId}".`;
  }

  if (response.status >= 500) {
    return detail
      ? `${providerName} returned a server error: ${detail}`
      : `${providerName} returned a server error while processing the request.`;
  }

  return detail
    ? `${providerName} request failed: ${detail}`
    : `${providerName} request failed with HTTP ${response.status}.`;
}

function createBrowserLocalCompatibilityErrorMessage(
  providerName: string,
  modelId: string,
  hadReasoningContent: boolean,
): string {
  if (hadReasoningContent) {
    return `${providerName} reached model "${modelId}", but it only returned reasoning output without any visible assistant text. Browser-local mode currently requires a model that emits final answer content for Q&A and Discussion.`;
  }

  return `${providerName} reached model "${modelId}", but it did not return assistant text that browser-local mode can display.`;
}

type LocalNetworkPermissionState = 'granted' | 'prompt' | 'denied' | null;

async function getLocalNetworkAccessPermissionState(): Promise<LocalNetworkPermissionState> {
  if (
    typeof navigator === 'undefined' ||
    !('permissions' in navigator) ||
    typeof navigator.permissions?.query !== 'function'
  ) {
    return null;
  }

  try {
    // `local-network-access` is still experimental in the DOM lib typings.
    const status = await navigator.permissions.query({
      // @ts-expect-error Experimental browser permission name.
      name: 'local-network-access',
    });
    if (status.state === 'granted' || status.state === 'prompt' || status.state === 'denied') {
      return status.state;
    }
  } catch {
    // Ignore unsupported permission queries and fall back to generic guidance.
  }

  return null;
}

export function getBrowserLocalFetchFailureMessage(
  providerName: string,
  options?: {
    permissionState?: LocalNetworkPermissionState;
    targetAddressSpace?: 'local' | 'loopback' | null;
  },
): string {
  const endpointLabel =
    options?.targetAddressSpace === 'loopback' ? 'localhost' : 'local/private-network';

  if (options?.permissionState === 'prompt') {
    return `This browser has not granted this site permission to reach your ${endpointLabel} ${providerName} endpoint yet. Allow local-network access for this site in your browser, then retry.`;
  }

  if (options?.permissionState === 'denied') {
    return `This browser is blocking this site from reaching your ${endpointLabel} ${providerName} endpoint. Re-enable local-network access for this site in your browser settings, then retry.`;
  }

  if (options?.permissionState === 'granted') {
    return `This browser has local-network access permission, but local ${providerName} still rejected the browser request. Check that it is running, the Base URL is correct, and the endpoint allows browser CORS access from this site.`;
  }

  return `This browser could not reach local ${providerName}. Check that it is running, the Base URL is correct, your browser allowed local-network access, and the endpoint allows browser CORS access.`;
}

export async function verifyBrowserLocalOpenAIModel(
  params: BrowserLocalOpenAIParams,
): Promise<void> {
  const resolvedBaseUrl = normalizeBuiltInOpenAICompatibleBaseUrl(
    params.providerId,
    trimTrailingSlash(params.baseUrl),
  );
  const chatUrl = getChatCompletionsUrl(params.providerId, resolvedBaseUrl);
  let response: Response;

  try {
    response = await fetch(
      chatUrl,
      createBrowserLocalFetchInit(resolvedBaseUrl, {
        method: 'POST',
        headers: createBrowserLocalHeaders(params.apiKey),
        body: JSON.stringify({
          model: params.modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 256,
          temperature: 0,
          stream: true,
        }),
        signal: params.signal,
      }),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    throw new Error(
      getBrowserLocalFetchFailureMessage(params.providerName, {
        permissionState: await getLocalNetworkAccessPermissionState(),
        targetAddressSpace: getBrowserLocalTargetAddressSpace(resolvedBaseUrl),
      }),
    );
  }

  if (!response.ok) {
    throw new Error(
      await createBrowserLocalApiErrorMessage(response, params.providerName, params.modelId),
    );
  }

  const result = await consumeBrowserLocalStreamResponse(response);
  if (!result.hadVisibleContent) {
    throw new Error(
      createBrowserLocalCompatibilityErrorMessage(
        params.providerName,
        params.modelId,
        result.hadReasoningContent,
      ),
    );
  }
}

function extractOutputParts(payload: unknown): {
  visibleText: string;
  reasoningText: string;
  finishReason: string | null;
} {
  if (!payload || typeof payload !== 'object') {
    return {
      visibleText: '',
      reasoningText: '',
      finishReason: null,
    };
  }

  if (
    'choices' in payload &&
    Array.isArray(payload.choices) &&
    payload.choices.length > 0 &&
    payload.choices[0] &&
    typeof payload.choices[0] === 'object'
  ) {
    const choice = payload.choices[0] as {
      delta?: { content?: unknown };
      message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      text?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
      finish_reason?: unknown;
    };

    return {
      visibleText:
        extractTextFromContent(choice.delta?.content) ||
        extractTextFromContent(choice.message?.content) ||
        extractTextFromContent(choice.text),
      reasoningText:
        extractReasoningText(
          (choice.delta as { reasoning_content?: unknown } | undefined)?.reasoning_content,
        ) ||
        extractReasoningText((choice.delta as { reasoning?: unknown } | undefined)?.reasoning) ||
        extractReasoningText(choice.message?.reasoning_content) ||
        extractReasoningText(choice.message?.reasoning) ||
        extractReasoningText(choice.reasoning_content) ||
        extractReasoningText(choice.reasoning),
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    };
  }

  if ('message' in payload && payload.message && typeof payload.message === 'object') {
    const message = payload.message as {
      content?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
    };
    return {
      visibleText: extractTextFromContent(message.content),
      reasoningText:
        extractReasoningText(message.reasoning_content) || extractReasoningText(message.reasoning),
      finishReason: null,
    };
  }

  return {
    visibleText: '',
    reasoningText: '',
    finishReason: null,
  };
}

async function consumeBrowserLocalStreamResponse(
  response: Response,
  callbacks?: {
    onTextDelta?: (delta: string) => void;
    onReasoningDelta?: (delta: string) => void;
  },
): Promise<BrowserLocalStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('The local model endpoint did not return a readable response stream.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let hadVisibleContent = false;
  let hadReasoningContent = false;
  let finishReason: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const rawEvent of events) {
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim());

        for (const dataLine of dataLines) {
          if (!dataLine || dataLine === '[DONE]') {
            continue;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(dataLine);
          } catch {
            continue;
          }

          const {
            visibleText,
            reasoningText,
            finishReason: nextFinishReason,
          } = extractOutputParts(parsed);
          if (visibleText) {
            hadVisibleContent = true;
            callbacks?.onTextDelta?.(visibleText);
          }
          if (reasoningText) {
            hadReasoningContent = true;
            callbacks?.onReasoningDelta?.(reasoningText);
          }
          if (nextFinishReason) {
            finishReason = nextFinishReason;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    hadVisibleContent,
    hadReasoningContent,
    finishReason,
  };
}

export async function streamBrowserLocalOpenAIChat(
  params: BrowserLocalStreamParams,
): Promise<BrowserLocalStreamResult> {
  const resolvedBaseUrl = normalizeBuiltInOpenAICompatibleBaseUrl(
    params.providerId,
    trimTrailingSlash(params.baseUrl),
  );
  const chatUrl = getChatCompletionsUrl(params.providerId, resolvedBaseUrl);
  let response: Response;

  try {
    response = await fetch(
      chatUrl,
      createBrowserLocalFetchInit(resolvedBaseUrl, {
        method: 'POST',
        headers: createBrowserLocalHeaders(params.apiKey),
        body: JSON.stringify({
          model: params.modelId,
          messages: params.messages,
          temperature: 0.7,
          stream: true,
        }),
        signal: params.signal,
      }),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    throw new Error(
      getBrowserLocalFetchFailureMessage(params.providerName, {
        permissionState: await getLocalNetworkAccessPermissionState(),
        targetAddressSpace: getBrowserLocalTargetAddressSpace(resolvedBaseUrl),
      }),
    );
  }

  if (!response.ok) {
    throw new Error(
      await createBrowserLocalApiErrorMessage(response, params.providerName, params.modelId),
    );
  }

  const result = await consumeBrowserLocalStreamResponse(response, {
    onTextDelta: params.onTextDelta,
    onReasoningDelta: params.onReasoningDelta,
  });

  if (!result.hadVisibleContent) {
    throw new Error(
      createBrowserLocalCompatibilityErrorMessage(
        params.providerName,
        params.modelId,
        result.hadReasoningContent,
      ),
    );
  }

  return result;
}
