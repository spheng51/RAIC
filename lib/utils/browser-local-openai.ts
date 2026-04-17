import type { ProviderId } from '@/lib/ai/providers';

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
}

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: 'local';
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function getChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim();
  if (!normalized) {
    throw new Error('A valid Base URL is required.');
  }

  const url = new URL(normalized.endsWith('/') ? normalized : `${normalized}/`);
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

function createBrowserLocalFetchInit(init: RequestInit): LocalNetworkRequestInit {
  return {
    ...init,
    targetAddressSpace: 'local',
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

export function getBrowserLocalFetchFailureMessage(providerName: string): string {
  return `This browser could not reach local ${providerName}. Check that it is running, the Base URL is correct, your browser allowed local-network access, and the endpoint allows browser CORS access.`;
}

export async function verifyBrowserLocalOpenAIModel(
  params: BrowserLocalOpenAIParams,
): Promise<void> {
  const chatUrl = getChatCompletionsUrl(trimTrailingSlash(params.baseUrl));
  let response: Response;

  try {
    response = await fetch(
      chatUrl,
      createBrowserLocalFetchInit({
        method: 'POST',
        headers: createBrowserLocalHeaders(params.apiKey),
        body: JSON.stringify({
          model: params.modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 8,
          temperature: 0,
          stream: false,
        }),
        signal: params.signal,
      }),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    throw new Error(getBrowserLocalFetchFailureMessage(params.providerName));
  }

  if (!response.ok) {
    throw new Error(
      await createBrowserLocalApiErrorMessage(response, params.providerName, params.modelId),
    );
  }
}

function extractStreamDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
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
      message?: { content?: unknown };
      text?: unknown;
    };

    return (
      extractTextFromContent(choice.delta?.content) ||
      extractTextFromContent(choice.message?.content) ||
      extractTextFromContent(choice.text)
    );
  }

  if ('message' in payload && payload.message && typeof payload.message === 'object') {
    const message = payload.message as { content?: unknown };
    return extractTextFromContent(message.content);
  }

  return '';
}

export async function streamBrowserLocalOpenAIChat(
  params: BrowserLocalStreamParams,
): Promise<{ hadContent: boolean }> {
  const chatUrl = getChatCompletionsUrl(trimTrailingSlash(params.baseUrl));
  let response: Response;

  try {
    response = await fetch(
      chatUrl,
      createBrowserLocalFetchInit({
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

    throw new Error(getBrowserLocalFetchFailureMessage(params.providerName));
  }

  if (!response.ok) {
    throw new Error(
      await createBrowserLocalApiErrorMessage(response, params.providerName, params.modelId),
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`${params.providerName} did not return a readable response stream.`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let hadContent = false;

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

          const delta = extractStreamDelta(parsed);
          if (delta) {
            hadContent = true;
            params.onTextDelta(delta);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { hadContent };
}
